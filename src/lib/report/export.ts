/**
 * Export projections of a ReportDocument (WP3.9, design §7.2).
 *
 * The canonical report is the structured document; the web view is its
 * *living* rendering, and an export is a *frozen projection* — never a
 * snapshot of the page. This module is the single traversal every export
 * format shares: it turns a `ReportDocument` into an ordered list of
 * `ExportBlock`s that encode §7.2's frozen semantics once, so PDF, Word,
 * Markdown and plain text can't drift from each other.
 *
 * Frozen semantics baked in here (§7.2):
 * - The section order and per-lane emphasis come from `documentSections`,
 *   the same pure layout decision the web renderer uses — so an export
 *   reads in the same shape as the page it came from.
 * - Static disclosure (seam 1): only `revealed` action items are
 *   projected; held-back items are *omitted* and summarised as a count,
 *   never leaked into the frozen artifact.
 * - An "as of {date}" stamp and a closing "your live plan may have
 *   progressed — see the web version" footer, so a printed copy never
 *   pretends to be live.
 * - Authored (D20 hybrid) items carry their "not yet from our reviewed
 *   library" label into the export too.
 *
 * Figures: the document's background entries may carry curated figures, but
 * D18 defers export rasterisation — so rather than embed images, the export
 * carries each figure's alt text as a muted "see web version" line, keeping the
 * information without the binary. The block model is pure and unit-tested; the
 * binary formats (PDF via jsPDF, docx) are thin walkers over these blocks at the
 * UI edge.
 */

import { buildSidebarModel, type SidebarValue } from "@/lib/profile/sidebar";
import { documentSections, type ReportDocument } from "@/lib/report/document";
import type { ReportSectionId } from "@/lib/lanes/playbooks";

/** The download filename stem, shared by every format. */
export const REPORT_EXPORT_FILENAME_BASE = "clean-start-report";

const DOC_TITLE = "Clean Start — Your Research Summary";

const DOC_SUBTITLE =
  "A calm overview of what we discussed, what fits your situation, and small steps you can take next.";

const GUIDANCE_FOOTER =
  "Generated for guidance — always verify details with qualified local pros before committing to a project.";

/** D20's resolved label for authored (not-yet-reviewed) items. */
const AUTHORED_LABEL = "General guidance — not yet from our reviewed library";

const EFFORT_LABELS: Record<string, string> = {
  trivial: "Quick",
  weekend: "A weekend",
  project: "A project",
  major: "Major",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Format an ISO instant as "July 11, 2026" in UTC — deterministic across
 * machines and test runners (no locale/timezone drift), which matters for
 * a frozen artifact whose exports are snapshot-tested.
 */
function formatFrozenDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// The block model — one intermediate representation every format renders.

/**
 * A single projected block. `p` blocks may carry Markdown prose in `text`
 * (`markdown: true`) — the Markdown renderer passes it through untouched,
 * while plain-text/PDF/docx run it through `stripMarkdown`.
 */
export type ExportBlock =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string; markdown?: boolean }
  | { kind: "muted"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "kv"; label: string; value: string }
  | { kind: "source"; label: string; detail: string; url: string };

function sidebarValueToText(value: SidebarValue): string {
  switch (value.type) {
    case "scalar":
      return value.text;
    case "list":
      return value.items.join(", ");
    case "stances":
      return value.groups
        .map((g) => `${g.label}: ${g.entries.map((e) => e.label).join(", ")}`)
        .join("; ");
  }
}

// ---------------------------------------------------------------------------
// Section projectors — each returns the blocks for one section, or [] when
// the section is empty (so an export never prints a bare, contentless
// heading; matches the web renderer's "return null" on empty sections).

function projectAboutYou(doc: ReportDocument): ExportBlock[] {
  const model = buildSidebarModel(doc.about_you);
  const groups = model
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.filled && f.value) }))
    .filter((g) => g.fields.length > 0);
  if (groups.length === 0) return [];

  const blocks: ExportBlock[] = [{ kind: "h2", text: "What we based this on" }];
  for (const group of groups) {
    blocks.push({ kind: "h3", text: group.label });
    for (const field of group.fields) {
      blocks.push({ kind: "kv", label: field.label, value: sidebarValueToText(field.value!) });
    }
  }
  return blocks;
}

function projectGoals(doc: ReportDocument): ExportBlock[] {
  return [
    { kind: "h2", text: doc.your_goals.headline },
    { kind: "p", text: doc.your_goals.intro, markdown: true },
  ];
}

function projectBackground(doc: ReportDocument, emphasis: string): ExportBlock[] {
  if (doc.background.length === 0) return [];
  const heading = emphasis === "full" ? "Understanding the space" : "Background";
  const blocks: ExportBlock[] = [{ kind: "h2", text: heading }];
  for (const entry of doc.background) {
    blocks.push({ kind: "h3", text: entry.title });
    if (entry.origin === "authored") blocks.push({ kind: "muted", text: AUTHORED_LABEL });
    blocks.push({ kind: "p", text: entry.body_md, markdown: true });
    // D18 defers figure rasterisation: rather than drop a curated diagram from
    // the printed copy, carry its description as text so the information isn't lost.
    for (const figure of entry.figures) {
      blocks.push({ kind: "muted", text: `Figure (see web version): ${figure.alt}` });
    }
  }
  return blocks;
}

function projectActionPlan(doc: ReportDocument): ExportBlock[] {
  const revealed = doc.action_plan.filter((i) => i.revealed);
  const heldBack = doc.action_plan.length - revealed.length;
  if (revealed.length === 0) return [];

  const blocks: ExportBlock[] = [{ kind: "h2", text: "Your action plan" }];
  revealed.forEach((item, i) => {
    const effort = item.effort ? EFFORT_LABELS[item.effort] : undefined;
    blocks.push({
      kind: "h3",
      text: effort ? `${i + 1}. ${item.title} (${effort})` : `${i + 1}. ${item.title}`,
    });
    if (item.origin === "authored") blocks.push({ kind: "muted", text: AUTHORED_LABEL });
    blocks.push({ kind: "p", text: item.personalization, markdown: true });
  });
  // Held-back items are omitted from the frozen artifact (§7.2) and only
  // summarised — the plan grows on the web, not in a printed copy.
  if (heldBack > 0) {
    blocks.push({
      kind: "muted",
      text: `${heldBack} more ${heldBack === 1 ? "step" : "steps"} in your plan — revealed as you make progress in the web version.`,
    });
  }
  return blocks;
}

function projectOpenQuestions(doc: ReportDocument): ExportBlock[] {
  if (doc.open_questions.length === 0) return [];
  return [
    { kind: "h2", text: "Open questions" },
    ...doc.open_questions.map((q): ExportBlock => ({ kind: "bullet", text: q })),
  ];
}

function projectSources(doc: ReportDocument): ExportBlock[] {
  if (doc.sources.length === 0) return [];
  return [
    { kind: "h2", text: `Sources (${doc.sources.length})` },
    ...doc.sources.map(
      (s): ExportBlock => ({
        kind: "source",
        label: s.label,
        detail: `${s.publisher} · verified ${s.last_verified}`,
        url: s.url,
      }),
    ),
  ];
}

const SECTION_PROJECTORS: Record<
  ReportSectionId,
  (doc: ReportDocument, emphasis: string) => ExportBlock[]
> = {
  about_you: (doc) => projectAboutYou(doc),
  your_goals: (doc) => projectGoals(doc),
  background: (doc, emphasis) => projectBackground(doc, emphasis),
  action_plan: (doc) => projectActionPlan(doc),
  open_questions: (doc) => projectOpenQuestions(doc),
  sources: (doc) => projectSources(doc),
};

/**
 * Project a report document into the ordered block list every export
 * format renders. Pure and total — a `minimal` document yields just the
 * header, goals and footer, never an empty section heading.
 */
export function projectReportDocument(doc: ReportDocument): ExportBlock[] {
  const generatedAt = formatFrozenDate(doc.meta.generated_at);

  const blocks: ExportBlock[] = [
    { kind: "h1", text: DOC_TITLE },
    { kind: "muted", text: DOC_SUBTITLE },
  ];
  if (generatedAt) blocks.push({ kind: "muted", text: `As of ${generatedAt}.` });
  blocks.push({ kind: "muted", text: `Readiness: ${doc.meta.readiness.score}/100` });

  for (const spec of documentSections(doc)) {
    blocks.push(...SECTION_PROJECTORS[spec.id](doc, spec.emphasis));
  }

  blocks.push({ kind: "muted", text: GUIDANCE_FOOTER });
  if (generatedAt) {
    blocks.push({
      kind: "muted",
      text: `This is a snapshot as of ${generatedAt}. Your live plan may have progressed — see the web version.`,
    });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Markdown stripping — for the plain formats (text, PDF, docx) that render
// a document's Markdown-bearing prose (`body_md`, intros, personalization)
// as flat text. Intentionally small: it flattens the emphasis/heading/link
// syntax the composer and library actually emit, not a full parser.

export function stripMarkdown(md: string): string {
  return md
    .split("\n")
    .map(
      (line) =>
        line
          .replace(/^\s{0,3}#{1,6}\s+/, "") // atx headings
          .replace(/^\s{0,3}>\s?/, "") // blockquotes
          .replace(/^(\s*)[-*+]\s+/, "$1• ") // bullet markers
          .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)") // links → text (url)
          .replace(/\*\*([^*]+)\*\*/g, "$1") // bold **
          .replace(/__([^_]+)__/g, "$1") // bold __
          .replace(/\*([^*]+)\*/g, "$1") // italic *
          .replace(/`([^`]+)`/g, "$1"), // inline code
    )
    .join("\n")
    .trim();
}

/** Flatten possibly-Markdown block text for a plain format. */
function plainText(block: Extract<ExportBlock, { kind: "p" }>): string {
  return block.markdown ? stripMarkdown(block.text) : block.text;
}

// ---------------------------------------------------------------------------
// Text renderers (pure) — the binary formats live at the UI edge because
// they need the browser-only jsPDF/docx libraries.

/** Render blocks as Markdown; Markdown-bearing prose passes through as-is. */
export function reportToMarkdown(doc: ReportDocument): string {
  const parts: string[] = [];
  for (const b of projectReportDocument(doc)) {
    switch (b.kind) {
      case "h1":
        parts.push(`# ${b.text}`);
        break;
      case "h2":
        parts.push(`## ${b.text}`);
        break;
      case "h3":
        parts.push(`### ${b.text}`);
        break;
      case "p":
        parts.push(b.text);
        break;
      case "muted":
        parts.push(`_${b.text}_`);
        break;
      case "bullet":
        parts.push(`- ${b.text}`);
        break;
      case "kv":
        parts.push(`**${b.label}:** ${b.value}`);
        break;
      case "source":
        parts.push(`- [${b.label}](${b.url}) — ${b.detail}`);
        break;
    }
  }
  return parts.join("\n\n") + "\n";
}

/** Render blocks as plain text; Markdown syntax is stripped from prose. */
export function reportToPlainText(doc: ReportDocument): string {
  const parts: string[] = [];
  for (const b of projectReportDocument(doc)) {
    switch (b.kind) {
      case "h1":
        parts.push(`${b.text}\n${"=".repeat(b.text.length)}`);
        break;
      case "h2":
        parts.push(`${b.text}\n${"-".repeat(b.text.length)}`);
        break;
      case "h3":
        parts.push(b.text);
        break;
      case "p":
        parts.push(plainText(b));
        break;
      case "muted":
        parts.push(b.text);
        break;
      case "bullet":
        parts.push(`• ${b.text}`);
        break;
      case "kv":
        parts.push(`${b.label}: ${b.value}`);
        break;
      case "source":
        parts.push(`${b.label} — ${b.detail}\n  ${b.url}`);
        break;
    }
  }
  return parts.join("\n\n") + "\n";
}
