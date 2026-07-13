/**
 * Per-purpose model map (WP0.4, decision D12).
 *
 * Every LLM call in the app has a declared purpose; which model serves a
 * purpose is environment configuration, never code. Pure module — no env
 * access, no network — so resolution and request rewriting are unit-tested.
 */

export type ModelPurpose = "chat" | "extraction" | "composition";

export const DEFAULT_MODEL = "openai/gpt-oss-120b:free";

// Free models are individually rate-limited upstream and can 429 under load
// (documented OpenRouter behavior, not our own quota). These are fallback
// candidates OpenRouter tries in order if the primary model errors/rate-limits
// — see https://openrouter.ai/docs/guides/routing/model-fallbacks
export const FREE_MODEL_FALLBACKS = [
  "openai/gpt-oss-120b:free",
  "openai/gpt-oss-20b:free",
  "google/gemma-4-31b-it:free",
];

const PURPOSE_MODEL_ENV_VARS: Record<ModelPurpose, string> = {
  chat: "OPENROUTER_MODEL_CHAT",
  extraction: "OPENROUTER_MODEL_EXTRACTION",
  composition: "OPENROUTER_MODEL_COMPOSITION",
};

export interface ResolvedModelConfig {
  modelId: string;
  /**
   * OpenRouter `models` fallback chain (primary first), or empty when
   * fallbacks must not apply. Only free-tier primaries get the free fallback
   * chain: a paid model silently falling back to arbitrary free models would
   * defeat the point of choosing it (quality, and D12's data-policy routing).
   */
  fallbackModels: string[];
  /**
   * When true, the request must carry OpenRouter provider preferences
   * restricting routing to zero-data-retention, no-training endpoints
   * (D12: enforced on production structured calls).
   */
  requireZdr: boolean;
}

/**
 * Resolve which model serves a purpose, from environment config.
 *
 * Model id precedence: OPENROUTER_MODEL_<PURPOSE> → OPENROUTER_MODEL →
 * DEFAULT_MODEL. ZDR enforcement is opt-in per purpose via
 * OPENROUTER_ZDR_PURPOSES (comma-separated purpose names; set to
 * "extraction,composition" in the Vercel Production environment per D12).
 */
export function resolveModelConfig(
  purpose: ModelPurpose,
  env: Record<string, string | undefined>,
): ResolvedModelConfig {
  const modelId = env[PURPOSE_MODEL_ENV_VARS[purpose]] || env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const zdrPurposes = (env.OPENROUTER_ZDR_PURPOSES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const requireZdr = zdrPurposes.includes(purpose);

  const fallbackModels =
    modelId.endsWith(":free") && !requireZdr
      ? [modelId, ...FREE_MODEL_FALLBACKS.filter((m) => m !== modelId)]
      : [];

  return { modelId, fallbackModels, requireZdr };
}

/**
 * Rewrite an outgoing OpenRouter request body (JSON string) to carry the
 * resolved routing config: the `models` fallback chain and/or the ZDR
 * provider preferences. Non-JSON bodies are returned unchanged.
 */
export function applyRoutingPreferences(body: string, config: ResolvedModelConfig): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    // Body wasn't JSON (shouldn't happen for this API) — send as-is.
    return body;
  }

  if (config.fallbackModels.length > 0) {
    const primary = typeof parsed.model === "string" ? parsed.model : config.modelId;
    parsed.models = [primary, ...config.fallbackModels.filter((m) => m !== primary)];
  }

  if (config.requireZdr) {
    const existing =
      typeof parsed.provider === "object" && parsed.provider !== null ? parsed.provider : {};
    // https://openrouter.ai/docs/features/provider-routing — restrict routing
    // to zero-data-retention endpoints at providers that don't train on data.
    parsed.provider = { ...existing, zdr: true, data_collection: "deny" };
  }

  return JSON.stringify(parsed);
}
