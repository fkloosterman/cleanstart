import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { applyRoutingPreferences, resolveModelConfig, type ModelPurpose } from "@/lib/model-map";

const DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1";

/**
 * Create a model instance for a declared purpose (chat / extraction /
 * composition). Which model serves each purpose — and whether the call is
 * restricted to ZDR/no-training endpoints — is environment configuration;
 * see src/lib/model-map.ts and .env.example.
 */
export function createModelForPurpose(purpose: ModelPurpose, openRouterApiKey: string) {
  const config = resolveModelConfig(purpose, process.env);
  // `||` not `??`: an empty OPENROUTER_URL (the .env.example default) means
  // "unset", same as model-map treats the model vars — otherwise the base URL
  // becomes "" and every request URL fails to parse.
  const baseURL = process.env.OPENROUTER_URL || DEFAULT_OPENROUTER_URL;

  const provider = createOpenAICompatible({
    name: "openrouter",
    baseURL,
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      // OpenRouter uses this for its public model-usage rankings, not for
      // auth/routing.
      "HTTP-Referer": "https://cleanstart-smoky.vercel.app",
      "X-Title": "Clean Start",
    },
    // Rewrite each request body with the purpose's routing config: the free
    // fallback chain (so a rate-limited free primary falls through instead of
    // failing the request) and/or ZDR provider preferences.
    fetch: async (input, init) => {
      if (init?.body && typeof init.body === "string") {
        init = { ...init, body: applyRoutingPreferences(init.body, config) };
      }
      return fetch(input, init);
    },
  });

  return provider(config.modelId);
}
