-- Migration for the contact / feedback form.
-- Additive only: one new table. No existing table is touched.
--
-- The contact form is public — guests and signed-in users can both submit — so
-- writes happen server-side through the service-role admin client (see
-- src/lib/contact.functions.ts), never directly from the browser. Mirroring
-- rate_limit_counters (20260712000000_guest_rate_limits.sql), the table has RLS
-- enabled with no anon/authenticated policies: RLS-on with zero policies denies
-- everyone except service_role (which bypasses RLS). That keeps submissions
-- readable only by the server / Supabase dashboard, not by other users.
--
-- Rollback (manual, forward-only process — see DATABASE.md):
--   DROP TABLE public.contact_submissions;

-- ---------------------------------------------------------------------------
-- contact_submissions — one row per message sent through the contact/feedback
-- form.
--
-- `category`    the kind of message: 'bug' | 'suggestion' | 'question' |
--               'praise' | 'other' (also enforced by the server's zod schema).
-- `message`     the free-text body.
-- `reply_email` optional address the sender left for follow-up (nullable).
-- `user_id`     the auth.users id when a signed-in user submitted; NULL for a
--               guest. ON DELETE SET NULL so deleting an account doesn't erase
--               the (already-actioned) submission, just detaches it.

CREATE TABLE public.contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('bug', 'suggestion', 'question', 'praise', 'other')),
  message TEXT NOT NULL,
  reply_email TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
-- No grants to anon/authenticated and no policies: only service_role (which
-- bypasses RLS) can read or write. RLS-on with zero policies denies everyone
-- else outright, which is exactly what we want for a server-written table.
GRANT ALL ON public.contact_submissions TO service_role;
