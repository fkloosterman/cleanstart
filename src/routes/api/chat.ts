import { createModelForPurpose } from "@/lib/ai-gateway.server";
import { deriveLane } from "@/lib/lanes/derive";
import { previewGuardMessage } from "@/lib/preview-guard";
import { buildContext, deriveStage } from "@/lib/prompts/context";
import { extractProfilePatches } from "@/lib/profile/extractor";
import { createExtractionGenerate } from "@/lib/profile/extractor.server";
import { normalizeProfile, slotValue } from "@/lib/profile/normalize";
import { applyPatches } from "@/lib/profile/patches";
import { readiness } from "@/lib/profile/readiness";
import { reportGate } from "@/lib/profile/readiness-gate";
import { PROFILE_PATCH_PART_TYPE } from "@/lib/profile/stream";
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import type { Database, Json } from "@/integrations/supabase/types";

type Body = {
  sessionId?: string;
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
        const guardMessage = previewGuardMessage(process.env);
        if (guardMessage) {
          return new Response(guardMessage, { status: 503 });
        }

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

        // Verify session ownership; load the current profile in the same
        // round-trip so the per-turn extractor can patch onto it (WP1.5).
        const { data: session, error: sessErr } = await supabase
          .from("sessions")
          .select("id, title, user_id, profile, readiness_reached_at")
          .eq("id", sessionId)
          .maybeSingle();
        if (sessErr || !session || session.user_id !== userId) {
          return new Response("Forbidden", { status: 403 });
        }

        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const lastUserText = lastUser ? textOf(lastUser) : "";
        if (lastUser) {
          const content = lastUserText;
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

        // The profile the extractor patches onto — normalized on read, so an
        // old or junk-shaped column heals rather than blocks (§11).
        const currentProfile = normalizeProfile(session.profile);

        // The lane is derived from the motivation vector (WP2.1); stage from
        // information sufficiency and the ratcheted report gate (WP1.7) — no
        // more persona enum or assistant-turn counting.
        const lane = deriveLane(slotValue(currentProfile, "motivation_weights"));
        const gate = reportGate(currentProfile, session.readiness_reached_at);
        const system = buildContext({
          profile: currentProfile,
          lane,
          stage: deriveStage(currentProfile, lane.framing, { reportGateOpen: gate.open }),
        });

        const model = createModelForPurpose("chat", OPENROUTER_API_KEY);
        const modelMessages = await convertToModelMessages(messages);
        const extract = createExtractionGenerate(OPENROUTER_API_KEY);

        const stream = createUIMessageStream({
          originalMessages: messages,
          execute: async ({ writer }) => {
            const result = streamText({ model, system, messages: modelMessages });
            // Forward the reply as it streams — zero added time-to-first-token.
            writer.merge(result.toUIMessageStream());

            // Everything below runs only once the reply has fully streamed. A
            // stream failure is already surfaced to the client via the merge;
            // bail out rather than double-report or extract from a broken turn.
            let assistantText = "";
            try {
              assistantText = (await result.text).trim();
            } catch (err) {
              console.error("[/api/chat] reply stream failed:", err);
              return;
            }
            if (assistantText) {
              await supabase.from("messages").insert({
                session_id: sessionId,
                role: "assistant",
                content: assistantText,
              });
              await supabase
                .from("sessions")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", sessionId);
            }

            // Per-turn extraction (WP1.4). Never throws and never blocks the
            // reply the user already saw; a bad model response yields [].
            if (!lastUserText) return;
            const patches = await extractProfilePatches(
              currentProfile,
              { user: lastUserText, assistant: assistantText || undefined },
              extract,
            );
            if (patches.length === 0) return;

            const { profile: updated } = applyPatches(currentProfile, patches);
            // Ratchet (§4.5): stamp the first turn readiness is reached so a
            // later edit that drops a required slot can't re-lock the report.
            // Once set, it is never cleared or moved.
            const reachedNow =
              !session.readiness_reached_at && readiness(updated).ready
                ? new Date().toISOString()
                : null;
            const { error: profileErr } = await supabase
              .from("sessions")
              // JSONB column; the tolerant slot envelopes carry unknown-indexed
              // values that don't line up with the generated `Json` type, so
              // cast at this boundary (round-tripped by normalizeProfile on read).
              .update({
                profile: updated as unknown as Json,
                ...(reachedNow ? { readiness_reached_at: reachedNow } : {}),
              })
              .eq("id", sessionId);
            if (profileErr) {
              console.error("[/api/chat] profile persist failed, skipping:", profileErr);
              return;
            }
            // Ride the same stream as a transient side-channel so a live
            // sidebar (WP1.6) can reflect the update without a reload; it is
            // not part of the message and is never persisted client-side.
            writer.write({ type: PROFILE_PATCH_PART_TYPE, data: { patches }, transient: true });
          },
          onError: (error) => {
            console.error("[/api/chat] stream error", error);
            return error instanceof Error ? error.message : "Stream error";
          },
        });

        return createUIMessageStreamResponse({ stream });
      },
    },
  },
});
