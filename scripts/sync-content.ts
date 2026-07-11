/**
 * `bun run sync:content` — validates the `content/` tree and upserts it into
 * the Supabase content tables (WP3.2, design §3.4). Runs on deploy via
 * vercel.json's buildCommand (Preview → dev DB, Production → prod DB, by
 * Vercel's environment-scoped vars) and can be run manually.
 *
 * Behavior, by situation:
 *   - content invalid            → exit 1 (a curator error we control; must not
 *                                  ship — this is the only hard failure)
 *   - service-role env absent    → skip with a warning, exit 0 (e.g. a preview
 *                                  build with no DB access)
 *   - env present, upsert fails  → warn, exit 0 (best-effort projection: a DB
 *                                  that isn't ready — e.g. the migration hasn't
 *                                  been applied yet — must NOT block the deploy;
 *                                  the app reads whatever content is already
 *                                  there, or none, and degrades gracefully)
 *   - success                    → print per-table counts, exit 0
 */

import { join } from "node:path";
import { validateContent } from "@/lib/content/validate";
import { syncContent } from "@/lib/content/sync";

const ROOT = join(import.meta.dirname, "..");
const CONTENT_DIR = join(ROOT, "content");
const VOCAB_PATH = join(CONTENT_DIR, "vocabulary.yaml");

const { ok, issues, content } = validateContent(CONTENT_DIR, VOCAB_PATH);
if (!ok) {
  console.error(`✗ content is invalid — refusing to sync (${issues.length} issue(s)):`);
  for (const { file, message } of issues) console.error(`  ${file}: ${message}`);
  console.error("Run `bun run validate:content` for the full grouped report.");
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "⚠ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping content sync " +
      "(content is valid). Set them in the deploy environment to enable sync.",
  );
  process.exit(0);
}

const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

try {
  const counts = await syncContent(supabaseAdmin, content);
  console.log(
    `✓ content synced — ${counts.components} components, ${counts.media} media, ` +
      `${counts.presets} presets, ${counts.sources} sources`,
  );
} catch (err) {
  // Non-fatal by design: the content is valid, but the DB couldn't be written
  // (migration not applied yet, transient outage, bad key). Deploy anyway —
  // the app reads existing content and degrades gracefully — and surface it
  // loudly so a persistently-failing sync is visible in build logs.
  console.warn(`⚠ content sync skipped — DB not updated: ${(err as Error).message}`);
}
process.exit(0);
