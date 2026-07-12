/**
 * Content-library Zod schemas — the single source of truth for the shape of
 * every curated content file (WP3.1, design §3.1–§3.3, §3.6).
 *
 * These schemas validate the *shape* of a record (types, closed enums, string
 * formats). They deliberately do NOT check open-vocabulary membership
 * (technologies, housing_types) or cross-file references (prerequisite /
 * media / source slugs) — those need the whole corpus plus the vocabulary
 * file, so they live in `validate.ts`, which aggregates them into
 * curator-actionable messages. Keeping shape here means the same schemas can
 * back the runtime table types when WP3.2 syncs `content/` to Supabase.
 *
 * Additive-only, like every other registry in this codebase (§11): never
 * rename a field, never narrow an enum, never reuse a slug.
 */

import { z } from "zod";
import { LANE_IDS, type LaneId } from "@/lib/lanes/playbooks";

// ---------------------------------------------------------------------------
// Shared primitives

/** Stable identifier format shared by every content entity (§3.1: "stable forever"). */
export const slugSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "slug must be lowercase kebab-case (e.g. 'community-solar-basics')",
  );

/** ISO calendar date (YYYY-MM-DD) — surfaced in the UI as `last_verified` / `expires`. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be an ISO calendar date (YYYY-MM-DD)")
  .refine((s) => !Number.isNaN(Date.parse(s)), "date is not a real calendar date");

/**
 * Region identifier — prefix-matched at retrieval time (§3.5), so the set is
 * open by design. We validate *format* only: an uppercase country code,
 * optionally a `-SUBDIVISION` (e.g. "US", "US-VA", "US-DC", "CA-ON").
 * Membership is intentionally not checked (see vocabulary.yaml header).
 */
export const regionSchema = z
  .string()
  .regex(
    /^[A-Z]{2}(?:-[A-Z0-9]+)*$/,
    "region must look like 'US' or 'US-VA' (uppercase, prefix-matched)",
  );

/** Targeting tenures for content are owner/renter only (§3.1). */
export const contentTenureSchema = z.enum(["owner", "renter"]);

/** Lane ids come from the code registry, not the vocabulary file (§11). */
export const laneIdSchema = z.enum(LANE_IDS as [LaneId, ...LaneId[]]);

// ---------------------------------------------------------------------------
// Closed enums (fixed in code — these axes do not grow via the vocabulary)

export const COMPONENT_KINDS = ["action", "explainer", "incentive", "resource", "caveat"] as const;
export const EFFORT_LEVELS = ["trivial", "weekend", "project", "major"] as const;
export const CONTENT_STATUSES = ["draft", "published", "retired"] as const;
export const MEDIA_KINDS = ["diagram", "photo", "illustration"] as const;

const impactLevelSchema = z.number().int().min(0).max(3) as z.ZodType<0 | 1 | 2 | 3>;

const nonEmpty = (label: string) => z.string().trim().min(1, `${label} is required`);

// ---------------------------------------------------------------------------
// Sources (§3.4 citations; synced to content_sources in WP3.2)
//
// Refinement of design §3.1: sources are their own slugged entity that
// components reference by slug, rather than an inline `{label,url,publisher}`
// array. This matches WP3.2's `content_sources` table and D4's rule that chat
// citations render from deterministic content_sources records — a source cited
// by several components is authored, verified, and dated in exactly one place.

export const sourceSchema = z.strictObject({
  slug: slugSchema,
  label: nonEmpty("source label"),
  url: z.string().url("source url must be a valid URL"),
  publisher: nonEmpty("source publisher"),
  last_verified: isoDateSchema,
});
export type ContentSource = z.infer<typeof sourceSchema>;

// ---------------------------------------------------------------------------
// Media (§3.2)

export const mediaSchema = z.strictObject({
  slug: slugSchema,
  kind: z.enum(MEDIA_KINDS),
  storage_path: nonEmpty("storage_path"),
  alt: nonEmpty("alt text"), // CI-required — accessibility
  caption: z.string().default(""),
  credit: z.strictObject({
    source: nonEmpty("credit.source"), // CI-required — we are republishing
    license: nonEmpty("credit.license"),
  }),
  technologies: z.array(z.string()).default([]),
  regions: z.array(regionSchema).default([]),
});
export type ContentMedia = z.infer<typeof mediaSchema>;

// ---------------------------------------------------------------------------
// Components (§3.1)
//
// `body_md` is the markdown body of the file (supplied by the loader from
// below the frontmatter), so it is NOT part of the frontmatter schema. The
// two are merged before validation; see `componentSchema` vs `componentFile`.

const impactSchema = z.strictObject({
  cost: impactLevelSchema,
  carbon: impactLevelSchema,
  comfort: impactLevelSchema,
  resilience: impactLevelSchema,
});

/** Full component record (frontmatter + `body_md` merged). */
export const componentSchema = z.strictObject({
  slug: slugSchema,
  kind: z.enum(COMPONENT_KINDS),
  title: nonEmpty("title"),
  summary: nonEmpty("summary"), // injected into chat context (§3.1)
  body_md: nonEmpty("body_md (markdown body)"),
  technologies: z.array(z.string()).default([]),
  lanes: z.array(laneIdSchema).default([]),
  tenures: z.array(contentTenureSchema).default([]),
  housing_types: z.array(z.string()).default([]),
  regions: z.array(regionSchema).default([]),
  prerequisites: z.array(slugSchema).default([]),
  effort: z.enum(EFFORT_LEVELS),
  impact: impactSchema,
  sources: z.array(slugSchema).default([]), // source slugs (resolved in validate.ts)
  last_verified: isoDateSchema,
  expires: isoDateSchema.optional(),
  status: z.enum(CONTENT_STATUSES),
  version: z.number().int().min(1, "version starts at 1 and only increases"),
  media: z.array(slugSchema).default([]), // media slugs (resolved in validate.ts)
});
export type ContentComponent = z.infer<typeof componentSchema>;

/**
 * The frontmatter half of a component file: everything except `body_md`,
 * which comes from the markdown body. Used by the loader before it merges the
 * body back in.
 */
export const componentFrontmatterSchema = componentSchema.omit({ body_md: true });

// ---------------------------------------------------------------------------
// Presets (§3.6)
//
// A preset's `profile_patches` are given a permissive shape here; validate.ts
// runs them through the real `applyPatches` against an empty profile and fails
// the preset if any patch is rejected — the profile patch pipeline stays the
// single source of truth for what a valid patch is.

const profilePatchShapeSchema = z.looseObject({
  op: z.enum(["set", "append", "clear"]),
  slot: z.string(),
  provenance: z.enum(["stated", "inferred", "edited", "propagated"]),
});

export const presetSchema = z.strictObject({
  slug: slugSchema,
  label: nonEmpty("label"),
  category: nonEmpty("category"),
  first_message: nonEmpty("first_message"),
  profile_patches: z.array(profilePatchShapeSchema).default([]),
  tenures: z.array(contentTenureSchema).default([]),
  regions: z.array(regionSchema).default([]),
});
export type ContentPreset = z.infer<typeof presetSchema>;

// ---------------------------------------------------------------------------
// Registry of content kinds — drives the loader and validator uniformly.

export type ContentEntityKind = "component" | "media" | "preset" | "source";

/** Where each entity kind lives and how a raw record is shape-checked. */
export const CONTENT_KIND_DIRS: Record<ContentEntityKind, string> = {
  component: "components",
  media: "media",
  preset: "presets",
  source: "sources",
};
