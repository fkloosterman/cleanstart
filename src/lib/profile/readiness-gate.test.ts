import { describe, expect, it } from "vitest";
import { emptyProfile, normalizeProfile } from "@/lib/profile/normalize";
import { missingSlotLabels, reportGate } from "@/lib/profile/readiness-gate";

const readyProfile = normalizeProfile({
  tenure: { value: "renter", provenance: "stated" },
  region: { value: { state: "MA", city: "Boston" }, provenance: "stated" },
  motivation_weights: {
    value: { cost: 1, carbon: 0.2, comfort: 0, resilience: 0, learning: 0.1 },
    provenance: "inferred",
  },
  goals: { value: [{ text: "lower bills" }], provenance: "inferred" },
});

// Ready everywhere except a dropped tenure — models "was ready, then edited".
const droppedProfile = normalizeProfile({
  ...readyProfile,
  tenure: { value: null, provenance: null },
});

describe("reportGate (§4.5 ratchet)", () => {
  it("is closed with the missing slots when not ready and never reached", () => {
    expect(reportGate(emptyProfile(), null)).toEqual({
      open: false,
      missing: ["tenure", "region", "motivation_weights", "goals"],
    });
  });

  it("opens and clears missing once the profile is ready", () => {
    expect(reportGate(readyProfile, null)).toEqual({ open: true, missing: [] });
  });

  it("stays open after a required slot is dropped, once a stamp exists (ratchet)", () => {
    // Without the stamp the gate would re-lock…
    expect(reportGate(droppedProfile, null)).toEqual({ open: false, missing: ["tenure"] });
    // …but a prior readiness stamp keeps it open and reports nothing missing.
    expect(reportGate(droppedProfile, "2026-07-10T00:00:00Z")).toEqual({
      open: true,
      missing: [],
    });
  });

  it("a stamp opens the gate even for an empty profile (reached is reached)", () => {
    expect(reportGate(emptyProfile(), "2026-07-10T00:00:00Z").open).toBe(true);
  });
});

describe("missingSlotLabels", () => {
  it("maps slot names to their friendly sidebar labels, in order", () => {
    expect(missingSlotLabels(["tenure", "motivation_weights", "goals"])).toEqual([
      "Own or rent",
      "What matters to you",
      "Goals",
    ]);
  });

  it("is empty for no missing slots", () => {
    expect(missingSlotLabels([])).toEqual([]);
  });
});
