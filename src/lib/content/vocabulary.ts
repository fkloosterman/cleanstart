/**
 * Loads and validates the content tag vocabulary (content/vocabulary.yaml),
 * the CI-validated single source of truth for the open targeting axes
 * (design §3.1, §11). Adding a tag is one line in that file; `validate.ts`
 * then rejects any content that uses a tag outside it.
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const vocabularyFileSchema = z.strictObject({
  technologies: z.array(z.string().trim().min(1)).default([]),
  housing_types: z.array(z.string().trim().min(1)).default([]),
});

export interface Vocabulary {
  technologies: ReadonlySet<string>;
  housing_types: ReadonlySet<string>;
}

/** Parse an already-read vocabulary YAML string. Throws on malformed input. */
export function parseVocabulary(yamlText: string): Vocabulary {
  const raw = parseYaml(yamlText);
  const parsed = vocabularyFileSchema.parse(raw ?? {});
  return {
    technologies: new Set(parsed.technologies),
    housing_types: new Set(parsed.housing_types),
  };
}

/** Read and parse content/vocabulary.yaml from disk. */
export function loadVocabulary(path: string): Vocabulary {
  return parseVocabulary(readFileSync(path, "utf8"));
}
