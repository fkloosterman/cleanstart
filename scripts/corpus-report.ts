/**
 * `bun run corpus-report` — the corpus coverage survey (WP3.3b, design §6.6).
 *
 * Runs the *production* candidate pipeline (WP3.3) over a grid of synthetic
 * profiles spanning the D9 launch scope and prints how complete the library is:
 * candidate-pool size per cell (worst first), lane / technology coverage, kind
 * mix, prerequisite reachability, freshness, orphans, and the projected
 * authored share that is WP3.6's merge gate. Reads `content/` directly — no
 * database, no deploy — so a curator sees the thinnest cells locally.
 *
 * Runs in CI as *informational* output on content PRs (exit 0 regardless), so
 * curators get the survey without it blocking a PR. WP3.6 turns the gate hard.
 *
 * Flags:
 *   --json   emit the full report as JSON (for WP3.6's gate / tooling)
 *   --gate   exit non-zero if projected authored share exceeds the cap
 *            (off by default — the gate is WP3.6's to enforce)
 */

import { join } from "node:path";
import { validateContent } from "@/lib/content/validate";
import { buildCorpusReport, formatCorpusReport } from "@/lib/content/corpus-report";

const ROOT = join(import.meta.dirname, "..");
const CONTENT_DIR = join(ROOT, "content");
const VOCAB_PATH = join(CONTENT_DIR, "vocabulary.yaml");

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const enforceGate = args.has("--gate");

// The report runs on the shape-valid records `validateContent` returns even when
// corpus-level issues exist — a broken cross-reference shouldn't blind a curator
// to coverage. Surface any validation issues as a pointer, never a hard stop.
const { ok, issues, content } = validateContent(CONTENT_DIR, VOCAB_PATH);

const report = buildCorpusReport(content);

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  if (!ok) {
    console.warn(
      `⚠  content has ${issues.length} validation issue(s) — run \`bun run validate:content\` ` +
        `for details. Reporting on the shape-valid records below.\n`,
    );
  }
  console.log(formatCorpusReport(report));
}

if (enforceGate && !report.gate.withinCap) {
  console.error(
    `\n✗ projected authored share ${Math.round(report.gate.maxAuthoredShare * 100)}% ` +
      `exceeds the ${Math.round(report.gate.cap * 100)}% cap (worst cell: ${report.gate.worstCell}).`,
  );
  process.exit(1);
}

process.exit(0);
