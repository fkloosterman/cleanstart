-- Migration for guest rate limiting (WP3.10, D14, design §9).
-- Additive only: one new table and one function. No existing table is touched,
-- so deployed code that predates this migration keeps working, and code written
-- against it tolerates an empty table (the function creates rows on demand).
--
-- D14 resolved the rate-limit store to a Postgres fixed-window counter table in
-- the existing Supabase project (no new vendor). The three D7 caps — messages/
-- day/IP, turns/guest-session, reports/day/IP — are enforced by the server, not
-- encoded here: the *limits* live in environment variables (tunable without a
-- deploy, per D7), and this table only holds the counts. `increment_rate_limit`
-- does the count; the caller compares it to the env-configured limit.
--
-- Only the server (service role) ever touches this table: the guest endpoints
-- run server-side and increment via the function using the admin client. anon
-- and authenticated get no grants, so a guest cannot read or reset their own
-- counter.
--
-- Rollback (manual, forward-only process — see DATABASE.md):
--   DROP FUNCTION public.increment_rate_limit(TEXT, TEXT, TIMESTAMPTZ);
--   DROP TABLE public.rate_limit_counters;

-- ---------------------------------------------------------------------------
-- rate_limit_counters — fixed-window counts keyed by (bucket, subject, window).
--
-- `bucket`       which limit ('guest_msg', 'guest_report', 'guest_session_turns')
-- `subject`      the thing being limited (an IP, or a guest session id)
-- `window_start` the start of the fixed window this count belongs to: UTC
--                midnight for the daily caps; a constant sentinel for the
--                per-session cap (the session id is itself the unique key, so
--                its whole lifetime is one window).
--
-- A new window means a new row, so counts reset automatically at the window
-- boundary without a scheduled job. Old rows accumulate but are tiny; a periodic
-- prune (out of scope here) can delete rows older than a day or two.

CREATE TABLE public.rate_limit_counters (
  bucket TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, subject, window_start)
);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
-- No grants to anon/authenticated and no policies: only service_role (which
-- bypasses RLS) can read or write. RLS-on with zero policies denies everyone
-- else outright, which is exactly what we want for a server-only counter.
GRANT ALL ON public.rate_limit_counters TO service_role;

-- ---------------------------------------------------------------------------
-- increment_rate_limit — atomically add one to a window's count and return the
-- new total. The INSERT ... ON CONFLICT DO UPDATE is a single statement, so
-- concurrent requests for the same key can't lose an increment (unlike a
-- select-then-write, which races). The limit is deliberately NOT a parameter:
-- the caller owns the threshold (env-configured, D7) and decides allow/deny
-- from the returned count, keeping limits tunable without a migration.

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_bucket TEXT,
  p_subject TEXT,
  p_window_start TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO public.rate_limit_counters (bucket, subject, window_start, count, updated_at)
  VALUES (p_bucket, p_subject, p_window_start, 1, now())
  ON CONFLICT (bucket, subject, window_start)
  DO UPDATE SET count = rate_limit_counters.count + 1, updated_at = now()
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

-- Callable only by the server (service role); never by anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(TEXT, TEXT, TIMESTAMPTZ) TO service_role;
