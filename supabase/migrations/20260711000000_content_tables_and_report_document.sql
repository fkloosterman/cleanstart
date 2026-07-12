-- Migration #2 for the personalization architecture (WP3.2, design §3, §10).
-- Additive only: four new content tables, one nullable column on reports, and a
-- storage bucket. No renames, no changes to existing rows — deployed code that
-- predates this migration keeps working, and code written against it tolerates
-- empty tables (sync populates them on deploy).
--
-- The content tables are a *projection of the git-first content/ tree*
-- (src/lib/content), synced by scripts/sync-content.ts on deploy. They are
-- world-readable (anon + authenticated SELECT) and service-role writable only —
-- the app never writes them at runtime. Cross-references between records
-- (a component's sources/media/prerequisites) are enforced at CI by the content
-- validator (WP3.1), NOT by database foreign keys: the DB is a cache of already
-- validated data, so we avoid FK-ordering constraints during sync.
--
-- Rollback (manual, forward-only process — see DATABASE.md):
--   DROP TABLE public.content_presets;
--   DROP TABLE public.content_components;
--   DROP TABLE public.content_media;
--   DROP TABLE public.content_sources;
--   ALTER TABLE public.reports DROP COLUMN document;
--   DELETE FROM storage.buckets WHERE id = 'content-media';
--   DROP POLICY "Public read content-media" ON storage.objects;

-- ---------------------------------------------------------------------------
-- Sources (§3.4) — a citation authored once, referenced by components by slug.

CREATE TABLE public.content_sources (
  slug TEXT NOT NULL PRIMARY KEY,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  publisher TEXT NOT NULL,
  last_verified DATE NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Media (§3.2) — curated images; the app resolves media slugs to storage URLs.

CREATE TABLE public.content_media (
  slug TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  alt TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  credit JSONB NOT NULL,               -- { source, license }
  technologies TEXT[] NOT NULL DEFAULT '{}',
  regions TEXT[] NOT NULL DEFAULT '{}',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Components (§3.1) — the atoms of advice; `impact` is the ranking vector.

CREATE TABLE public.content_components (
  slug TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,               -- injected into chat context (WP3.4)
  body_md TEXT NOT NULL,               -- full text; reports + deep-dives only
  technologies TEXT[] NOT NULL DEFAULT '{}',
  lanes TEXT[] NOT NULL DEFAULT '{}',
  tenures TEXT[] NOT NULL DEFAULT '{}',
  housing_types TEXT[] NOT NULL DEFAULT '{}',
  regions TEXT[] NOT NULL DEFAULT '{}',
  prerequisites TEXT[] NOT NULL DEFAULT '{}',  -- component slugs (progressive disclosure)
  effort TEXT NOT NULL,
  impact JSONB NOT NULL,               -- { cost, carbon, comfort, resilience }
  sources TEXT[] NOT NULL DEFAULT '{}',        -- content_sources slugs
  last_verified DATE NOT NULL,
  expires DATE,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  media TEXT[] NOT NULL DEFAULT '{}',          -- content_media slugs
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Retrieval (WP3.4) filters by these categorical tags; GIN indexes make the
-- array-overlap (&&) / contains (@>) queries cheap.
CREATE INDEX idx_content_components_technologies ON public.content_components USING GIN (technologies);
CREATE INDEX idx_content_components_lanes ON public.content_components USING GIN (lanes);
CREATE INDEX idx_content_components_regions ON public.content_components USING GIN (regions);
CREATE INDEX idx_content_components_status ON public.content_components (status);

-- ---------------------------------------------------------------------------
-- Presets (§3.6) — a starting point: a first message + profile warm-start
-- patches. Retires the hardcoded CHIPS list (WP3.2).

CREATE TABLE public.content_presets (
  slug TEXT NOT NULL PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  first_message TEXT NOT NULL,
  profile_patches JSONB NOT NULL DEFAULT '[]',
  tenures TEXT[] NOT NULL DEFAULT '{}',
  regions TEXT[] NOT NULL DEFAULT '{}',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- RLS + grants: world-readable, service-role writable (design §10).
-- service_role bypasses RLS, so no write policy is needed — the absence of one
-- plus SELECT-only grants to anon/authenticated is what makes these read-only
-- at runtime.

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['content_sources','content_media','content_components','content_presets']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
    EXECUTE format(
      'CREATE POLICY "Content is world-readable" ON public.%I FOR SELECT TO anon, authenticated USING (true);',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- reports.document (design §7.1) — the structured ReportDocument, with
-- doc_version inside. Written by the composer (WP3.6); NULL for all existing
-- rows, which keep rendering via the legacy columns (D5, frozen forever).
-- Batched here so WP3.6 needs no migration of its own.

ALTER TABLE public.reports ADD COLUMN document JSONB;

-- ---------------------------------------------------------------------------
-- Storage bucket for media (design §3.2). Public read: the report renderer and
-- chat resolve media slugs to public storage URLs. Uploads are service-role
-- only (the sync/admin path), which bypasses these policies.

INSERT INTO storage.buckets (id, name, public)
VALUES ('content-media', 'content-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read content-media" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'content-media');
