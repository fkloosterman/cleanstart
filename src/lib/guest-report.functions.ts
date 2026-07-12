import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { normalizeProfile, slotValue } from "@/lib/profile/normalize";
import { composeReportDocument, createCompositionGenerate } from "@/lib/report/composer.server";
import { dayWindowStart, readGuestRateLimits } from "@/lib/rate-limit";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit.server";
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

    // Rate limiting (WP3.10, D7/D14): bound guest report generation per IP per
    // day *before* the expensive compose call. Fixed-window Postgres counter,
    // cap from env. Fails open on a DB error (best-effort protection). The
    // report page caches the result in localStorage and only calls this on an
    // explicit "generate" click, so a browser restart re-renders the cached
    // report without spending another slot.
    const request = getRequest();
    if (request) {
      const limits = readGuestRateLimits(process.env);
      const { allowed } = await enforceRateLimit(
        "guest_report",
        clientIp(request),
        dayWindowStart(new Date()),
        limits.reportsPerDay,
      );
      if (!allowed) {
        throw new Error(
          "You've reached today's limit for guest reports. Sign in to generate more.",
        );
      }
    }

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
