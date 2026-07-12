/**
 * Deploy-time content sync (WP3.2, design §3.4). Projects the validated
 * `content/` tree into the Supabase content tables by idempotent
 * upsert-by-slug — the tables are a cache of already-validated data, so this
 * is a pure, deterministic mapping plus a set of upserts.
 *
 * Two layers, mirroring the validator's split:
 *   - `buildSyncRows` is PURE (content → row payloads) and unit-tested for
 *     determinism; running it twice on the same content yields identical rows,
 *     which is what makes the sync idempotent.
 *   - `syncContent` executes the upserts. Cross-references are not DB foreign
 *     keys (the validator guarantees them at CI), so table order doesn't matter
 *     and a partial corpus can never wedge the sync.
 *
 * Slugs are stable forever (§11): sync never deletes. A component removed from
 * the repo leaves its row behind — retire content by setting `status: retired`,
 * not by deleting the file.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ValidatedContent } from "@/lib/content/validate";
import type { ContentMedia } from "@/lib/content/schema";

type Tables = Database["public"]["Tables"];
type Json = Database["public"]["Tables"]["content_components"]["Row"]["impact"];

export interface SyncRows {
  sources: Tables["content_sources"]["Insert"][];
  media: Tables["content_media"]["Insert"][];
  components: Tables["content_components"]["Insert"][];
  presets: Tables["content_presets"]["Insert"][];
}

const bySlug = <T extends { slug: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.slug.localeCompare(b.slug));

/** Pure projection of validated content into upsert payloads (deterministic). */
export function buildSyncRows(content: ValidatedContent): SyncRows {
  return {
    sources: bySlug(
      content.sources.map((s) => ({
        slug: s.slug,
        label: s.label,
        url: s.url,
        publisher: s.publisher,
        last_verified: s.last_verified,
      })),
    ),
    media: bySlug(
      content.media.map((m) => ({
        slug: m.slug,
        kind: m.kind,
        storage_path: m.storage_path,
        alt: m.alt,
        caption: m.caption,
        credit: m.credit as Json,
        technologies: m.technologies,
        regions: m.regions,
      })),
    ),
    components: bySlug(
      content.components.map((c) => ({
        slug: c.slug,
        kind: c.kind,
        title: c.title,
        summary: c.summary,
        body_md: c.body_md,
        technologies: c.technologies,
        lanes: c.lanes,
        tenures: c.tenures,
        housing_types: c.housing_types,
        regions: c.regions,
        prerequisites: c.prerequisites,
        effort: c.effort,
        impact: c.impact as Json,
        sources: c.sources,
        last_verified: c.last_verified,
        expires: c.expires ?? null,
        status: c.status,
        version: c.version,
        media: c.media,
      })),
    ),
    presets: bySlug(
      content.presets.map((p) => ({
        slug: p.slug,
        label: p.label,
        category: p.category,
        first_message: p.first_message,
        profile_patches: p.profile_patches as Json,
        tenures: p.tenures,
        regions: p.regions,
      })),
    ),
  };
}

export interface SyncCounts {
  sources: number;
  media: number;
  components: number;
  presets: number;
}

/**
 * Upsert every content record by slug. Throws on the first table error so the
 * deploy script can fail loudly (bad content should not ship). Requires a
 * service-role client — the content tables reject writes from anon/authenticated.
 */
export async function syncContent(
  client: SupabaseClient<Database>,
  content: ValidatedContent,
): Promise<SyncCounts> {
  const rows = buildSyncRows(content);

  const TABLE_NAME = {
    sources: "content_sources",
    media: "content_media",
    components: "content_components",
    presets: "content_presets",
  } as const;

  const upsert = async (key: keyof SyncRows): Promise<number> => {
    const payload = rows[key];
    if (payload.length === 0) return 0;
    const tableName = TABLE_NAME[key];
    const { error } = await client
      .from(tableName)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(payload as any, { onConflict: "slug" });
    if (error) throw new Error(`sync ${tableName} failed: ${error.message}`);
    return payload.length;
  };

  return {
    sources: await upsert("sources"),
    media: await upsert("media"),
    components: await upsert("components"),
    presets: await upsert("presets"),
  };
}

// ---------------------------------------------------------------------------
// Media binary upload (design §3.2 — the Supabase Storage side of sync)
//
// `syncContent` writes the media *metadata* rows (alt, credit, storage_path);
// the actual image bytes live in the `content-media` Storage bucket at each
// record's `storage_path`. Deploy must push both, or `[figure:<slug>]` (chat)
// and report figures resolve to a 404. Kept here, pure-ish and injectable
// (`readAsset` supplied by the caller), so it unit-tests without touching disk.

/** The world-readable Storage bucket curated media lives in (world-readable RLS). */
export const MEDIA_BUCKET = "content-media";

/** Content-type for a stored asset, by extension — Storage needs it explicitly. */
export function mediaContentType(storagePath: string): string {
  const ext = storagePath.slice(storagePath.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export interface MediaUploadResult {
  uploaded: number;
  /** storage_paths whose local asset was missing (never fatal — reported). */
  missing: string[];
  /** Per-asset upload errors (never fatal — reported). */
  errors: string[];
}

/**
 * Upload each media record's binary to the `content-media` bucket at its
 * `storage_path` (idempotent — `upsert: true`, so re-running is safe). Best
 * effort by design, mirroring `syncContent`'s caller: a missing local file or a
 * failed upload is *reported*, never thrown, so a media gap can't wedge a
 * deploy. `readAsset` returns the bytes for a `storage_path`, or null if the
 * file isn't present — injected so the caller owns disk access (and tests a fake).
 */
export async function uploadMediaAssets(
  client: SupabaseClient<Database>,
  media: ContentMedia[],
  readAsset: (storagePath: string) => Uint8Array | null,
): Promise<MediaUploadResult> {
  const result: MediaUploadResult = { uploaded: 0, missing: [], errors: [] };
  for (const m of bySlug(media)) {
    const bytes = readAsset(m.storage_path);
    if (bytes === null) {
      result.missing.push(m.storage_path);
      continue;
    }
    const { error } = await client.storage.from(MEDIA_BUCKET).upload(m.storage_path, bytes, {
      contentType: mediaContentType(m.storage_path),
      upsert: true,
    });
    if (error) result.errors.push(`${m.storage_path}: ${error.message}`);
    else result.uploaded += 1;
  }
  return result;
}
