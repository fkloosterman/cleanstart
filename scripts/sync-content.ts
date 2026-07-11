/**
 * `bun run sync:content` — validates the `content/` tree and upserts it into
 * the Supabase content tables (WP3.2, design §3.4). Runs on deploy via
 * vercel.json's buildCommand (Preview → dev DB, Production → prod DB, by
 * Vercel's environment-scoped vars) and can be run manually.
 *
 * Behavior, by situation:
 *   - content invalid            → exit 1 (bad content must not ship)
 *   - service-role env absent    → skip with a warning, exit 0 (e.g. a preview
 *                                  build with no DB access — don't break builds)
 *   - env present, upsert fails  → exit 1
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
  process.exit(0);
} catch (err) {
  console.error(`✗ content sync failed: ${(err as Error).message}`);
  process.exit(1);
}
