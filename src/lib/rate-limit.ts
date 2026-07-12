/**
 * Guest rate limiting — pure core (WP3.10, D7, D14, design §9).
 *
 * The abuse bounds on the guest (no-account) paths. D14 resolved the store to a
 * Postgres fixed-window counter table; this module is the deterministic half —
 * limit configuration, window keys, and the allow/deny decision — with the DB
 * call isolated in `rate-limit.server.ts`. Kept pure so the boundary logic is
 * unit-tested without a database (ground rule #1).
 *
 * Three caps (D7 defaults, all env-tunable without a deploy):
 * - `guest_msg`            messages per day per IP
 * - `guest_session_turns`  turns per guest session
 * - `guest_report`         guest reports per day per IP
 *
 * Fixed-window semantics: a count belongs to a window, and a new window is a
 * fresh row that starts at zero — so the cap resets at the window boundary with
 * no scheduled reset job. The daily caps use UTC midnight as the window; the
 * per-session cap has no time window (the session id is already unique), so it
 * uses a constant sentinel and accumulates over the session's whole life.
 */

/** Which limit a counter row belongs to (the `bucket` column). */
export type RateLimitBucket = "guest_msg" | "guest_session_turns" | "guest_report";

export interface GuestRateLimits {
  /** Messages per day per IP (`GUEST_MESSAGES_PER_DAY`). */
  messagesPerDay: number;
  /** Turns per guest session (`GUEST_TURNS_PER_SESSION`). */
  turnsPerSession: number;
  /** Guest reports per day per IP (`GUEST_REPORTS_PER_DAY`). */
  reportsPerDay: number;
}

/** D7's resolved defaults — the values used when the env var is unset. */
export const DEFAULT_GUEST_RATE_LIMITS: GuestRateLimits = {
  messagesPerDay: 40,
  turnsPerSession: 30,
  reportsPerDay: 3,
};

/**
 * Parse a positive-integer limit from an env value, falling back to `fallback`
 * on anything unusable (unset, non-numeric, zero, negative, fractional). A
 * misconfigured var must never silently disable a cap or set it to something
 * nonsensical — it falls back to the safe default instead.
 */
export function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const n = Number.parseInt(trimmed, 10);
  return n > 0 ? n : fallback;
}

/** Read the three guest caps from the environment, with D7 defaults. */
export function readGuestRateLimits(env: Record<string, string | undefined>): GuestRateLimits {
  return {
    messagesPerDay: parseLimit(
      env.GUEST_MESSAGES_PER_DAY,
      DEFAULT_GUEST_RATE_LIMITS.messagesPerDay,
    ),
    turnsPerSession: parseLimit(
      env.GUEST_TURNS_PER_SESSION,
      DEFAULT_GUEST_RATE_LIMITS.turnsPerSession,
    ),
    reportsPerDay: parseLimit(env.GUEST_REPORTS_PER_DAY, DEFAULT_GUEST_RATE_LIMITS.reportsPerDay),
  };
}

/**
 * The window key for a daily cap: UTC midnight of `now`, as an ISO string the
 * `window_start TIMESTAMPTZ` column stores. Everything on the same UTC day maps
 * to the same key, so the day's requests share one counter row.
 */
export function dayWindowStart(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

/**
 * The window key for the per-session cap: a constant. The session id is the
 * unique part of the counter key, so all of a session's turns share one row
 * regardless of time (the session's whole life is one window).
 */
export const SESSION_WINDOW_START = "1970-01-01T00:00:00.000Z";

/**
 * The allow/deny decision from a post-increment count. `count` is the total
 * *including* the current request (what `increment_rate_limit` returns), so a
 * limit of 40 blocks the 41st request and allows the 40th (`41 > 40`).
 */
export function isOverLimit(count: number, limit: number): boolean {
  return count > limit;
}
