import { describe, expect, it } from "vitest";
import { emptyProfile, normalizeProfile } from "@/lib/profile/normalize";
import { DEFAULT_READINESS_REQUIREMENTS, readiness } from "@/lib/profile/readiness";

const fullProfile = normalizeProfile({
  tenure: { value: "renter", provenance: "stated" },
  region: { value: { state: "MA", city: "Boston" }, provenance: "stated" },
  motivation_weights: {
    value: { cost: 1, carbon: 0.2, comfort: 0, resilience: 0, learning: 0.1 },
    provenance: "inferred",
  },
  goals: { value: [{ text: "lower bills" }], provenance: "inferred" },
});

describe("readiness (§4.5)", () => {
  it("is 0 / not ready on an empty profile, listing all required slots in order", () => {
    const result = readiness(emptyProfile());
    expect(result).toEqual({
      score: 0,
      missing: DEFAULT_READINESS_REQUIREMENTS.required,
      ready: false,
    });
  });

  it("is 100 / ready when every required slot is filled", () => {
    expect(readiness(fullProfile)).toEqual({ score: 100, missing: [], ready: true });
  });

  it("scores partially and names exactly what's missing", () => {
    const partial = normalizeProfile({
      tenure: { value: "owner", provenance: "stated" },
      region: { value: { state: "VA" }, provenance: "stated" },
    });
    const result = readiness(partial);
    expect(result.score).toBe(50);
    expect(result.missing).toEqual(["motivation_weights", "goals"]);
    expect(result.ready).toBe(false);
  });

  it("treats an asked-but-unknown slot (D3) as still missing", () => {
    const asked = normalizeProfile({
      ...fullProfile,
      tenure: { value: null, provenance: "stated", asked_at: "2026-07-09T00:00:00Z" },
    });
    const result = readiness(asked);
    expect(result.missing).toEqual(["tenure"]);
    expect(result.ready).toBe(false);
  });

  it("treats an empty required list as missing", () => {
    const emptied = normalizeProfile({ ...fullProfile, goals: { value: [] } });
    expect(readiness(emptied).missing).toEqual(["goals"]);
  });

  it("accepts custom requirements (lane playbooks, WP2.1)", () => {
    const learningLane = { required: ["motivation_weights" as const] };
    expect(readiness(fullProfile, learningLane)).toEqual({
      score: 100,
      missing: [],
      ready: true,
    });
    expect(readiness(emptyProfile(), learningLane).score).toBe(0);
  });

  it("is ready with no requirements at all", () => {
    expect(readiness(emptyProfile(), { required: [] })).toEqual({
      score: 100,
      missing: [],
      ready: true,
    });
  });
});
