import { createOpenRouterModel } from "@/lib/ai-gateway.server";
import { buildSystemPrompt, type Persona } from "@/lib/prompts/chat";
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
import type { Database } from "@/integrations/supabase/types";

type Body = {
  sessionId?: string;
  persona?: Persona;
  messages?: UIMessage[];
};

function textOf(msg: UIMessage) {
  return msg.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = auth.slice(7);

        const SUPABASE_URL = process.env.SUPABASE_URL!;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
        if (!OPENROUTER_API_KEY) {
          return new Response("Missing OPENROUTER_API_KEY", { status: 500 });
        }

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) {
          return new Response("Unauthorized", { status: 401 });
        }
        const userId = claims.claims.sub;

        const body = (await request.json()) as Body;
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const sessionId = body.sessionId;
        if (!sessionId || messages.length === 0) {
          return new Response("Bad request", { status: 400 });
        }

        // Verify session ownership
        const { data: session, error: sessErr } = await supabase
          .from("sessions")
          .select("id, title, user_id")
          .eq("id", sessionId)
          .maybeSingle();
        if (sessErr || !session || session.user_id !== userId) {
          return new Response("Forbidden", { status: 403 });
        }

        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          const content = textOf(lastUser);
          if (content) {
            await supabase.from("messages").insert({
              session_id: sessionId,
              role: "user",
              content,
            });
            // First user message becomes the session title (matches the
            // sessions.title DB default in the schema migration).
            if (!session.title || session.title === "New session") {
              await supabase
                .from("sessions")
                .update({
                  title: content.slice(0, 80),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", sessionId);
            }
          }
        }

        const assistantTurnCount = messages.filter((m) => m.role === "assistant").length;
        const system = buildSystemPrompt({
          persona: body.persona ?? null,
          assistantTurnCount,
        });

        const model = createOpenRouterModel(OPENROUTER_API_KEY);

        const result = streamText({
          model,
          system,
          messages: await convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ responseMessage }) => {
            const text = textOf(responseMessage);
            if (text) {
              await supabase.from("messages").insert({
                session_id: sessionId,
                role: "assistant",
                content: text,
              });
              await supabase
                .from("sessions")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", sessionId);
            }
          },
          onError: (error) => {
            console.error("[/api/chat] stream error", error);
            return error instanceof Error ? error.message : "Stream error";
          },
        });
      },
    },
  },
});
