/**
 * Server side of chat grounding (WP3.4). Reads the synced content tables and
 * hands the pure retriever (`buildRetrieved`) the library it needs, so both
 * chat endpoints get their grounding shortlist from one place.
 *
 * Forgiving by design, exactly like `getPresets` (WP3.2): any failure — tables
 * not migrated/synced yet, a preview with no service-role env, a transient
 * outage — yields an empty grounding set, never an exception. Grounding is an
 * enhancement; the chat reply must stream whether or not the library answered.
 * A draft-only corpus therefore produces no grounding, which is correct: the
 * agent simply talks without citations until content is published (C2).
 *
 * Reads only the columns retrieval needs (never `body_md` — the full text is for
 * reports and deep-dives, not the chat prompt), and pre-filters to `published`
 * so an unreviewed draft can never reach a user's conversation.
 */

import { buildRetrieved, DEFAULT_GROUNDING_LIMIT } from "@/lib/content/retrieval";
import type { ContentComponent, ContentMedia, ContentSource } from "@/lib/content/schema";
import type { SessionProfile } from "@/lib/profile/registry";
import type { RetrievedComponent } from "@/lib/prompts/context";

// The component columns the candidate pipeline + grounding shaping actually read.
const COMPONENT_COLUMNS =
  "slug, kind, title, summary, technologies, lanes, tenures, housing_types, regions, prerequisites, effort, impact, sources, last_verified, status, version, media";

/**
 * The grounding shortlist for a profile, read live from the content tables.
 * Returns `[]` on any problem — callers pass the result straight to
 * `buildContext({ retrieved })`, where an empty array simply omits grounding.
 */
export async function retrieveGrounding(
  profile: SessionProfile,
  limit: number = DEFAULT_GROUNDING_LIMIT,
): Promise<RetrievedComponent[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [componentsRes, sourcesRes, mediaRes] = await Promise.all([
      supabaseAdmin.from("content_components").select(COMPONENT_COLUMNS).eq("status", "published"),
      supabaseAdmin.from("content_sources").select("slug, label, publisher"),
      supabaseAdmin.from("content_media").select("slug, alt"),
    ]);

    if (componentsRes.error || !componentsRes.data) return [];

    // The tables are a projection of already-validated content (WP3.1/3.2), so
    // the rows conform to the schema shapes; cast at this trust boundary. Any
    // row that somehow doesn't is handled downstream (the pipeline reads a
    // fixed set of fields; a bad row simply doesn't match filters).
    const library = {
      components: componentsRes.data as unknown as ContentComponent[],
      sources: (sourcesRes.data ?? []) as unknown as ContentSource[],
      media: (mediaRes.data ?? []) as unknown as ContentMedia[],
    };

    return buildRetrieved(library, profile, limit);
  } catch {
    return [];
  }
}
