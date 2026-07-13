/**
 * Guest rate limiting — server half (WP3.10, D14, design §9).
 *
 * Wraps the atomic `increment_rate_limit` RPC (a single INSERT ... ON CONFLICT,
 * so concurrent requests can't lose a count) behind the pure decision logic in
 * `rate-limit.ts`. The guest endpoints run server-side and call this with the
 * service-role admin client — the counter table denies anon/authenticated, so a
 * guest can neither read nor reset their own counter.
 *
 * Fails *open* on a DB error: a transient Supabase hiccup must not take down
 * guest chat. Rate limiting is best-effort protection, not a correctness gate;
 * blocking every guest because the counter errored is worse than briefly
 * missing a cap. The error is logged so the failure is visible.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isOverLimit, type RateLimitBucket } from "@/lib/rate-limit";

/**
 * Extract the client IP from a request, matching the header order Vercel/
 * Cloudflare set. Falls back to "anon" when none is present (local dev), which
 * shares one counter — acceptable, since the daily IP caps are an abuse bound,
 * not a per-user quota.
 */
export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anon"
  );
}

/**
 * Increment the counter for one window and return whether the request is within
 * `limit`. Fails open (returns allowed) if the RPC errors.
 */
export async function enforceRateLimit(
  bucket: RateLimitBucket,
  subject: string,
  windowStart: string,
  limit: number,
): Promise<{ allowed: boolean; count: number }> {
  const { data, error } = await supabaseAdmin.rpc("increment_rate_limit", {
    p_bucket: bucket,
    p_subject: subject,
    p_window_start: windowStart,
  });

  if (error || typeof data !== "number") {
    console.error(`[rate-limit] increment failed for ${bucket}/${subject}:`, error);
    return { allowed: true, count: 0 };
  }

  return { allowed: !isOverLimit(data, limit), count: data };
}
