import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-oss-120b:free";

// Free models are individually rate-limited upstream and can 429 under load
// (documented OpenRouter behavior, not our own quota). These are fallback
// candidates OpenRouter tries in order if the primary model errors/rate-limits
// — see https://openrouter.ai/docs/guides/routing/model-fallbacks
const FREE_MODEL_FALLBACKS = [
  "openai/gpt-oss-120b:free",
  "openai/gpt-oss-20b:free",
  "google/gemma-4-31b-it:free",
];

export function createOpenRouterProvider(openRouterApiKey: string) {
  const baseURL = process.env.OPENROUTER_URL ?? DEFAULT_OPENROUTER_URL;
  return createOpenAICompatible({
    name: "openrouter",
    baseURL,
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      // OpenRouter uses this for its public model-usage rankings, not for
      // auth/routing.
      "HTTP-Referer": "https://cleanstart-smoky.vercel.app",
      "X-Title": "Clean Start",
    },
    // Inject OpenRouter's `models` fallback list into every request body so a
    // rate-limited/erroring primary model automatically falls through to the
    // next free model instead of failing the whole request.
    fetch: async (input, init) => {
      if (init?.body && typeof init.body === "string") {
        try {
          const parsed = JSON.parse(init.body) as { model?: string };
          const primary = parsed.model;
          const models = primary
            ? [primary, ...FREE_MODEL_FALLBACKS.filter((m) => m !== primary)]
            : FREE_MODEL_FALLBACKS;
          init = { ...init, body: JSON.stringify({ ...parsed, models }) };
        } catch {
          // Body wasn't JSON (shouldn't happen for this API) — send as-is.
        }
      }
      return fetch(input, init);
    },
  });
}

/**
 * Convenience helper: creates the provider and immediately returns a model
 * instance using the OPENROUTER_MODEL env var (falls back to the default
 * primary model if the var is unset).
 */
export function createOpenRouterModel(openRouterApiKey: string) {
  const modelId = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
  return createOpenRouterProvider(openRouterApiKey)(modelId);
}
