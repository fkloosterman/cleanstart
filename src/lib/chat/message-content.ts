/**
 * Assistant message parsing (WP3.4, design §D4 + §3.3). The agent embeds two
 * kinds of directive in its reply — emitted in the single generation, no tool
 * round-trip (see the grounding block in prompts/context.ts):
 *
 *   [cite:<slug>]    right after a claim, naming the library component it came
 *                    from → rendered as the "Sources (n)" row beneath the message.
 *   [figure:<slug>]  on its own line → rendered as the library image inline.
 *
 * This module is the pure boundary that turns that raw text into render-ready
 * pieces. It resolves *nothing* (slugs → records is the content index's job, so
 * this stays a database-free pure function); it only strips the citation
 * markers, splits figures out of the prose, and reports which slugs were named.
 *
 * Streaming-safe: partial text arrives token by token, so a directive can be
 * half-written at the current end of the buffer. A dangling incomplete marker
 * (`… [cite:heat-pu`) is hidden rather than shown as literal text; it resolves
 * itself on the next token. Only a *trailing* incomplete marker is treated this
 * way — a stray `[` earlier in the text is ordinary prose.
 */

/** A kebab-case content slug, as authored (`schema.ts` slugSchema). */
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const CITE_RE = new RegExp(`\\[cite:\\s*(${SLUG})\\s*\\]`, "g");
const FIGURE_RE = new RegExp(`\\[figure:\\s*(${SLUG})\\s*\\]`, "g");
/** A directive being typed out at the very end of the buffer (no closing `]` yet). */
const DANGLING_RE = /\[(?:cite|figure)(?::[^\]]*)?$/;

export type MessageSegment = { type: "text"; text: string } | { type: "figure"; slug: string };

export interface ParsedMessage {
  /** Prose (citation markers stripped) interleaved with figures, in document order. */
  segments: MessageSegment[];
  /** Component slugs cited anywhere in the message, first-seen order, de-duplicated. */
  citedSlugs: string[];
}

/** Remove citation markers from a run of text and collect the slugs they named. */
function stripCitations(text: string, into: string[]): string {
  CITE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITE_RE.exec(text)) !== null) {
    if (!into.includes(match[1])) into.push(match[1]);
  }
  // Drop the marker plus a single space on whichever side abuts it, so "heat
  // pumps [cite:x] move heat" collapses cleanly to "heat pumps move heat".
  return text.replace(new RegExp(`\\s?${CITE_RE.source}\\s?`, "g"), (whole) =>
    whole.startsWith(" ") && whole.endsWith(" ") ? " " : "",
  );
}

/**
 * Parse a raw assistant message into ordered text/figure segments and the list
 * of cited component slugs. Pure and total — any string yields a valid result.
 */
export function parseMessageContent(raw: string): ParsedMessage {
  // Hide a directive that is still being streamed at the end of the buffer.
  const dangling = DANGLING_RE.exec(raw);
  const text = dangling ? raw.slice(0, dangling.index) : raw;

  const citedSlugs: string[] = [];
  const segments: MessageSegment[] = [];

  let cursor = 0;
  FIGURE_RE.lastIndex = 0;
  let fig: RegExpExecArray | null;
  const pushText = (chunk: string) => {
    // Trim each run: a text segment abuts a figure or the message edge, where
    // leading/trailing whitespace only renders as stray blank lines.
    const cleaned = stripCitations(chunk, citedSlugs).trim();
    if (cleaned.length > 0) segments.push({ type: "text", text: cleaned });
  };

  while ((fig = FIGURE_RE.exec(text)) !== null) {
    pushText(text.slice(cursor, fig.index));
    segments.push({ type: "figure", slug: fig[1] });
    cursor = fig.index + fig[0].length;
  }
  pushText(text.slice(cursor));

  return { segments, citedSlugs };
}
