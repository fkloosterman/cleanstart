/**
 * Developer notification email — server half.
 *
 * The contact/feedback form emails the developers on every submission. This is
 * the only outbound-mail path in the app, so it's kept deliberately small: a
 * single POST to Resend's REST API (https://resend.com/docs/api-reference), no
 * SDK dependency. It runs server-side only (the `.server.ts` suffix keeps it
 * out of the client bundle) where `fetch` can reach external TLS.
 *
 * Configuration (server-only env vars, set in Vercel / Lovable Cloud secrets):
 * - RESEND_API_KEY     the Resend key. If unset, sending is a graceful no-op
 *                      (logged, not thrown) so the feature works before Resend
 *                      is provisioned — the submission is already persisted.
 * - CONTACT_NOTIFY_EMAIL   recipient for notifications. Required to actually
 *                      send; a missing recipient is also a no-op.
 * - CONTACT_FROM_EMAIL     sender. Defaults to Resend's shared onboarding
 *                      address, which works before a domain is verified.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Clean Start <onboarding@resend.dev>";

export interface DeveloperEmail {
  subject: string;
  text: string;
  html?: string;
  /** Optional address the sender left, used as the email's Reply-To. */
  replyTo?: string;
}

/**
 * Send a notification to the developers. Best-effort: returns `false` (and logs)
 * rather than throwing when it's unconfigured or the request fails, so callers
 * never fail a user request over a mail hiccup. Returns `true` on a 2xx.
 */
export async function sendDeveloperEmail(email: DeveloperEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  // Note: a declared-but-empty env var (CONTACT_FROM_EMAIL=) is "" not
  // undefined, so `??` wouldn't fall back — treat blank/whitespace as unset.
  const from = process.env.CONTACT_FROM_EMAIL?.trim() || DEFAULT_FROM;
  // CONTACT_NOTIFY_EMAIL may list several recipients, comma-separated — Resend
  // accepts an array of addresses on `to`. Split, trim, and drop blanks.
  const to = (process.env.CONTACT_NOTIFY_EMAIL ?? "")
    .split(",")
    .map((addr) => addr.trim())
    .filter(Boolean);

  if (!apiKey || to.length === 0) {
    console.warn(
      "[email] Skipping developer notification: " +
        `${!apiKey ? "RESEND_API_KEY" : "CONTACT_NOTIFY_EMAIL"} is not set.`,
    );
    return false;
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: email.subject,
        text: email.text,
        ...(email.html ? { html: email.html } : {}),
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email] Resend send failed (${res.status}): ${detail}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] Resend send threw:", err);
    return false;
  }
}
