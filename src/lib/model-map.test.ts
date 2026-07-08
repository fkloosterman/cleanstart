import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  FREE_MODEL_FALLBACKS,
  applyRoutingPreferences,
  resolveModelConfig,
} from "@/lib/model-map";

describe("resolveModelConfig", () => {
  it("uses the per-purpose env var when set", () => {
    const config = resolveModelConfig("extraction", {
      OPENROUTER_MODEL_EXTRACTION: "deepseek/deepseek-v4-flash",
      OPENROUTER_MODEL: "some/shared-model",
    });
    expect(config.modelId).toBe("deepseek/deepseek-v4-flash");
  });

  it("falls back to OPENROUTER_MODEL, then the default", () => {
    expect(resolveModelConfig("chat", { OPENROUTER_MODEL: "some/shared-model" }).modelId).toBe(
      "some/shared-model",
    );
    expect(resolveModelConfig("chat", {}).modelId).toBe(DEFAULT_MODEL);
  });

  it("treats empty-string env vars as unset", () => {
    const config = resolveModelConfig("chat", {
      OPENROUTER_MODEL_CHAT: "",
      OPENROUTER_MODEL: "",
    });
    expect(config.modelId).toBe(DEFAULT_MODEL);
  });

  it("gives free primaries the free fallback chain, primary first, deduplicated", () => {
    const config = resolveModelConfig("chat", {
      OPENROUTER_MODEL_CHAT: "openai/gpt-oss-20b:free",
    });
    expect(config.fallbackModels[0]).toBe("openai/gpt-oss-20b:free");
    expect(config.fallbackModels).toEqual([
      "openai/gpt-oss-20b:free",
      ...FREE_MODEL_FALLBACKS.filter((m) => m !== "openai/gpt-oss-20b:free"),
    ]);
  });

  it("gives paid models no fallback chain", () => {
    const config = resolveModelConfig("composition", {
      OPENROUTER_MODEL_COMPOSITION: "anthropic/claude-haiku-4.5",
    });
    expect(config.fallbackModels).toEqual([]);
  });

  it("enforces ZDR only for purposes listed in OPENROUTER_ZDR_PURPOSES", () => {
    const env = { OPENROUTER_ZDR_PURPOSES: "extraction, composition" };
    expect(resolveModelConfig("extraction", env).requireZdr).toBe(true);
    expect(resolveModelConfig("composition", env).requireZdr).toBe(true);
    expect(resolveModelConfig("chat", env).requireZdr).toBe(false);
    expect(resolveModelConfig("extraction", {}).requireZdr).toBe(false);
  });

  it("suppresses the free fallback chain when ZDR is enforced", () => {
    const config = resolveModelConfig("extraction", {
      OPENROUTER_MODEL_EXTRACTION: "openai/gpt-oss-120b:free",
      OPENROUTER_ZDR_PURPOSES: "extraction",
    });
    expect(config.fallbackModels).toEqual([]);
  });
});

describe("applyRoutingPreferences", () => {
  const baseBody = JSON.stringify({ model: "openai/gpt-oss-120b:free", messages: [] });

  it("injects the fallback chain with the request's own model first", () => {
    const config = resolveModelConfig("chat", {});
    const result = JSON.parse(applyRoutingPreferences(baseBody, config)) as {
      models: string[];
    };
    expect(result.models[0]).toBe("openai/gpt-oss-120b:free");
    expect(new Set(result.models).size).toBe(result.models.length);
  });

  it("injects ZDR provider preferences when required", () => {
    const config = resolveModelConfig("extraction", {
      OPENROUTER_MODEL_EXTRACTION: "anthropic/claude-haiku-4.5",
      OPENROUTER_ZDR_PURPOSES: "extraction",
    });
    const body = JSON.stringify({ model: "anthropic/claude-haiku-4.5", messages: [] });
    const result = JSON.parse(applyRoutingPreferences(body, config)) as {
      models?: string[];
      provider: { zdr: boolean; data_collection: string };
    };
    expect(result.provider).toEqual({ zdr: true, data_collection: "deny" });
    expect(result.models).toBeUndefined();
  });

  it("preserves existing provider preferences when adding ZDR", () => {
    const config = resolveModelConfig("composition", {
      OPENROUTER_MODEL_COMPOSITION: "anthropic/claude-haiku-4.5",
      OPENROUTER_ZDR_PURPOSES: "composition",
    });
    const body = JSON.stringify({ provider: { sort: "price" } });
    const result = JSON.parse(applyRoutingPreferences(body, config)) as {
      provider: Record<string, unknown>;
    };
    expect(result.provider).toEqual({
      sort: "price",
      zdr: true,
      data_collection: "deny",
    });
  });

  it("returns non-JSON bodies unchanged", () => {
    const config = resolveModelConfig("chat", {});
    expect(applyRoutingPreferences("not json", config)).toBe("not json");
  });
});
