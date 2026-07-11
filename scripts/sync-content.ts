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

/**
 * A non-fatal skip must never be a silent one: print a delimited banner with
 * the reason and a concrete recommended action, so it stands out in build logs
 * and the reader knows exactly what to do.
 */
function warnBanner(reason: string, actions: string[]): void {
  const line = "─".repeat(64);
  console.warn(`\n${line}\n⚠  CONTENT SYNC SKIPPED — the deploy continues, but the`);
  console.warn(`   content tables were NOT updated.\n`);
  console.warn(`   Reason: ${reason}\n`);
  console.warn(`   Recommended action:`);
  for (const a of actions) console.warn(`     • ${a}`);
  console.warn(`${line}\n`);
}

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
  const missing = [
    ...(!process.env.SUPABASE_URL ? ["SUPABASE_URL"] : []),
    ...(!process.env.SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
  ].join(", ");
  warnBanner(
    `service-role env not set (${missing}). Content is valid, but there's no DB to write.`,
    [
      `Set ${missing} in this environment's variables (Vercel → Project → Settings → Environment Variables), then redeploy.`,
      `To sync locally, add them to .env and run \`bun run sync:content\`.`,
    ],
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
  // the app reads existing content and degrades gracefully — but surface it
  // loudly, with an action, so a persistently-failing sync is never silent.
  const message = (err as Error).message;
  // PostgREST reports a missing table as "Could not find the table … in the
  // schema cache"; Postgres itself says "relation … does not exist".
  const migrationMissing = /could not find the table|does not exist|schema cache/i.test(message);
  warnBanner(
    `the content tables could not be written: ${message}`,
    migrationMissing
      ? [
          `The content tables don't exist yet — apply migration #2 to this database:`,
          `\`bunx supabase link --project-ref <ref>\` then \`bunx supabase db push\` (see DATABASE.md).`,
          `Then redeploy, or run \`bun run sync:content\` to populate the tables.`,
        ]
      : [
          `Check SUPABASE_SERVICE_ROLE_KEY is valid for this database and that Supabase is reachable.`,
          `Re-run \`bun run sync:content\` (or redeploy) once resolved — upserts are idempotent.`,
        ],
  );
}
process.exit(0);
