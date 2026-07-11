/**
 * Chat grounding retrieval (WP3.4, design §6.1–§6.2). Pure: given the content
 * library and a session profile, produce the small ordered set of curated
 * summaries the context builder injects as grounding — the same candidate
 * pipeline the composer uses (WP3.3 `selectCandidates`), so chat and reports
 * agree on what a user should see.
 *
 * Retrieval here is *profile-driven*, not query-driven: Tier A has no semantic
 * search, so the shortlist is the top eligible components for the household's
 * tenure / region / interests / lane. That is deliberate — the grounding keeps
 * the agent factually anchored across the whole conversation, and the agent
 * decides per turn which of these entries a given answer actually draws on
 * (citing them inline with [cite:<slug>], §D4).
 *
 * This module only *selects and shapes* — it resolves each component's source
 * slugs to citation labels and its media slugs to figure references, so the
 * grounding block can name them. Reading the DB is the server layer's job
 * (retrieval.server.ts); keeping selection pure means it is unit-tested without
 * a database, exactly like the corpus survey (WP3.3b).
 */

import { selectCandidates } from "@/lib/content/candidates";
import type { ContentComponent, ContentMedia, ContentSource } from "@/lib/content/schema";
import type { SessionProfile } from "@/lib/profile/registry";
import type { RetrievedComponent } from "@/lib/prompts/context";

/** How many grounding entries to inject by default (a focused set, not the world). */
export const DEFAULT_GROUNDING_LIMIT = 6;

export interface RetrievalLibrary {
  components: ContentComponent[];
  sources: ContentSource[];
  media: ContentMedia[];
}

/**
 * The grounding shortlist for a profile: the top eligible components, each with
 * its citation sources and available figures resolved from slugs to the labels
 * the agent needs. Unknown source/media slugs are dropped silently — the CI
 * content validator (WP3.1) already guarantees references resolve, so a miss
 * here only happens mid-migration, and a missing citation must never break a
 * reply.
 */
export function buildRetrieved(
  library: RetrievalLibrary,
  profile: SessionProfile,
  limit: number = DEFAULT_GROUNDING_LIMIT,
): RetrievedComponent[] {
  const sourceBySlug = new Map(library.sources.map((s) => [s.slug, s]));
  const mediaBySlug = new Map(library.media.map((m) => [m.slug, m]));

  return selectCandidates(library.components, profile, { limit }).map(({ component }) => {
    const sources = component.sources
      .map((slug) => sourceBySlug.get(slug))
      .filter((s): s is ContentSource => s !== undefined)
      .map((s) => ({ label: s.label, publisher: s.publisher }));

    const figures = component.media
      .map((slug) => mediaBySlug.get(slug))
      .filter((m): m is ContentMedia => m !== undefined)
      .map((m) => ({ slug: m.slug, alt: m.alt }));

    const entry: RetrievedComponent = {
      slug: component.slug,
      title: component.title,
      summary: component.summary,
    };
    if (sources.length > 0) entry.sources = sources;
    if (figures.length > 0) entry.figures = figures;
    return entry;
  });
}
