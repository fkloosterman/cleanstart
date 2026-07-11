import { describe, expect, it, vi } from "vitest";
import { emptyProfile, normalizeProfile } from "@/lib/profile/normalize";
import { applyPatches } from "@/lib/profile/patches";
import {
  buildExtractionPrompt,
  buildExtractionSystem,
  extractProfilePatches,
  parsePatchArray,
  sanitizeExtractedPatches,
  summarizeProfile,
  type GenerateFn,
} from "@/lib/profile/extractor";
import { MOTIVATION_DIMENSIONS, SLOT_NAMES } from "@/lib/profile/registry";

describe("buildExtractionSystem — registry-derived (§4.2)", () => {
  const system = buildExtractionSystem();

  it("documents every slot, so new slots are learned automatically", () => {
    for (const name of SLOT_NAMES) expect(system, name).toContain(name);
  });

  it("surfaces enum options for a weak model", () => {
    expect(system).toContain("owner, renter, other"); // tenure options
    expect(system).toContain("single-family, apartment, condo, mobile");
  });

  it("states the hard rules (never ruled_out from silence, never edited/propagated)", () => {
    expect(system).toContain("ruled_out");
    expect(system.toLowerCase()).toContain("silence");
    expect(system).toContain('Never emit "edited" or "propagated"');
  });

  it("names the five motivation dimensions and how to weight them (WP2.3)", () => {
    for (const dim of MOTIVATION_DIMENSIONS) expect(system, dim).toContain(dim);
    expect(system).toContain("RELATIVE");
  });

  it("forbids inventing motivation from silence or a bare topic mention (WP2.3)", () => {
    // The never-infer-from-silence discipline extends to the motivation
    // vector, not just ruled_out stances.
    expect(system.toLowerCase()).toContain("never invent motivation from silence");
    expect(system).toContain("not a comfort/carbon motivation");
  });

  it("guides stance capture: interest vs ruled_out, with namespaced entities (WP2.3)", () => {
    expect(system).toContain("STANCES");
    expect(system).toContain("tech:solar");
    expect(system).toContain('"ruled_out" ONLY when they explicitly decline');
  });
});

describe("summarizeProfile / buildExtractionPrompt", () => {
  it("lists only filled slots and marks edited ones locked", () => {
    const profile = normalizeProfile({
      tenure: { value: "owner", provenance: "edited" },
      region: { value: { state: "MA" }, provenance: "stated" },
    });
    const summary = summarizeProfile(profile);
    expect(summary).toContain("tenure (locked)");
    expect(summary).toContain("region");
    expect(summary).not.toContain("timeline");
  });

  it("reports an empty profile as (empty)", () => {
    expect(summarizeProfile(emptyProfile())).toBe("(empty)");
  });

  it("includes the assistant turn only when present", () => {
    const withAssistant = buildExtractionPrompt(emptyProfile(), {
      user: "I rent",
      assistant: "Do you own or rent?",
    });
    expect(withAssistant).toContain("Assistant: Do you own or rent?");
    expect(withAssistant).toContain("User: I rent");

    const userOnly = buildExtractionPrompt(emptyProfile(), { user: "I rent" });
    expect(userOnly).not.toContain("Assistant:");
  });
});

describe("parsePatchArray — tolerant (§4.4)", () => {
  it("parses a bare JSON array", () => {
    expect(parsePatchArray('[{"op":"set","slot":"tenure","value":"renter"}]')).toEqual([
      { op: "set", slot: "tenure", value: "renter" },
    ]);
  });

  it("strips ```json fences", () => {
    const text = '```json\n[{"op":"clear","slot":"timeline","provenance":"stated"}]\n```';
    expect(parsePatchArray(text)).toHaveLength(1);
  });

  it("recovers an array from surrounding prose", () => {
    const text = 'Here are the patches:\n[{"op":"set","slot":"tenure","value":"owner"}]\nDone.';
    expect(parsePatchArray(text)).toHaveLength(1);
  });

  it("returns [] for junk, empty, or non-array JSON", () => {
    for (const text of ["", "not json", "{}", "null", "42", "```json\n{}\n```", "[oops"]) {
      expect(parsePatchArray(text), JSON.stringify(text)).toEqual([]);
    }
  });

  it("salvages valid siblings when one element is corrupt JSON", () => {
    // One glitched object must not discard the whole turn's patches.
    const text =
      '[{"op":"set","slot":"timeline","value":"this-year","provenance":"stated"},' +
      " {BROKEN not json}," +
      '{"op":"append","slot":"goals","value":{"text":"cut bill"},"provenance":"stated"}]';
    const patches = parsePatchArray(text);
    expect(patches).toHaveLength(2);
    expect(patches).toContainEqual({
      op: "set",
      slot: "timeline",
      value: "this-year",
      provenance: "stated",
    });
    // The nested value object stays intact through per-object salvage.
    expect(patches).toContainEqual({
      op: "append",
      slot: "goals",
      value: { text: "cut bill" },
      provenance: "stated",
    });
  });

  it("salvages around real field corruption (a rogue glitch token)", () => {
    // Verbatim shapes observed from a weak free model: a mangled key
    // (`richtet'` for `"op"`) and an injected Unicode char (`嘎`) each
    // invalidate their own object but not their siblings.
    const richtet =
      '[{"op":"set","slot":"housing_type","value":"apartment","provenance":"stated"},' +
      '{"op":"set","slot":"timeline","value":"this-year","provenance":"stated"},' +
      '{richtet\': "append","slot":"goals","value":{"text":"cut bill"},"provenance":"stated"}]';
    expect(parsePatchArray(richtet)).toHaveLength(2);

    const glitch =
      '[{"op":"set","slot":"housing_type","value":"apartment","provenance":"stated"},' +
      '{"op":嘎set","slot":"timeline","value":"this-year","provenance":"stated"}]';
    // The first (clean) object survives; the second is dropped.
    expect(parsePatchArray(glitch)).toContainEqual({
      op: "set",
      slot: "housing_type",
      value: "apartment",
      provenance: "stated",
    });
  });

  it("returns [] when every element is corrupt", () => {
    expect(parsePatchArray("[{bad}, {also bad}, {nope]")).toEqual([]);
  });
});

describe("sanitizeExtractedPatches — provenance gate", () => {
  it("keeps stated/inferred patches", () => {
    const raw = [
      { op: "set", slot: "tenure", value: "renter", provenance: "stated" },
      { op: "append", slot: "goals", value: { text: "lower bills" }, provenance: "inferred" },
    ];
    expect(sanitizeExtractedPatches(raw)).toHaveLength(2);
  });

  it("drops patches claiming edited or propagated provenance", () => {
    const raw = [
      { op: "set", slot: "tenure", value: "renter", provenance: "edited" },
      { op: "set", slot: "region", value: { state: "MA" }, provenance: "propagated" },
    ];
    expect(sanitizeExtractedPatches(raw)).toEqual([]);
  });

  it("allows clear (no user value) and normalizes its provenance to inferred", () => {
    const [patch] = sanitizeExtractedPatches([{ op: "clear", slot: "timeline" }]);
    expect(patch).toEqual({ op: "clear", slot: "timeline", provenance: "inferred" });
  });

  it("ignores non-objects and unknown ops", () => {
    expect(sanitizeExtractedPatches([null, 42, "x", { op: "nuke", slot: "tenure" }])).toEqual([]);
  });
});

describe("extractProfilePatches — failure policy (done-when)", () => {
  const gen = (text: string): GenerateFn => vi.fn(async () => text);

  it("returns [] and does not throw when the model call fails", async () => {
    const throwing: GenerateFn = vi.fn(async () => {
      throw new Error("model 503");
    });
    await expect(extractProfilePatches(emptyProfile(), { user: "hi" }, throwing)).resolves.toEqual(
      [],
    );
  });

  it("skips the model entirely for an empty user turn", async () => {
    const generate = vi.fn(async () => "[]");
    await extractProfilePatches(emptyProfile(), { user: "   " }, generate);
    expect(generate).not.toHaveBeenCalled();
  });

  it("a deliberately malformed response cannot corrupt a profile", async () => {
    const base = normalizeProfile({
      tenure: { value: "owner", provenance: "edited", confidence: "high" },
      region: { value: { state: "MA" }, provenance: "stated" },
    });
    const malformed = [
      "total garbage, not even json",
      '{"not":"an array"}',
      // valid array whose patches are individually poisonous:
      JSON.stringify([
        { op: "set", slot: "tenure", value: "renter", provenance: "stated" }, // edited-wins blocks
        { op: "set", slot: "region", value: { zip: 5 }, provenance: "stated" }, // schema-invalid
        { op: "set", slot: "no_such_slot", value: 1, provenance: "stated" }, // unknown slot
        { op: "set", slot: "tenure", value: "landlord", provenance: "inferred" }, // bad enum
      ]),
    ];
    for (const text of malformed) {
      const patches = await extractProfilePatches(base, { user: "whatever" }, gen(text));
      const { profile } = applyPatches(base, patches);
      expect(profile.tenure.value, text).toBe("owner"); // edited value survives
      expect(profile.region.value, text).toEqual({ state: "MA" }); // untouched
    }
  });

  it("applies clean extracted patches end-to-end", async () => {
    const text = JSON.stringify([
      { op: "set", slot: "tenure", value: "renter", provenance: "stated" },
      { op: "append", slot: "goals", value: { text: "cut my bill" }, provenance: "inferred" },
    ]);
    const patches = await extractProfilePatches(emptyProfile(), { user: "I rent" }, gen(text));
    const { profile, rejected } = applyPatches(emptyProfile(), patches);
    expect(rejected).toEqual([]);
    expect(profile.tenure.value).toBe("renter");
    expect(profile.goals.value).toEqual([{ text: "cut my bill" }]);
  });

  it("still applies the valid patches from a partially corrupt response", async () => {
    // A glitched middle object must not cost the clean ones their effect.
    const text =
      '[{"op":"set","slot":"tenure","value":"renter","provenance":"stated"},' +
      '{"op":嘎set","slot":"timeline","value":"this-year","provenance":"stated"},' +
      '{"op":"append","slot":"goals","value":{"text":"cut my bill"},"provenance":"stated"}]';
    const patches = await extractProfilePatches(emptyProfile(), { user: "I rent" }, gen(text));
    const { profile } = applyPatches(emptyProfile(), patches);
    expect(profile.tenure.value).toBe("renter");
    expect(profile.goals.value).toEqual([{ text: "cut my bill" }]);
  });
});
