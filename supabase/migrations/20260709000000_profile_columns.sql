-- Migration #1 for the personalization architecture (WP1.2, design §10).
-- Additive only: all columns nullable, no defaults that rewrite rows, no
-- renames — deployed code that predates this migration keeps working, and
-- code written against it tolerates NULLs (normalize-on-read, design §11).
--
-- Rollback (manual, forward-only process — see DATABASE.md):
--   ALTER TABLE public.sessions DROP COLUMN profile;
--   ALTER TABLE public.sessions DROP COLUMN readiness_reached_at;
--   ALTER TABLE public.profiles DROP COLUMN durable_profile;
--   ALTER TABLE public.messages DROP COLUMN parts;

-- The structured session profile (slot envelopes; src/lib/profile/registry.ts).
-- Written by the extractor (WP1.5); normalized on read, never migrated in SQL.
ALTER TABLE public.sessions ADD COLUMN profile JSONB;

-- Readiness ratchet (design §4.5): set when the readiness gate is first
-- reached, never cleared — a gate that moves backwards reads as a bug.
ALTER TABLE public.sessions ADD COLUMN readiness_reached_at TIMESTAMPTZ;

-- Opt-in carryover of durable slots at session end (design §4.6, WP1.10).
ALTER TABLE public.profiles ADD COLUMN durable_profile JSONB;

-- Structured message parts beyond plain text (quick-reply buttons, §5.4,
-- WP1.8). NULL = plain-text-only message (all existing rows).
ALTER TABLE public.messages ADD COLUMN parts JSONB;

-- No new GRANTs or RLS policies: these are columns on existing tables whose
-- row-level ownership policies already apply.
