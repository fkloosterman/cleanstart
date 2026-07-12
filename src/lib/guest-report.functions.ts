import { createServerFn } from "@tanstack/react-start";
import { normalizeProfile, slotValue } from "@/lib/profile/normalize";
import { composeReportDocument, createCompositionGenerate } from "@/lib/report/composer.server";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

const GuestInput = z.object({
  // Accepted for wire compatibility with the old payload; the report is now
  // composed from `profile` (which the guest client seeds from these upfront, §9).
  tenure: z.enum(["homeowner", "renter", "curious"]).nullable().optional(),
  /** The guest's localStorage profile (§9) — the composer's primary input. */
  profile: z.unknown().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      }),
    )
    .min(2)
    .max(60),
});

export type GuestReport = {
  id: string;
  session_id: string;
  persona: string | null;
  created_at: string;
  // Serialized as JSONB over the wire (like the DB row the auth path returns);
  // the report page re-parses it with `parseReportDocument` before rendering.
  document: Json;
};

export const generateGuestReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => GuestInput.parse(d))
  .handler(async ({ data }) => {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY");

    const profile = normalizeProfile(data.profile);

    // Guests share the composer's server code but skip the retry — straight to
    // the deterministic fallback on failure, keeping cost bounded (§9, §6.3).
    const document = await composeReportDocument({
      profile,
      messages: data.messages,
      generate: createCompositionGenerate(OPENROUTER_API_KEY),
      allowRetry: false,
    });

    return {
      id: "guest",
      session_id: "guest",
      persona: slotValue(profile, "tenure") ?? data.tenure ?? null,
      created_at: new Date().toISOString(),
      document: document as unknown as Json,
    } satisfies GuestReport;
  });
