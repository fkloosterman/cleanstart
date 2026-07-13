import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { previewGuardMessage } from "@/lib/preview-guard";
import { normalizeProfile, slotValue } from "@/lib/profile/normalize";
import { composeReportDocument, createCompositionGenerate } from "@/lib/report/composer.server";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

const SessionInput = z.object({ sessionId: z.string().uuid() });

export const getReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SessionInput.parse(d))
  .handler(async ({ data, context }) => {
    const guardMessage = previewGuardMessage(process.env);
    if (guardMessage) throw new Error(guardMessage);

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
    const guardMessage = previewGuardMessage(process.env);
    if (guardMessage) throw new Error(guardMessage);

    const { supabase, userId } = context;
    const { sessionId } = data;

    // Load the session with its profile in one round-trip — the profile is the
    // composer's primary input now (WP1.5), replacing the old persona enum.
    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("id, user_id, profile")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessErr || !session || session.user_id !== userId) {
      throw new Error("Session not found");
    }

    const { data: messages, error: msgErr } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (msgErr) throw new Error("Failed to load conversation");
    if (!messages || messages.length < 2) {
      throw new Error("Have a short conversation first, then come back to generate a report.");
    }

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY");

    const profile = normalizeProfile(session.profile);

    // The composer never hard-fails (validation → retry → deterministic
    // fallback, §6.3); the authenticated path allows the one retry.
    const document = await composeReportDocument({
      profile,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      generate: createCompositionGenerate(OPENROUTER_API_KEY),
      allowRetry: true,
    });

    const persona = slotValue(profile, "tenure") ?? null;
    const payload = {
      session_id: sessionId,
      user_id: userId,
      persona,
      // JSONB: the document carries slot envelopes that don't line up with the
      // generated Json type; cast at this boundary (re-parsed on read).
      document: document as unknown as Json,
    };

    // Upsert by session_id (one report per session). Legacy columns keep their
    // table defaults — old reports render via the legacy path, new ones via the
    // document (D5, seam 1).
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
