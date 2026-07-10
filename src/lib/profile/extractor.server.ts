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
    const { text } = await generateText({ model, system, prompt });
    return text;
  };
}
