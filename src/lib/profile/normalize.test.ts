import { describe, expect, it } from "vitest";
import {
  emptyProfile,
  emptySlot,
  normalizeProfile,
  slotFilled,
  slotValue,
} from "@/lib/profile/normalize";
import { SLOT_NAMES } from "@/lib/profile/registry";

describe("normalizeProfile — junk input", () => {
  it.each([null, undefined, 42, "profile", true, [1, 2]])(
    "returns an empty profile for %s",
    (raw) => {
      expect(normalizeProfile(raw)).toEqual(emptyProfile());
    },
  );

  it("never throws on hostile nesting", () => {
    const profile = normalizeProfile({
      tenure: { value: { deeply: { nested: "junk" } } },
      goals: { value: "not an array" },
      region: 7,
      preferences: { value: [null, 42, []] },
    });
    expect(profile.tenure.value).toBeNull();
    expect(profile.goals.value).toBeNull();
    expect(profile.region.value).toBeNull();
    expect(profile.preferences.value).toBeNull();
  });
});

describe("normalizeProfile — old shapes", () => {
  it("fills slots missing from an older profile with empty envelopes", () => {
    const profile = normalizeProfile({
      tenure: { value: "renter", provenance: "stated", confidence: "high" },
    });
    expect(profile.tenure.value).toBe("renter");
    for (const name of SLOT_NAMES.filter((n) => n !== "tenure")) {
      expect(profile[name], name).toEqual(emptySlot());
    }
  });

  it("coerces an unreadable enum value to null but keeps the envelope metadata", () => {
    const profile = normalizeProfile({
      tenure: {
        value: "curious", // pre-D3 shape that no longer exists
        provenance: "stated",
        confidence: "high",
        asked_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    });
    expect(profile.tenure.value).toBeNull();
    expect(profile.tenure.provenance).toBe("stated");
    expect(profile.tenure.asked_at).toBe("2026-01-01T00:00:00Z");
    expect(profile.tenure.updated_at).toBe("2026-01-01T00:00:00Z");
  });

  it("defaults junk provenance/confidence instead of failing the slot", () => {
    const profile = normalizeProfile({
      timeline: { value: "exploring", provenance: "guessed", confidence: 3 },
    });
    expect(profile.timeline.value).toBe("exploring");
    expect(profile.timeline.provenance).toBeNull();
    expect(profile.timeline.confidence).toBe("low");
  });
});

describe("normalizeProfile — unknown keys pass through (§11)", () => {
  it("keeps top-level keys written by a newer bundle, untouched", () => {
    const futureSlot = { value: "something", provenance: "stated", extra: true };
    const profile = normalizeProfile({ future_slot: futureSlot });
    expect((profile as Record<string, unknown>).future_slot).toEqual(futureSlot);
  });

  it("keeps unknown fields inside object slot values", () => {
    const profile = normalizeProfile({
      region: { value: { state: "MA", city: "Boston", county: "Suffolk" } },
    });
    expect(profile.region.value).toEqual({ state: "MA", city: "Boston", county: "Suffolk" });
  });
});

describe("normalizeProfile — per-entry list healing", () => {
  it("drops junk list entries and keeps valid ones", () => {
    const profile = normalizeProfile({
      goals: { value: [{ text: "lower bills" }, { text: "" }, "junk", null] },
    });
    expect(profile.goals.value).toEqual([{ text: "lower bills" }]);
  });

  it("normalizes an all-junk list to null", () => {
    const profile = normalizeProfile({ topics_discussed: { value: [42, ""] } });
    expect(profile.topics_discussed.value).toBeNull();
  });
});

describe("slotFilled / slotValue", () => {
  it("treats null, empty lists, and never-set slots as unfilled", () => {
    const profile = emptyProfile();
    expect(slotFilled(profile.tenure)).toBe(false);
    expect(slotFilled({ ...emptySlot(), value: [] })).toBe(false);
    expect(slotFilled({ ...emptySlot(), value: "renter" })).toBe(true);
    expect(slotFilled({ ...emptySlot(), value: [{ text: "x" }] })).toBe(true);
  });

  it("slotValue returns the normalized value", () => {
    const profile = normalizeProfile({ tenure: { value: "owner" } });
    expect(slotValue(profile, "tenure")).toBe("owner");
    expect(slotValue(profile, "region")).toBeNull();
  });

  it("an asked-but-unanswered slot (D3 'not sure yet') is not filled", () => {
    const profile = normalizeProfile({
      tenure: { value: null, provenance: "stated", asked_at: "2026-07-09T00:00:00Z" },
    });
    expect(slotFilled(profile.tenure)).toBe(false);
    expect(profile.tenure.asked_at).toBe("2026-07-09T00:00:00Z");
  });
});
