import { describe, expect, it } from "vitest";
import { emptyProfile, normalizeProfile } from "@/lib/profile/normalize";
import { applyPatches, type ProfilePatch } from "@/lib/profile/patches";

const NOW = "2026-07-09T12:00:00Z";

function set(slot: string, value: unknown, provenance = "inferred", extra = {}): ProfilePatch {
  return { op: "set", slot, value, provenance, ...extra } as ProfilePatch;
}

describe("applyPatches — set", () => {
  it("sets a scalar with validated value, provenance, and timestamps", () => {
    const { profile, rejected } = applyPatches(emptyProfile(), [set("tenure", "renter")], NOW);
    expect(rejected).toEqual([]);
    expect(profile.tenure).toEqual({
      value: "renter",
      provenance: "inferred",
      confidence: "low",
      updated_at: NOW,
    });
  });

  it("defaults confidence by provenance: stated/edited high, inferred low", () => {
    const { profile } = applyPatches(
      emptyProfile(),
      [set("tenure", "renter", "stated"), set("timeline", "exploring", "inferred")],
      NOW,
    );
    expect(profile.tenure.confidence).toBe("high");
    expect(profile.timeline.confidence).toBe("low");
  });

  it("forces propagated values to low confidence even if the patch claims high (§4.4)", () => {
    const { profile } = applyPatches(
      emptyProfile(),
      [set("region", { state: "MA" }, "propagated", { confidence: "high" })],
      NOW,
    );
    expect(profile.region.confidence).toBe("low");
    expect(profile.region.provenance).toBe("propagated");
  });

  it("rejects invalid values without touching the slot", () => {
    const before = normalizeProfile({ tenure: { value: "owner", provenance: "stated" } });
    const { profile, rejected } = applyPatches(before, [set("tenure", "landlord")], NOW);
    expect(profile.tenure.value).toBe("owner");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain("tenure");
  });

  it("accepts value null with asked_at — D3's 'not sure yet'", () => {
    const { profile, rejected } = applyPatches(
      emptyProfile(),
      [set("tenure", null, "stated", { asked_at: NOW })],
      NOW,
    );
    expect(rejected).toEqual([]);
    expect(profile.tenure.value).toBeNull();
    expect(profile.tenure.asked_at).toBe(NOW);
  });

  it("can replace a whole list via set (sidebar edit)", () => {
    const { profile } = applyPatches(
      emptyProfile(),
      [set("goals", [{ text: "lower bills" }, { text: "backup power" }], "edited")],
      NOW,
    );
    expect(profile.goals.value).toHaveLength(2);
    expect(profile.goals.provenance).toBe("edited");
  });
});

describe("applyPatches — edited wins (§4.4)", () => {
  const edited = normalizeProfile({
    tenure: { value: "owner", provenance: "edited", confidence: "high" },
  });

  it("rejects non-edited set on an edited slot", () => {
    for (const provenance of ["stated", "inferred", "propagated"]) {
      const { profile, rejected } = applyPatches(
        edited,
        [set("tenure", "renter", provenance)],
        NOW,
      );
      expect(profile.tenure.value, provenance).toBe("owner");
      expect(rejected[0].reason).toContain("edited");
    }
  });

  it("rejects non-edited clear on an edited slot", () => {
    const { profile, rejected } = applyPatches(
      edited,
      [{ op: "clear", slot: "tenure", provenance: "inferred" }],
      NOW,
    );
    expect(profile.tenure.value).toBe("owner");
    expect(rejected).toHaveLength(1);
  });

  it("allows an edited patch to overwrite an edited slot", () => {
    const { profile, rejected } = applyPatches(edited, [set("tenure", "renter", "edited")], NOW);
    expect(rejected).toEqual([]);
    expect(profile.tenure.value).toBe("renter");
  });
});

describe("applyPatches — append", () => {
  it("appends validated entries to a list", () => {
    const { profile } = applyPatches(
      emptyProfile(),
      [
        { op: "append", slot: "goals", value: { text: "lower bills" }, provenance: "inferred" },
        { op: "append", slot: "goals", value: { text: "backup power" }, provenance: "inferred" },
      ],
      NOW,
    );
    expect(profile.goals.value).toEqual([{ text: "lower bills" }, { text: "backup power" }]);
  });

  it("rejects append on a scalar slot", () => {
    const { rejected } = applyPatches(
      emptyProfile(),
      [{ op: "append", slot: "tenure", value: "renter", provenance: "inferred" }],
      NOW,
    );
    expect(rejected[0].reason).toContain("scalar");
  });

  it("suppresses exact duplicates without rejecting", () => {
    const patch: ProfilePatch = {
      op: "append",
      slot: "topics_discussed",
      value: "solar",
      provenance: "inferred",
    };
    const { profile, rejected } = applyPatches(emptyProfile(), [patch, patch], NOW);
    expect(profile.topics_discussed.value).toEqual(["solar"]);
    expect(rejected).toEqual([]);
  });

  it("still appends new entries to a user-edited list, keeping the edited marker", () => {
    const before = normalizeProfile({
      goals: { value: [{ text: "kept" }], provenance: "edited", confidence: "high" },
    });
    const { profile, rejected } = applyPatches(
      before,
      [{ op: "append", slot: "goals", value: { text: "new" }, provenance: "inferred" }],
      NOW,
    );
    expect(rejected).toEqual([]);
    expect(profile.goals.value).toEqual([{ text: "kept" }, { text: "new" }]);
    expect(profile.goals.provenance).toBe("edited"); // set/clear protection survives
  });
});

describe("applyPatches — preferences upsert by entity (§4.3)", () => {
  const curious = {
    entity: "tech:solar",
    stance: "curious",
    provenance: "inferred",
  };

  it("replaces the stance for an existing entity instead of duplicating", () => {
    const { profile } = applyPatches(
      emptyProfile(),
      [
        { op: "append", slot: "preferences", value: curious, provenance: "inferred" },
        {
          op: "append",
          slot: "preferences",
          value: { ...curious, stance: "priority" },
          provenance: "inferred",
        },
      ],
      NOW,
    );
    expect(profile.preferences.value).toEqual([{ ...curious, stance: "priority" }]);
  });

  it("never lets the extractor overwrite a user-edited preference entry", () => {
    const before = applyPatches(
      emptyProfile(),
      [
        {
          op: "append",
          slot: "preferences",
          value: { entity: "tech:solar", stance: "ruled_out", provenance: "edited" },
          provenance: "edited",
        },
      ],
      NOW,
    ).profile;

    const { profile, rejected } = applyPatches(
      before,
      [{ op: "append", slot: "preferences", value: curious, provenance: "inferred" }],
      NOW,
    );
    expect(profile.preferences.value).toEqual([
      { entity: "tech:solar", stance: "ruled_out", provenance: "edited" },
    ]);
    expect(rejected[0].reason).toContain("tech:solar");
  });

  it("rejects preferences with unknown entity namespaces", () => {
    const { rejected } = applyPatches(
      emptyProfile(),
      [
        {
          op: "append",
          slot: "preferences",
          value: { entity: "vibes:solar", stance: "curious", provenance: "inferred" },
          provenance: "inferred",
        },
      ],
      NOW,
    );
    expect(rejected).toHaveLength(1);
  });
});

describe("applyPatches — clear", () => {
  it("clears the value but keeps asked_at (don't re-ask)", () => {
    const before = normalizeProfile({
      timeline: {
        value: "exploring",
        provenance: "inferred",
        asked_at: "2026-07-01T00:00:00Z",
      },
    });
    const { profile } = applyPatches(
      before,
      [{ op: "clear", slot: "timeline", provenance: "edited" }],
      NOW,
    );
    expect(profile.timeline.value).toBeNull();
    expect(profile.timeline.provenance).toBe("edited");
    expect(profile.timeline.asked_at).toBe("2026-07-01T00:00:00Z");
    expect(profile.timeline.updated_at).toBe(NOW);
  });
});

describe("applyPatches — malformed input cannot corrupt a profile", () => {
  it("rejects malformed patches individually and applies the rest", () => {
    const { profile, rejected } = applyPatches(
      emptyProfile(),
      [
        null,
        "set tenure",
        { op: "explode", slot: "tenure" },
        { op: "set", slot: "no_such_slot", value: 1, provenance: "inferred" },
        { op: "set", slot: "tenure", value: "renter" }, // missing provenance
        set("tenure", "renter", "stated"),
      ],
      NOW,
    );
    expect(profile.tenure.value).toBe("renter");
    expect(rejected).toHaveLength(5);
  });

  it("normalizes junk profile input before patching", () => {
    const { profile } = applyPatches("garbage", [set("tenure", "owner", "stated")], NOW);
    expect(profile.tenure.value).toBe("owner");
    expect(profile.goals.value).toBeNull();
  });

  it("does not mutate the input profile", () => {
    const before = emptyProfile();
    const snapshot = JSON.parse(JSON.stringify(before));
    applyPatches(before, [set("tenure", "renter", "stated")], NOW);
    expect(before).toEqual(snapshot);
  });
});
