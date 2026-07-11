/**
 * Minimal YAML-frontmatter splitter for git-first content (design §3.4).
 *
 * Component files are markdown: a YAML frontmatter block delimited by `---`
 * fences, followed by the markdown body (which becomes `body_md`). We split
 * here and parse the YAML with the `yaml` package; keeping the split tiny and
 * dependency-free (beyond the YAML parse itself) means the failure modes are
 * obvious and testable.
 *
 * Rules:
 *   - The file MUST open with a `---` fence on its own line (optionally after
 *     a UTF-8 BOM / leading blank lines). A file without an opening fence has
 *     no frontmatter and is reported as such — curators always front-matter
 *     their components.
 *   - The frontmatter runs to the next `---` fence on its own line; everything
 *     after it is the body (leading blank lines trimmed).
 */

import { parse as parseYaml } from "yaml";

export interface Frontmatter {
  /** Parsed YAML frontmatter as a plain object (never null; `{}` if empty). */
  data: Record<string, unknown>;
  /** The markdown body after the closing fence, with surrounding blank lines trimmed. */
  body: string;
}

export class FrontmatterError extends Error {}

const FENCE = /^---[ \t]*\r?$/;

/**
 * Split `raw` into its YAML frontmatter and markdown body.
 * Throws {@link FrontmatterError} when the fences are missing or the YAML
 * is not a mapping — callers surface the message to the curator.
 */
export function splitFrontmatter(raw: string): Frontmatter {
  // Tolerate a BOM and leading blank lines before the opening fence.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split("\n");

  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;

  if (start >= lines.length || !FENCE.test(lines[start])) {
    throw new FrontmatterError(
      "missing opening '---' frontmatter fence (component files need YAML frontmatter)",
    );
  }

  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new FrontmatterError("missing closing '---' frontmatter fence");
  }

  const yamlText = lines.slice(start + 1, end).join("\n");
  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\s*\n/, "")
    .trimEnd();

  let data: unknown;
  try {
    data = yamlText.trim() === "" ? {} : parseYaml(yamlText);
  } catch (err) {
    throw new FrontmatterError(`invalid YAML frontmatter: ${(err as Error).message}`);
  }
  if (data === null || data === undefined) data = {};
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new FrontmatterError("frontmatter must be a YAML mapping (key: value pairs)");
  }

  return { data: data as Record<string, unknown>, body };
}
