/**
 * Reads the `content/` directory tree into raw, unvalidated records
 * (WP3.1, design §3.4). Shape and cross-reference validation happen in
 * `validate.ts`; this module only turns files into objects and reports the
 * failures that stop a file from being parsed at all (bad YAML, a component
 * missing its frontmatter fences).
 *
 * Layout (see content/README.md):
 *   content/components/**\/*.md    — YAML frontmatter + markdown body (body_md)
 *   content/media/**\/*.yaml       — pure YAML
 *   content/presets/**\/*.yaml     — pure YAML
 *   content/sources/**\/*.yaml     — pure YAML
 *   content/vocabulary.yaml        — the tag vocabulary (loaded separately)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { splitFrontmatter } from "@/lib/content/frontmatter";
import { CONTENT_KIND_DIRS, type ContentEntityKind } from "@/lib/content/schema";

/** A raw record parsed from one file, before shape validation. */
export interface RawRecord {
  kind: ContentEntityKind;
  /** Path relative to the content dir, for error messages (e.g. "components/foo.md"). */
  file: string;
  /** The parsed-but-unvalidated object (frontmatter+body_md for components). */
  raw: Record<string, unknown>;
}

/** A file that could not be parsed at all. */
export interface LoadError {
  file: string;
  message: string;
}

export interface LoadResult {
  records: RawRecord[];
  errors: LoadError[];
}

const EXTENSIONS: Record<ContentEntityKind, string[]> = {
  component: [".md"],
  media: [".yaml", ".yml"],
  preset: [".yaml", ".yml"],
  source: [".yaml", ".yml"],
};

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue; // skip dotfiles
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function relPath(contentDir: string, file: string): string {
  return relative(contentDir, file).split(sep).join("/");
}

function loadKind(contentDir: string, kind: ContentEntityKind, result: LoadResult): void {
  const dir = join(contentDir, CONTENT_KIND_DIRS[kind]);
  const exts = EXTENSIONS[kind];

  for (const file of walk(dir)) {
    if (!exts.some((e) => file.endsWith(e))) continue;
    const rel = relPath(contentDir, file);
    const text = readFileSync(file, "utf8");

    try {
      if (kind === "component") {
        const { data, body } = splitFrontmatter(text);
        result.records.push({ kind, file: rel, raw: { ...data, body_md: body } });
      } else {
        const parsed = parseYaml(text);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          result.errors.push({
            file: rel,
            message: "file must be a YAML mapping (key: value pairs)",
          });
          continue;
        }
        result.records.push({ kind, file: rel, raw: parsed as Record<string, unknown> });
      }
    } catch (err) {
      result.errors.push({ file: rel, message: (err as Error).message });
    }
  }
}

/** Load every content record under `contentDir`. */
export function loadContent(contentDir: string): LoadResult {
  const result: LoadResult = { records: [], errors: [] };
  for (const kind of Object.keys(CONTENT_KIND_DIRS) as ContentEntityKind[]) {
    loadKind(contentDir, kind, result);
  }
  return result;
}
