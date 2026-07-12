/**
 * `bun run validate:content` — validates the `content/` tree and prints a
 * curator-actionable report (WP3.1, design §3.4). Runs in CI on content PRs
 * (see .github/workflows/ci.yml) and locally so curators get the same feedback
 * without a database or deploy. Exits non-zero when any file is invalid.
 */

import { join } from "node:path";
import { validateContent } from "@/lib/content/validate";

const ROOT = join(import.meta.dirname, "..");
const CONTENT_DIR = join(ROOT, "content");
const VOCAB_PATH = join(CONTENT_DIR, "vocabulary.yaml");

const { ok, issues, content } = validateContent(CONTENT_DIR, VOCAB_PATH);

if (ok) {
  const { components, media, presets, sources } = content;
  console.log(
    `✓ content OK — ${components.length} components, ${media.length} media, ` +
      `${presets.length} presets, ${sources.length} sources`,
  );
  process.exit(0);
}

// Group issues by file for a readable report.
const byFile = new Map<string, string[]>();
for (const { file, message } of issues) {
  const list = byFile.get(file) ?? [];
  list.push(message);
  byFile.set(file, list);
}

console.error(`✗ content validation failed — ${issues.length} issue(s):\n`);
for (const [file, messages] of [...byFile].sort()) {
  console.error(`  ${file}`);
  for (const m of messages) console.error(`    - ${m}`);
}
console.error("");
process.exit(1);
