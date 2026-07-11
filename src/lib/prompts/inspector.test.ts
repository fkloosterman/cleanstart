import { describe, expect, it } from "vitest";
import { deriveLane } from "@/lib/lanes/derive";
import { buildContext, buildContextSections, deriveStage } from "@/lib/prompts/context";
import {
  promptInspectorEnabled,
  readContextDebugData,
  type ContextDebugData,
} from "@/lib/prompts/inspector";
import { normalizeProfile } from "@/lib/profile/normalize";

describe("promptInspectorEnabled", () => {
  it("is on only for an explicit truthy flag", () => {
    expect(promptInspectorEnabled({ EXPOSE_PROMPT_INSPECTOR: "1" })).toBe(true);
    expect(promptInspectorEnabled({ EXPOSE_PROMPT_INSPECTOR: "true" })).toBe(true);
  });

  it("is off when unset, empty, or any other value (prod-safe default)", () => {
    expect(promptInspectorEnabled({})).toBe(false);
    expect(promptInspectorEnabled({ EXPOSE_PROMPT_INSPECTOR: "" })).toBe(false);
    expect(promptInspectorEnabled({ EXPOSE_PROMPT_INSPECTOR: "0" })).toBe(false);
    expect(promptInspectorEnabled({ EXPOSE_PROMPT_INSPECTOR: "yes" })).toBe(false);
  });
});

describe("buildContextSections ↔ buildContext", () => {
  const profile = normalizeProfile({
    tenure: { value: "renter", provenance: "stated", confidence: "high" },
    motivation_weights: {
      value: { cost: 1, carbon: 0.2, comfort: 0, resilience: 0, learning: 0 },
      provenance: "inferred",
    },
  });
  const lane = deriveLane(profile.motivation_weights.value);
  const input = { profile, lane, stage: deriveStage(profile, lane.framing) };

  it("joins to exactly the assembled prompt string", () => {
    const joined = buildContextSections(input)
      .map((s) => s.text)
      .join("\n\n");
    expect(joined).toBe(buildContext(input));
  });

  it("labels every section and always includes base + brevity", () => {
    const sections = buildContextSections(input);
    for (const s of sections) expect(s.label.length).toBeGreaterThan(0);
    const ids = sections.map((s) => s.id);
    expect(ids).toContain("base");
    expect(ids).toContain("brevity");
  });

  it("omits grounding when nothing is retrieved", () => {
    const ids = buildContextSections(input).map((s) => s.id);
    expect(ids).not.toContain("grounding");
  });
});

describe("readContextDebugData — tolerant", () => {
  const valid: ContextDebugData = {
    meta: {
      lanePrimary: "lower_bills",
      laneFraming: "lower_bills",
      laneMixed: false,
      stage: "deepening",
    },
    sections: [
      { id: "base", label: "Voice & boundaries", text: "You are Clean Start…" },
      { id: "profile", label: "What you already know", text: "Own or rent: Rent" },
    ],
  };

  it("round-trips a valid payload", () => {
    expect(readContextDebugData(valid)).toEqual(valid);
  });

  it("drops sections with an unknown id or missing fields", () => {
    const out = readContextDebugData({
      meta: valid.meta,
      sections: [
        { id: "base", label: "Voice", text: "ok" },
        { id: "not_a_section", label: "x", text: "y" }, // unknown id → dropped
        { id: "stage", label: "Stage", text: 42 }, // bad text type → dropped
      ],
    });
    expect(out?.sections).toHaveLength(1);
    expect(out?.sections[0].id).toBe("base");
  });

  it("returns null for junk, wrong shapes, or all-sections-invalid", () => {
    for (const junk of [null, 42, "x", {}, { meta: {}, sections: "no" }, { sections: [] }]) {
      expect(readContextDebugData(junk), JSON.stringify(junk)).toBeNull();
    }
    expect(readContextDebugData({ meta: valid.meta, sections: [{ id: "nope" }] })).toBeNull();
  });

  it("defaults missing meta fields rather than throwing", () => {
    const out = readContextDebugData({
      meta: { stage: "discovery" },
      sections: valid.sections,
    });
    expect(out?.meta.stage).toBe("discovery");
    expect(out?.meta.lanePrimary).toBe("");
    expect(out?.meta.laneMixed).toBe(false);
  });
});
