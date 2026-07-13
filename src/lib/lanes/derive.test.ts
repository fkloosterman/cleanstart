import { describe, expect, it } from "vitest";
import {
  MIXED_THRESHOLD,
  blendImpactWeights,
  deriveLane,
  laneReadinessRequirements,
  mergedPriorityQuestions,
  normalizeWeights,
  weightSum,
} from "@/lib/lanes/derive";
import { LANE_PLAYBOOKS } from "@/lib/lanes/playbooks";
import { emptyProfile, normalizeProfile } from "@/lib/profile/normalize";
import { readiness } from "@/lib/profile/readiness";

describe("normalizeWeights", () => {
  it("normalizes a positive vector to sum 1", () => {
    const w = normalizeWeights({ cost: 3, carbon: 1 });
    expect(weightSum(w)).toBeCloseTo(1, 10);
    expect(w.cost).toBeCloseTo(0.75, 10);
    expect(w.carbon).toBeCloseTo(0.25, 10);
    expect(w.comfort).toBe(0);
  });

  it("treats missing, negative, and non-finite entries as 0", () => {
    const w = normalizeWeights({ cost: 1, carbon: -5, comfort: Number.NaN, resilience: Infinity });
    expect(w.cost).toBe(1); // the only positive → all the weight
    expect(w.carbon).toBe(0);
    expect(w.comfort).toBe(0);
    expect(w.resilience).toBe(0);
  });

  it("leaves an all-zero / absent vector at zero (the no-signal case)", () => {
    expect(weightSum(normalizeWeights({}))).toBe(0);
    expect(weightSum(normalizeWeights(null))).toBe(0);
    expect(weightSum(normalizeWeights(undefined))).toBe(0);
  });

  it("ignores unknown keys", () => {
    const w = normalizeWeights({ cost: 1, vibes: 99 } as unknown);
    expect(w.cost).toBe(1);
    expect(weightSum(w)).toBeCloseTo(1, 10);
  });
});

describe("deriveLane (§5.1)", () => {
  it("maps a clear argmax to its lane, framing = the lane, not mixed", () => {
    const d = deriveLane({ cost: 8, carbon: 1, comfort: 0, resilience: 0, learning: 0 });
    expect(d.primary).toBe("lower_bills");
    expect(d.secondary).toBe("climate_impact");
    expect(d.framing).toBe("lower_bills");
    expect(d.mixed).toBe(false);
  });

  it("forces mixed framing when the top two are within the threshold", () => {
    // 5/9 vs 4/9 → diff ≈ 0.111 < 0.15
    const d = deriveLane({ cost: 5, carbon: 4 });
    expect(d.primary).toBe("lower_bills");
    expect(d.secondary).toBe("climate_impact");
    expect(d.mixed).toBe(true);
    expect(d.framing).toBe("mixed");
    // The gap is genuinely under the named threshold.
    expect(d.weights.cost - d.weights.carbon).toBeLessThanOrEqual(MIXED_THRESHOLD);
  });

  it("keeps the concrete lane when the top two are far apart", () => {
    const d = deriveLane({ comfort: 9, resilience: 1 });
    expect(d.primary).toBe("comfort_health");
    expect(d.mixed).toBe(false);
    expect(d.framing).toBe("comfort_health");
  });

  it("has no secondary and is never mixed with a single motivation", () => {
    const d = deriveLane({ resilience: 1 });
    expect(d.primary).toBe("resilience");
    expect(d.secondary).toBeNull();
    expect(d.mixed).toBe(false);
    expect(d.framing).toBe("resilience");
  });

  it("defaults to the learning framing on a no-signal vector (§5.2)", () => {
    const d = deriveLane({});
    expect(d.primary).toBe("learning");
    expect(d.secondary).toBeNull();
    expect(d.framing).toBe("learning");
    expect(d.mixed).toBe(false);
  });

  it("breaks ties by registry dimension order (stable, deterministic)", () => {
    // cost and carbon tie; cost comes first in MOTIVATION_DIMENSIONS.
    const d = deriveLane({ cost: 1, carbon: 1 });
    expect(d.primary).toBe("lower_bills");
    expect(d.secondary).toBe("climate_impact");
    expect(d.mixed).toBe(true); // tie → within threshold
  });

  it("re-derives when weights shift (nothing is stored)", () => {
    expect(deriveLane({ cost: 10 }).primary).toBe("lower_bills");
    expect(deriveLane({ carbon: 10 }).primary).toBe("climate_impact");
  });
});

describe("blendImpactWeights", () => {
  it("uses the user's own normalized vector as the blend", () => {
    const w = blendImpactWeights({ cost: 3, comfort: 1 }, "lower_bills");
    expect(w.cost).toBeCloseTo(0.75, 10);
    expect(w.comfort).toBeCloseTo(0.25, 10);
    expect(weightSum(w)).toBeCloseTo(1, 10);
  });

  it("falls back to a framing's default weights when no vector exists", () => {
    expect(blendImpactWeights({}, "resilience")).toEqual(LANE_PLAYBOOKS.resilience.impact_weights);
    expect(blendImpactWeights(null, "mixed")).toEqual(LANE_PLAYBOOKS.mixed.impact_weights);
  });
});

describe("mergedPriorityQuestions (§5.1)", () => {
  it("merges the top two lanes' questions, primary first, deduped", () => {
    const d = deriveLane({ cost: 5, carbon: 4 }); // lower_bills + climate_impact
    const merged = mergedPriorityQuestions(d);
    // primary's list leads; overlapping slots appear once.
    expect(merged.slice(0, 3)).toEqual(LANE_PLAYBOOKS.lower_bills.priority_questions);
    expect(new Set(merged).size).toBe(merged.length);
    // includes climate_impact's distinctive first probe
    expect(merged).toContain("existing_systems");
  });

  it("returns just the primary's questions when there is no secondary", () => {
    const d = deriveLane({ learning: 1 });
    expect(mergedPriorityQuestions(d)).toEqual(LANE_PLAYBOOKS.learning.priority_questions);
  });
});

describe("laneReadinessRequirements — feeds readiness() (WP1.1)", () => {
  it("relaxes the gate for the learning lane", () => {
    const reqs = laneReadinessRequirements("learning");
    expect(reqs.required).toEqual(["motivation_weights"]);
    // A learner who has only stated their motivation is ready.
    const profile = normalizeProfile({
      motivation_weights: {
        value: { cost: 0, carbon: 0, comfort: 0, resilience: 0, learning: 1 },
        provenance: "inferred",
      },
    });
    expect(readiness(profile, reqs).ready).toBe(true);
  });

  it("gates the action lanes on home + place + motivation", () => {
    const reqs = laneReadinessRequirements("lower_bills");
    expect(reqs.required).toContain("tenure");
    expect(reqs.required).toContain("region");
    expect(readiness(emptyProfile(), reqs).ready).toBe(false);
  });
});
