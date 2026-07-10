import { describe, expect, it } from "vitest";
import { emptyProfile, normalizeProfile } from "@/lib/profile/normalize";
import { profileFromUpfront, upfrontPatches } from "@/lib/profile/upfront";

const NOW = "2026-07-09T12:00:00Z";

describe("upfront tenure mapping (§4.8, D3)", () => {
  it("maps homeowner → owner, stated/high, and marks it asked", () => {
    const profile = profileFromUpfront({ tenure: "homeowner", location: null }, undefined, NOW);
    expect(profile.tenure).toMatchObject({
      value: "owner",
      provenance: "stated",
      confidence: "high",
      asked_at: NOW,
    });
  });

  it("maps renter → renter, stated/high", () => {
    const profile = profileFromUpfront({ tenure: "renter", location: null }, undefined, NOW);
    expect(profile.tenure.value).toBe("renter");
    expect(profile.tenure.confidence).toBe("high");
  });

  it("leaves tenure unset but asked for 'curious', and nudges motivation to learning (D3)", () => {
    const profile = profileFromUpfront({ tenure: "curious", location: null }, undefined, NOW);
    expect(profile.tenure.value).toBeNull();
    expect(profile.tenure.asked_at).toBe(NOW); // agent won't re-ask
    expect(profile.motivation_weights.value).toEqual({
      cost: 0,
      carbon: 0,
      comfort: 0,
      resilience: 0,
      learning: 1,
    });
    expect(profile.motivation_weights.provenance).toBe("inferred");
    expect(profile.motivation_weights.confidence).toBe("low"); // a soft, overridable prior
  });

  it("sets nothing when the tenure step is unanswered", () => {
    const profile = profileFromUpfront({ tenure: null, location: null }, undefined, NOW);
    expect(profile).toEqual(emptyProfile());
  });
});

describe("upfront region mapping (§4.8)", () => {
  it("maps a resolved location to region { state, city, zip }, stated/high", () => {
    const profile = profileFromUpfront(
      { tenure: null, location: { zip: "02118", city: "Boston", state: "MA" } },
      undefined,
      NOW,
    );
    expect(profile.region).toMatchObject({
      value: { state: "MA", city: "Boston", zip: "02118" },
      provenance: "stated",
      confidence: "high",
    });
  });

  it("drops fields the region schema doesn't name (no utility leakage)", () => {
    const profile = profileFromUpfront(
      {
        tenure: null,
        location: { zip: "02118", city: "Boston", state: "MA", utility: "Eversource" } as never,
      },
      undefined,
      NOW,
    );
    expect(profile.region.value).toEqual({ state: "MA", city: "Boston", zip: "02118" });
  });

  it("leaves region empty and un-asked when the zip step is skipped (agent may learn it later)", () => {
    const profile = profileFromUpfront({ tenure: "renter", location: null }, undefined, NOW);
    expect(profile.region.value).toBeNull();
    expect(profile.region.asked_at).toBeUndefined();
  });

  it("populates both upfront slots together before the first message", () => {
    const profile = profileFromUpfront(
      { tenure: "homeowner", location: { zip: "22301", city: "Alexandria", state: "VA" } },
      undefined,
      NOW,
    );
    expect(profile.tenure.value).toBe("owner");
    expect(profile.region.value).toEqual({ state: "VA", city: "Alexandria", zip: "22301" });
  });
});

describe("upfront onto an existing profile", () => {
  it("respects edited-wins: an edited tenure is not overwritten by the stepper", () => {
    const base = normalizeProfile({
      tenure: { value: "renter", provenance: "edited", confidence: "high" },
    });
    const profile = profileFromUpfront({ tenure: "homeowner", location: null }, base, NOW);
    expect(profile.tenure.value).toBe("renter"); // user's correction survives
    expect(profile.tenure.provenance).toBe("edited");
  });

  it("fills only the upfront slots, leaving other existing slots intact", () => {
    const base = normalizeProfile({
      goals: { value: [{ text: "lower bills" }], provenance: "inferred" },
    });
    const profile = profileFromUpfront(
      { tenure: "renter", location: { zip: "02118", city: "Boston", state: "MA" } },
      base,
      NOW,
    );
    expect(profile.goals.value).toEqual([{ text: "lower bills" }]);
    expect(profile.tenure.value).toBe("renter");
  });
});

describe("upfrontPatches", () => {
  it("returns no patches for an empty step (skip everything)", () => {
    expect(upfrontPatches({ tenure: null, location: null }, NOW)).toEqual([]);
  });

  it("emits two patches for curious (tenure-asked + motivation nudge)", () => {
    const patches = upfrontPatches({ tenure: "curious", location: null }, NOW);
    expect(patches).toHaveLength(2);
    expect(patches.map((p) => p.slot)).toEqual(["tenure", "motivation_weights"]);
  });
});
