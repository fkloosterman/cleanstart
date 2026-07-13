/**
 * Server-only wiring for the profile extractor (WP1.4).
 *
 * Kept separate from `extractor.ts` so that module stays free of the
 * server-only AI-gateway import and remains trivially unit-testable and
 * importable anywhere. Both the chat endpoints (WP1.5) and the eval
 * harness build their `GenerateFn` from here, so extraction runs against
 * the same model path everywhere.
 */

import { generateText } from "ai";
import { createModelForPurpose } from "@/lib/ai-gateway.server";
import type { GenerateFn } from "@/lib/profile/extractor";

/** A `GenerateFn` backed by the model-map's `extraction` purpose (D12). */
export function createExtractionGenerate(apiKey: string): GenerateFn {
  const model = createModelForPurpose("extraction", apiKey);
  return async ({ system, prompt }) => {
    // Extraction is a structured task, not creative writing: pin
    // temperature 0 so the same exchange yields the same patches. At the
    // default (~0.7+) the model emits different — sometimes empty — output
    // on identical input, which makes extraction flaky and evals
    // non-reproducible. Determinism is the correctness property here; the
    // per-object parse salvage (WP1.5) and JSON-mode constraint (D12c)
    // remain the layers that bound the damage when a model still misfires.
    const { text } = await generateText({ model, system, prompt, temperature: 0 });
    return text;
  };
}
