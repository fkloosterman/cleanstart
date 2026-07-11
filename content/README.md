# Content library

Git-first content for the personalization engine (design §3, WP3.1). Curators
edit markdown/YAML here; CI validates it (`bun run validate:content`); WP3.2
will sync it to Supabase on deploy (idempotent upsert-by-slug). PRs give
review, git gives history — no admin UI.

## Layout

```
content/
  vocabulary.yaml        # the tag vocabulary — open targeting axes (see below)
  components/*.md        # YAML frontmatter + markdown body (the body becomes body_md)
  media/*.yaml           # curated images (alt + credit required)
  presets/*.yaml         # starting points: a profile pre-fill + a first message
  sources/*.yaml         # citations, referenced by components via slug
```

Slugs are **stable forever** and lowercase kebab-case. They are the identity
of a record across the repo and the database; never rename or reuse one
(design §11) — retire and add a new one instead.

## The four record types

- **Components** (`components/*.md`) — the atoms of advice: an `action`,
  `explainer`, `incentive`, `resource`, or `caveat`. Frontmatter carries the
  targeting tags, the `impact` vector (the ranking engine, §3.1), lifecycle
  (`status`, `version`, `last_verified`), and references (`prerequisites`,
  `media`, `sources`). The markdown body below the frontmatter becomes
  `body_md`. See `components/heat-pump-basics.md` for the full shape.
- **Media** (`media/*.yaml`) — curated images. `alt` and `credit` (source +
  license) are CI-required: we republish, so attribution and accessibility are
  not optional.
- **Presets** (`presets/*.yaml`) — a chip: a `first_message` plus
  `profile_patches` that warm-start the profile. The patches are validated
  against the real profile patch pipeline — an invalid patch fails CI.
  Preset `tenures` are display targeting, and **tenure-exclusive**: a homeowner
  sees only `tenures: [owner]` presets, a renter only `tenures: [renter]`, and
  a "not sure yet" visitor only the general set (`tenures: []`). Keep each
  tenure's set small — the opening screen shows them all, unscrolled.
- **Sources** (`sources/*.yaml`) — a citation authored once and referenced by
  slug from any number of components. Chat citations render from these records
  (D4), so a source's `url`, `publisher`, and `last_verified` live in one place.

## The tag vocabulary

`vocabulary.yaml` is the single source of truth for the **open** targeting axes
(`technologies`, `housing_types`). Adding a tag is one line there; using a tag
that isn't listed fails validation. The **closed** axes (component `kind`,
`effort`, `status`, `tenures`, `impact` levels) are fixed enums in
`src/lib/content/schema.ts`; `lanes` come from the code lane registry
(`src/lib/lanes/playbooks.ts`) because adding a lane is an expensive
library-wide backfill, not a data edit (§11). `regions` are prefix-matched
identifiers (`US`, `US-VA`, …) validated by format, not membership.

## Validating

```
bun run validate:content
```

CI runs this on every PR. It checks: frontmatter/YAML parses, every record
matches its schema (unknown fields are rejected — fail loud on typos), media
`alt`/`credit` present, tags are in the vocabulary, and every
`prerequisites` / `media` / `sources` reference resolves to a real slug (with
no prerequisite cycles). Errors are grouped by file with an actionable message.

## Seed content

The `heat-pump-*` files and the single media/preset/source here are
**seed/template** records (`status: draft`) that demonstrate every field and
cross-reference. The real launch corpus (US-national + DMV pilot, each with a
named reviewer) is content-workstream C2.
