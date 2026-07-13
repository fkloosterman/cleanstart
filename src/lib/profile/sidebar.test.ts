import { describe, expect, it } from "vitest";
import { emptyProfile, normalizeProfile } from "@/lib/profile/normalize";
import { applyPatches, type ProfilePatch } from "@/lib/profile/patches";
import {
  buildSidebarModel,
  enumOptionLabel,
  humanizeEntity,
  slotEditor,
  GROUP_ORDER,
  type SidebarField,
} from "@/lib/profile/sidebar";

const NOW = "2026-07-10T12:00:00Z";

function fieldFor(profile: ReturnType<typeof emptyProfile>, slot: string): SidebarField {
  const model = buildSidebarModel(profile);
  const field = model.flatMap((g) => g.fields).find((f) => f.slot === slot);
  if (!field) throw new Error(`no field for ${slot}`);
  return field;
}

describe("buildSidebarModel — structure", () => {
  it("returns the three groups in order, every registry slot present", () => {
    const model = buildSidebarModel(emptyProfile());
    expect(model.map((g) => g.group)).toEqual(GROUP_ORDER);
    const slots = model.flatMap((g) => g.fields).map((f) => f.slot);
    // 12 registry slots today; the count is derived, not asserted exactly,
    // but each must appear exactly once.
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots).toContain("tenure");
    expect(slots).toContain("preferences");
    expect(slots).toContain("topics_discussed");
  });

  it("groups slots by their registry group", () => {
    const model = buildSidebarModel(emptyProfile());
    const context = model.find((g) => g.group === "context")!;
    expect(context.fields.map((f) => f.slot)).toContain("tenure");
    expect(context.fields.map((f) => f.slot)).toContain("region");
    const intent = model.find((g) => g.group === "intent")!;
    expect(intent.fields.map((f) => f.slot)).toContain("timeline");
  });

  it("marks unfilled slots as unknown with a null value", () => {
    const field = fieldFor(emptyProfile(), "tenure");
    expect(field.filled).toBe(false);
    expect(field.value).toBeNull();
    expect(field.askedUnknown).toBe(false);
  });

  it("flags asked-but-unknown (D3 'not sure yet')", () => {
    const profile = normalizeProfile({
      tenure: { value: null, provenance: "stated", asked_at: NOW },
    });
    const field = fieldFor(profile, "tenure");
    expect(field.filled).toBe(false);
    expect(field.askedUnknown).toBe(true);
  });
});

describe("buildSidebarModel — formatting", () => {
  it("formats scalar enums with friendly labels + carries provenance", () => {
    const profile = normalizeProfile({
      tenure: { value: "owner", provenance: "stated", confidence: "high" },
    });
    const field = fieldFor(profile, "tenure");
    expect(field.value).toEqual({ type: "scalar", text: "Own" });
    expect(field.provenance).toBe("stated");
    expect(field.confidence).toBe("high");
  });

  it("formats region as city, state and never leaks the zip", () => {
    const profile = normalizeProfile({
      region: { value: { state: "MA", city: "Boston", zip: "02118" }, provenance: "stated" },
    });
    const field = fieldFor(profile, "region");
    expect(field.value).toEqual({ type: "scalar", text: "Boston, MA" });
  });

  it("formats the motivation vector as its top weighted dimensions", () => {
    const profile = normalizeProfile({
      motivation_weights: {
        value: { cost: 0.8, carbon: 0.2, comfort: 0.5, resilience: 0, learning: 0 },
        provenance: "inferred",
      },
    });
    const field = fieldFor(profile, "motivation_weights");
    expect(field.value).toEqual({
      type: "scalar",
      text: "Saving money, Comfort & health, Climate impact",
    });
  });

  it("formats household and existing systems", () => {
    const profile = normalizeProfile({
      household: { value: { size: 3, decision_authority: "shared" }, provenance: "stated" },
      existing_systems: { value: { heating: "gas", has_solar: true }, provenance: "stated" },
    });
    expect(fieldFor(profile, "household").value).toEqual({
      type: "scalar",
      text: "3 people · shared decision",
    });
    expect(fieldFor(profile, "existing_systems").value).toEqual({
      type: "scalar",
      text: "gas heating · Has solar",
    });
  });

  it("formats non-preference lists as chip items", () => {
    const profile = normalizeProfile({
      goals: {
        value: [{ text: "Cut my winter bills" }, { text: "Add backup power" }],
        provenance: "stated",
      },
      topics_discussed: { value: ["solar", "heat-pump"], provenance: "inferred" },
    });
    expect(fieldFor(profile, "goals").value).toEqual({
      type: "list",
      items: ["Cut my winter bills", "Add backup power"],
    });
    expect(fieldFor(profile, "topics_discussed").value).toEqual({
      type: "list",
      items: ["Solar", "Heat pump"],
    });
  });

  it("groups preferences by stance in priority→ruled_out order", () => {
    const profile = normalizeProfile({
      preferences: {
        value: [
          { entity: "financing:loan", stance: "ruled_out", note: "no debt", provenance: "stated" },
          { entity: "tech:solar", stance: "priority", provenance: "stated" },
          { entity: "tech:heat-pump", stance: "interested", provenance: "inferred" },
        ],
        provenance: "stated",
      },
    });
    const field = fieldFor(profile, "preferences");
    expect(field.value?.type).toBe("stances");
    const groups = field.value?.type === "stances" ? field.value.groups : [];
    expect(groups.map((g) => g.stance)).toEqual(["priority", "interested", "ruled_out"]);
    expect(groups[0].entries[0]).toEqual({ entity: "tech:solar", label: "Solar", note: undefined });
    expect(groups[2].entries[0].note).toBe("no debt");
  });
});

describe("humanizeEntity / enumOptionLabel", () => {
  it("drops the namespace and humanizes the slug", () => {
    expect(humanizeEntity("tech:heat-pump")).toBe("Heat pump");
    expect(humanizeEntity("financing:loan")).toBe("Loan");
  });
  it("maps known enum options and falls back to humanize", () => {
    expect(enumOptionLabel("tenure", "owner")).toBe("Own");
    expect(enumOptionLabel("timeline", "ready-now")).toBe("Ready now");
  });
});

describe("slotEditor — derived from the registry", () => {
  it("scalar enums expose their options", () => {
    expect(slotEditor("tenure")).toEqual({ kind: "enum", options: ["owner", "renter", "other"] });
    expect(slotEditor("timeline")).toEqual({
      kind: "enum",
      options: ["ready-now", "this-year", "exploring"],
    });
  });
  it("region is free text; preference and other lists get their editors", () => {
    expect(slotEditor("region")).toEqual({ kind: "region" });
    expect(slotEditor("preferences")).toEqual({ kind: "preferences" });
    expect(slotEditor("goals")).toEqual({ kind: "text-list" });
    expect(slotEditor("topics_discussed")).toEqual({ kind: "text-list" });
  });
  it("structured object scalars are read-only", () => {
    expect(slotEditor("motivation_weights")).toEqual({ kind: "readonly" });
    expect(slotEditor("household")).toEqual({ kind: "readonly" });
    expect(slotEditor("existing_systems")).toEqual({ kind: "readonly" });
  });
});

// The load-bearing invariant of WP1.6: a sidebar correction (an "edited"
// patch) must outrank later extraction on the same slot. This exercises the
// exact sequence the UI produces — edit, then an extraction turn — through
// applyPatches, the only write path a sidebar edit takes.
describe("edited-wins survives further extraction", () => {
  const editTenure: ProfilePatch = {
    op: "set",
    slot: "tenure",
    value: "renter",
    provenance: "edited",
  };
  const extractTenure: ProfilePatch = {
    op: "set",
    slot: "tenure",
    value: "owner",
    provenance: "inferred",
  };

  it("a scalar corrected in the sidebar is not overwritten by extraction", () => {
    const start = normalizeProfile({
      tenure: { value: "owner", provenance: "inferred", confidence: "low" },
    });
    const edited = applyPatches(start, [editTenure], NOW).profile;
    expect(fieldFor(edited, "tenure").value).toEqual({ type: "scalar", text: "Rent" });

    // A later extraction turn disagrees; the correction must hold.
    const after = applyPatches(edited, [extractTenure], NOW);
    expect(after.rejected).toHaveLength(1);
    expect(fieldFor(after.profile, "tenure").value).toEqual({ type: "scalar", text: "Rent" });
    expect(after.profile.tenure.provenance).toBe("edited");
  });

  it("a preference stance corrected in the sidebar survives extraction per-entry", () => {
    const start = normalizeProfile({
      preferences: {
        value: [{ entity: "tech:solar", stance: "interested", provenance: "inferred" }],
        provenance: "inferred",
      },
    });
    const ruleOut: ProfilePatch = {
      op: "append",
      slot: "preferences",
      value: {
        entity: "tech:solar",
        stance: "ruled_out",
        note: "shaded roof",
        provenance: "edited",
      },
      provenance: "edited",
    };
    const edited = applyPatches(start, [ruleOut], NOW).profile;

    const reInterested: ProfilePatch = {
      op: "append",
      slot: "preferences",
      value: { entity: "tech:solar", stance: "interested", provenance: "inferred" },
      provenance: "inferred",
    };
    const after = applyPatches(edited, [reInterested], NOW);
    expect(after.rejected).toHaveLength(1);
    const value = fieldFor(after.profile, "preferences").value;
    const groups = value?.type === "stances" ? value.groups : [];
    expect(groups[0].stance).toBe("ruled_out");
  });
});
