/**
 * Content validation (WP3.1, design §3.1–§3.6). Turns the `content/` tree into
 * either a set of typed, cross-checked records or a list of curator-actionable
 * issues — the same function CI runs and `scripts/validate-content.ts` prints.
 *
 * Three layers, aggregated (we never stop at the first error — a curator wants
 * the whole list):
 *   1. Load     — files → objects; bad YAML / missing frontmatter (load.ts).
 *   2. Shape    — each record against its Zod schema (schema.ts). Schemas are
 *                 STRICT (unknown keys rejected) — unlike the tolerant runtime
 *                 profile normalizer, authored content should fail loud on a
 *                 typo'd field at CI time, not silently drop it.
 *   3. Corpus   — checks that need the whole corpus + the vocabulary file:
 *                 unique slugs, tag-vocabulary membership, and reference
 *                 resolution (prerequisite / media / source slugs), plus preset
 *                 profile_patches that actually apply.
 */

import { applyPatches } from "@/lib/profile/patches";
import { loadContent } from "@/lib/content/load";
import { loadVocabulary, type Vocabulary } from "@/lib/content/vocabulary";
import {
  componentSchema,
  mediaSchema,
  presetSchema,
  sourceSchema,
  type ContentComponent,
  type ContentMedia,
  type ContentPreset,
  type ContentSource,
} from "@/lib/content/schema";
import type { z } from "zod";

export interface ContentIssue {
  /** Relative content path, or a synthetic label like "vocabulary.yaml" / "<corpus>". */
  file: string;
  message: string;
}

export interface ValidatedContent {
  components: ContentComponent[];
  media: ContentMedia[];
  presets: ContentPreset[];
  sources: ContentSource[];
}

export interface ValidateResult {
  ok: boolean;
  issues: ContentIssue[];
  /** Records that passed shape validation (present even when corpus checks fail). */
  content: ValidatedContent;
}

/** Format a Zod error as one message per offending field. */
function zodMessages(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const path = i.path.join(".");
      return path ? `${path}: ${i.message}` : i.message;
    })
    .join("; ");
}

function checkUniqueSlugs<T extends { slug: string }>(
  records: { file: string; value: T }[],
  label: string,
  issues: ContentIssue[],
): void {
  const seen = new Map<string, string>();
  for (const { file, value } of records) {
    const prior = seen.get(value.slug);
    if (prior) {
      issues.push({
        file,
        message: `duplicate ${label} slug "${value.slug}" (already defined in ${prior})`,
      });
    } else {
      seen.set(value.slug, file);
    }
  }
}

function checkVocabMembership(
  file: string,
  field: string,
  values: string[],
  allowed: ReadonlySet<string>,
  issues: ContentIssue[],
): void {
  for (const v of values) {
    if (!allowed.has(v)) {
      issues.push({
        file,
        message: `unknown ${field} tag "${v}" — add it to content/vocabulary.yaml or fix the typo`,
      });
    }
  }
}

function checkRefs(
  file: string,
  field: string,
  refs: string[],
  known: ReadonlySet<string>,
  issues: ContentIssue[],
): void {
  for (const r of refs) {
    if (!known.has(r)) {
      issues.push({ file, message: `${field} references unknown slug "${r}"` });
    }
  }
}

/** Detect prerequisite cycles — a cycle holds every member back forever. */
function checkPrerequisiteCycles(
  components: { file: string; value: ContentComponent }[],
  issues: ContentIssue[],
): void {
  const bySlug = new Map(components.map((c) => [c.value.slug, c.value]));
  const state = new Map<string, "visiting" | "done">();
  const reported = new Set<string>();

  const visit = (slug: string, stack: string[]): void => {
    if (state.get(slug) === "done") return;
    if (state.get(slug) === "visiting") {
      const cycle = [...stack.slice(stack.indexOf(slug)), slug].join(" → ");
      if (!reported.has(slug)) {
        reported.add(slug);
        const file = components.find((c) => c.value.slug === slug)?.file ?? "<corpus>";
        issues.push({ file, message: `prerequisite cycle: ${cycle}` });
      }
      return;
    }
    state.set(slug, "visiting");
    for (const pre of bySlug.get(slug)?.prerequisites ?? []) {
      if (bySlug.has(pre)) visit(pre, [...stack, slug]);
    }
    state.set(slug, "done");
  };

  for (const { value } of components) visit(value.slug, []);
}

/** Preset patches must survive the real apply pipeline against an empty profile. */
function checkPresetPatches(file: string, preset: ContentPreset, issues: ContentIssue[]): void {
  const { rejected } = applyPatches({}, preset.profile_patches);
  for (const r of rejected) {
    issues.push({ file, message: `profile_patch rejected (${r.reason})` });
  }
}

/**
 * Validate the content tree at `contentDir`, using the vocabulary at
 * `vocabularyPath`. Returns every issue found (never throws on content
 * problems — only truly exceptional I/O would throw).
 */
export function validateContent(contentDir: string, vocabularyPath: string): ValidateResult {
  const issues: ContentIssue[] = [];
  const { records, errors } = loadContent(contentDir);
  for (const e of errors) issues.push({ file: e.file, message: e.message });

  let vocab: Vocabulary | null = null;
  try {
    vocab = loadVocabulary(vocabularyPath);
  } catch (err) {
    issues.push({ file: "vocabulary.yaml", message: `failed to load: ${(err as Error).message}` });
  }

  // --- Layer 2: shape ---
  const components: { file: string; value: ContentComponent }[] = [];
  const media: { file: string; value: ContentMedia }[] = [];
  const presets: { file: string; value: ContentPreset }[] = [];
  const sources: { file: string; value: ContentSource }[] = [];

  for (const rec of records) {
    const schema = {
      component: componentSchema,
      media: mediaSchema,
      preset: presetSchema,
      source: sourceSchema,
    }[rec.kind];
    const parsed = schema.safeParse(rec.raw);
    if (!parsed.success) {
      issues.push({ file: rec.file, message: zodMessages(parsed.error) });
      continue;
    }
    switch (rec.kind) {
      case "component":
        components.push({ file: rec.file, value: parsed.data as ContentComponent });
        break;
      case "media":
        media.push({ file: rec.file, value: parsed.data as ContentMedia });
        break;
      case "preset":
        presets.push({ file: rec.file, value: parsed.data as ContentPreset });
        break;
      case "source":
        sources.push({ file: rec.file, value: parsed.data as ContentSource });
        break;
    }
  }

  // --- Layer 3: corpus ---
  checkUniqueSlugs(components, "component", issues);
  checkUniqueSlugs(media, "media", issues);
  checkUniqueSlugs(presets, "preset", issues);
  checkUniqueSlugs(sources, "source", issues);

  const componentSlugs = new Set(components.map((c) => c.value.slug));
  const mediaSlugs = new Set(media.map((m) => m.value.slug));
  const sourceSlugs = new Set(sources.map((s) => s.value.slug));

  for (const { file, value } of components) {
    if (vocab) {
      checkVocabMembership(file, "technology", value.technologies, vocab.technologies, issues);
      checkVocabMembership(file, "housing_type", value.housing_types, vocab.housing_types, issues);
    }
    checkRefs(file, "prerequisites", value.prerequisites, componentSlugs, issues);
    checkRefs(file, "media", value.media, mediaSlugs, issues);
    checkRefs(file, "sources", value.sources, sourceSlugs, issues);
    if (value.prerequisites.includes(value.slug)) {
      issues.push({ file, message: `component "${value.slug}" lists itself as a prerequisite` });
    }
  }
  checkPrerequisiteCycles(components, issues);

  for (const { file, value } of media) {
    if (vocab)
      checkVocabMembership(file, "technology", value.technologies, vocab.technologies, issues);
  }
  for (const { file, value } of presets) {
    checkPresetPatches(file, value, issues);
  }

  return {
    ok: issues.length === 0,
    issues,
    content: {
      components: components.map((c) => c.value),
      media: media.map((m) => m.value),
      presets: presets.map((p) => p.value),
      sources: sources.map((s) => s.value),
    },
  };
}
