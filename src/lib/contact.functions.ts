import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { dayWindowStart, readGuestRateLimits } from "@/lib/rate-limit";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit.server";
import { z } from "zod";

/**
 * Contact / feedback form submit — server half.
 *
 * Public path (no auth middleware): guests and signed-in users can both submit,
 * mirroring the guest-report function. On each submission we (1) rate-limit per
 * IP per day, (2) persist the row via the service-role admin client (the table
 * denies anon/authenticated — see 20260712010000_contact_submissions.sql), and
 * (3) email the developers best-effort. A mail failure never fails the request:
 * the submission is already saved.
 */

export const CONTACT_CATEGORIES = ["bug", "suggestion", "question", "praise", "other"] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

/** Human-readable category labels, shared by the email body and the form UI. */
export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  bug: "Bug / issue",
  suggestion: "Suggestion",
  question: "Question",
  praise: "Praise",
  other: "Other",
};

const ContactInput = z.object({
  category: z.enum(CONTACT_CATEGORIES),
  message: z.string().trim().min(1, "Please enter a message.").max(4000),
  // Optional follow-up address. The form sends "" when left blank; accept that
  // as "no email" alongside a real address.
  email: z.string().trim().email().optional().or(z.literal("")),
});

export const submitContact = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ContactInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendDeveloperEmail } = await import("@/lib/email.server");

    const request = getRequest();

    // Rate limit per IP per day (abuse bound on the public form). Fixed-window
    // Postgres counter; fails open on a DB error like the other guest paths.
    if (request) {
      const limits = readGuestRateLimits(process.env);
      const { allowed } = await enforceRateLimit(
        "contact",
        clientIp(request),
        dayWindowStart(new Date()),
        limits.contactPerDay,
      );
      if (!allowed) {
        throw new Error("You've reached today's limit for messages. Please try again tomorrow.");
      }
    }

    // Best-effort attribution: when a signed-in user submits, the global
    // attachSupabaseAuth middleware has put their access token on the request.
    // Validate it to record their user id; guests send no token (user_id null).
    let userId: string | null = null;
    const authHeader = request?.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    if (token && token.split(".").length === 3) {
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      userId = userData.user?.id ?? null;
    }

    const replyEmail = data.email && data.email.length > 0 ? data.email : null;

    const { error } = await supabaseAdmin.from("contact_submissions").insert({
      category: data.category,
      message: data.message,
      reply_email: replyEmail,
      user_id: userId,
    });
    if (error) {
      console.error("[contact] Failed to persist submission:", error);
      throw new Error("Something went wrong saving your message. Please try again.");
    }

    // Notify the developers. Best-effort — the row is already persisted, so a
    // mail failure (or missing Resend config) must not fail the user's request.
    const label = CONTACT_CATEGORY_LABELS[data.category];
    await sendDeveloperEmail({
      subject: `[Clean Start] ${label}`,
      text: [
        `Category: ${label}`,
        `Reply email: ${replyEmail ?? "(none provided)"}`,
        `From: ${userId ? `signed-in user ${userId}` : "guest"}`,
        "",
        data.message,
      ].join("\n"),
      replyTo: replyEmail ?? undefined,
    });

    return { ok: true as const };
  });
