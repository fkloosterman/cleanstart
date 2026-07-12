import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenRouterModel } from "@/lib/ai-gateway.server";
import { buildReportPrompt } from "@/lib/prompts/report";
import { generateText } from "ai";
import { z } from "zod";

const SessionInput = z.object({ sessionId: z.string().uuid() });

// Simplified schema (no min/max/int constraints) to stay within Gemini's
// structured-output state machine limits. We validate after parsing.
const ReportSchema = z.object({
  readiness_score: z.number().optional().default(0),

  top_options: z
    .array(
      z.object({
        title: z.string(),
        why: z.string().optional().default(""),
        // LLMs occasionally return a string instead of an array — coerce gracefully
        good_fit_when: z
          .union([z.array(z.string()), z.string()])
          .transform((v) => (Array.isArray(v) ? v : v ? [v] : []))
          .optional()
          .default([]),
        tradeoffs: z.string().optional().default(""),
      }),
    )
    .optional()
    .default([]),
  key_insights: z.array(z.string()).optional().default([]),
  next_steps: z
    .array(
      z.object({
        step: z.string(),
        detail: z.string().optional().default(""),
      }),
    )
    .optional()
    .default([]),
  resources: z
    .array(
      z.object({
        label: z.string(),
        description: z.string().optional().default(""),
      }),
    )
    .optional()
    .default([]),
});


export type CleanStartReport = z.infer<typeof ReportSchema>;

function extractJson(raw: string): unknown {
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = s.search(/[\{\[]/);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (start === -1 || end === -1) throw new Error("Model did not return JSON");
  s = s.substring(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    s = s.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, "");
    return JSON.parse(s);
  }
}


export const getReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SessionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: report } = await supabase
      .from("reports")
      .select("*")
      .eq("session_id", data.sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    return report;
  });

export const generateReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SessionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { sessionId } = data;

    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessErr || !session || session.user_id !== userId) {
      throw new Error("Session not found");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("persona")
      .eq("id", userId)
      .maybeSingle();
    const persona = profile?.persona ?? null;

    const { data: messages, error: msgErr } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (msgErr) throw new Error("Failed to load conversation");
    if (!messages || messages.length < 2) {
      throw new Error("Have a short conversation first, then come back to generate a report.");
    }

    const transcript = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY");

    const model = createOpenRouterModel(OPENROUTER_API_KEY);

    const { text } = await generateText({
      model,
      system: buildReportPrompt(persona),
      prompt: `CONVERSATION TRANSCRIPT:\n\n${transcript}\n\nWrite the personalized research summary now as JSON.`,
    });

    const object = ReportSchema.parse(extractJson(text));


    const payload = {
      session_id: sessionId,
      user_id: userId,
      persona,
      readiness_score: object.readiness_score,
      top_options: object.top_options,
      key_insights: object.key_insights,
      next_steps: object.next_steps,
      resources: object.resources,
    };

    // Upsert by session_id (one report per session)
    const { data: existing } = await supabase
      .from("reports")
      .select("id")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      const { data: updated, error } = await supabase
        .from("reports")
        .update(payload)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      await supabase.from("sessions").update({ is_complete: true }).eq("id", sessionId);
      return updated;
    }

    const { data: inserted, error } = await supabase
      .from("reports")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    await supabase.from("sessions").update({ is_complete: true }).eq("id", sessionId);
    return inserted;
  });
