/**
 * The report document — the structured, frozen artifact a report *is*
 * (WP3.5, design §7.1).
 *
 * The canonical report is this document, not the rendered page: every
 * surface (web now, docx/PDF in WP3.9) independently renders it. The
 * composer (WP3.6) produces it; the web renderer (ReportDocumentView)
 * consumes it; this module is the single source of truth for its shape.
 *
 * Section provenance is deliberately mixed and labelled here so no
 * downstream reader has to guess:
 * - `meta`, `about_you`, `sources` are **deterministic** — assembled
 *   from the profile and the cited components, zero model tokens.
 * - `your_goals`, `background`, `action_plan`, `open_questions` are
 *   **model-authored** (the composer's output), each item tagged
 *   `library` or `authored` so the renderer can mark not-yet-reviewed
 *   authored items (D20 hybrid mode).
 *
 * Frozen vs live (§7.1): everything here freezes at generation. In Tier A
 * the full ranked `action_plan` lives inside the document and disclosure
 * is *static* — items carry their own `revealed` flag (top few true).
 * WP4.1 later materialises these into `action_items` rows with live
 * state; the document was always the frozen source of truth, so that is
 * purely additive.
 *
 * Additive-only, like every registry here (§11): never rename a field,
 * never narrow an enum, never repurpose a key. When the shape must grow
 * incompatibly, bump `DOC_VERSION` and keep the old renderer path.
 */

import { z } from "zod";
import { sourceSchema, EFFORT_LEVELS } from "@/lib/content/schema";
import { LANE_PLAYBOOKS, type FramingId, type SectionSpec } from "@/lib/lanes/playbooks";
import { normalizeProfile } from "@/lib/profile/normalize";
import type { SessionProfile } from "@/lib/profile/registry";

/**
 * The document shape version, carried in `meta.doc_version`. Bumped only
 * on an incompatible change to the structure; the renderer keys off it so
 * historical documents keep rendering the way they were written (§10).
 */
export const DOC_VERSION = 1;

// ---------------------------------------------------------------------------
// Shared: where an item's substance came from (D20 hybrid mode)

/**
 * `library` — backed by a reviewed content component, cited.
 * `authored` — model-written for a topic whose candidate pool is thin;
 * rendered with an explicit "not yet from our reviewed library" tag and
 * capped per report (design §6.6). The end state is zero authored items.
 */
export const CONTENT_ORIGINS = ["library", "authored"] as const;
export const contentOriginSchema = z.enum(CONTENT_ORIGINS);
export type ContentOrigin = (typeof CONTENT_ORIGINS)[number];

// ---------------------------------------------------------------------------
// meta

/**
 * The readiness snapshot at generation (§4.5) — the score the header bar
 * shows and a record of whether the gate was actually open when this was
 * generated. Frozen: it describes the report's moment, not the live profile.
 */
export const reportReadinessSchema = z.object({
  score: z.number().int().min(0).max(100),
  ready: z.boolean(),
});
export type ReportReadiness = z.infer<typeof reportReadinessSchema>;

/**
 * Narrative framing the report was written in — a lane id or `mixed`
 * (§5.1). Derived from the playbook registry keys, so it stays exhaustive
 * over `FramingId` without a hand-maintained second list.
 */
export const FRAMING_IDS = Object.keys(LANE_PLAYBOOKS) as [FramingId, ...FramingId[]];
export const laneFramingSchema = z.enum(FRAMING_IDS);

export const reportMetaSchema = z.object({
  doc_version: z.number().int().min(1),
  /** ISO datetime the document was generated. */
  generated_at: z.string(),
  lane_framing: laneFramingSchema,
  readiness: reportReadinessSchema,
});
export type ReportMeta = z.infer<typeof reportMetaSchema>;

// ---------------------------------------------------------------------------
// about_you — the profile snapshot, rendered by the sidebar verbatim (§7.1)
//
// Deterministic and user-correctable: it is the same data the profile
// sidebar shows ("here's what we based this on"). Stored as the frozen
// SessionProfile and read tolerantly — a snapshot from an older bundle
// still renders — so it is normalised on parse rather than strictly typed.

export const aboutYouSchema = z
  .unknown()
  .transform((raw): SessionProfile => normalizeProfile(raw));

// ---------------------------------------------------------------------------
// your_goals — model-authored headline + intro (§7.1)

export const yourGoalsSchema = z.object({
  headline: z.string(),
  intro: z.string(),
});
export type YourGoals = z.infer<typeof yourGoalsSchema>;

// ---------------------------------------------------------------------------
// background — selected explainer components, frozen (§7.1)
//
// The explainers' full body_md is frozen into the document so the report
// reads on its own without a live library join. Flexes by lane: in
// `learning` this section *is* the report; in action-first lanes it
// collapses to a couple of entries (the playbook's `report_sections`
// emphasis, applied by the renderer).

export const backgroundEntrySchema = z.object({
  /** Library component slug, or null for an authored explainer (D20). */
  component_slug: z.string().nullable(),
  title: z.string(),
  /** Full markdown body, rendered as prose. */
  body_md: z.string(),
  origin: contentOriginSchema,
  /** Source slugs this entry draws on — union feeds the `sources` section. */
  sources: z.array(z.string()).default([]),
});
export type BackgroundEntry = z.infer<typeof backgroundEntrySchema>;

// ---------------------------------------------------------------------------
// action_plan — the ranked item list (§7.1, seam 1)
//
// In Tier A the full ranked list lives here and disclosure is static:
// `revealed` items render, the rest are held back as a teaser. Array
// order is the rank. WP4.1 materialises these into rows with live state.

export const actionItemSchema = z.object({
  /** Library component slug, or null for an authored / bespoke item (D20). */
  component_slug: z.string().nullable(),
  title: z.string(),
  /** The "why this fits you" the composer wrote for this household. */
  personalization: z.string(),
  effort: z.enum(EFFORT_LEVELS).optional(),
  origin: contentOriginSchema,
  /** Static disclosure gate: top few true, the rest held back (seam 1). */
  revealed: z.boolean(),
  sources: z.array(z.string()).default([]),
});
export type ActionItem = z.infer<typeof actionItemSchema>;

// ---------------------------------------------------------------------------
// sources — deterministic union of the cited components' sources (§7.1, D4)
//
// Frozen full citation records (not just slugs) so a frozen report renders
// its sources without a live lookup and never drifts if the library
// re-verifies later. Same fields as a content_sources row.

export const sourceCitationSchema = sourceSchema;
export type SourceCitation = z.infer<typeof sourceCitationSchema>;

// ---------------------------------------------------------------------------
// The document

export const reportDocumentSchema = z.object({
  meta: reportMetaSchema,
  about_you: aboutYouSchema,
  your_goals: yourGoalsSchema,
  background: z.array(backgroundEntrySchema).default([]),
  action_plan: z.array(actionItemSchema).default([]),
  open_questions: z.array(z.string()).default([]),
  sources: z.array(sourceCitationSchema).default([]),
});

/**
 * The parsed document. `about_you` is normalised to a `SessionProfile`, so
 * the output type differs from the raw input — always read a document
 * through `parseReportDocument`, never trust a raw JSONB blob.
 */
export type ReportDocument = z.infer<typeof reportDocumentSchema>;

/**
 * Parse an untrusted `reports.document` blob into a `ReportDocument`, or
 * `null` if it isn't one (e.g. a legacy report with no document). Never
 * throws — the renderer falls back to the legacy path on null.
 */
export function parseReportDocument(raw: unknown): ReportDocument | null {
  if (raw === null || raw === undefined) return null;
  const result = reportDocumentSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// Section layout (pure) — the lane playbook's order + emphasis (§7.1)

/**
 * The ordered sections for a document, with each section's emphasis from
 * the lane playbook (`background` full in `learning`, collapsed in
 * action-first lanes; `action_plan` collapsed in `learning`). Pure, so the
 * renderer and any export share one layout decision. `mixed` and any
 * unknown framing fall back to the standard section order.
 */
export function documentSections(doc: ReportDocument): SectionSpec[] {
  return LANE_PLAYBOOKS[doc.meta.lane_framing].report_sections;
}
