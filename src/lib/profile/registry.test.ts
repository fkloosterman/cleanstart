import { describe, expect, it } from "vitest";
import {
  MOTIVATION_DIMENSIONS,
  PREFERENCE_ENTITY_NAMESPACES,
  SLOT_NAMES,
  SLOT_REGISTRY,
  preferenceSchema,
  slotValueSchema,
} from "@/lib/profile/registry";

describe("SLOT_REGISTRY", () => {
  it("declares the twelve initial slots (§4.2)", () => {
    expect(SLOT_NAMES.sort()).toEqual(
      [
        "tenure",
        "housing_type",
        "region",
        "household",
        "existing_systems",
        "motivation_weights",
        "timeline",
        "budget_posture",
        "goals",
        "constraints",
        "preferences",
        "topics_discussed",
      ].sort(),
    );
  });

  it("marks exactly tenure and region as upfront (§4.8: the bar stays at two)", () => {
    const upfront = SLOT_NAMES.filter((n) => SLOT_REGISTRY[n].elicitation === "upfront");
    expect(upfront.sort()).toEqual(["region", "tenure"]);
  });

  it("matches the design's durable column (§4.2)", () => {
    const durable = SLOT_NAMES.filter((n) => SLOT_REGISTRY[n].durable);
    expect(durable.sort()).toEqual(
      [
        "tenure",
        "housing_type",
        "region",
        "household",
        "existing_systems",
        "motivation_weights",
      ].sort(),
    );
  });

  it("gives every slot an extractor hint and a sidebar declaration", () => {
    for (const name of SLOT_NAMES) {
      const def = SLOT_REGISTRY[name];
      expect(def.extractor_hint.length, name).toBeGreaterThan(10);
      expect(def.sidebar.label.length, name).toBeGreaterThan(0);
      expect(["context", "intent", "lists"], name).toContain(def.sidebar.group);
    }
  });

  it("derives an array schema for list slots and the plain schema for scalars", () => {
    expect(slotValueSchema("goals").safeParse([{ text: "lower bills" }]).success).toBe(true);
    expect(slotValueSchema("goals").safeParse({ text: "lower bills" }).success).toBe(false);
    expect(slotValueSchema("tenure").safeParse("renter").success).toBe(true);
  });

  it("keeps MOTIVATION_DIMENSIONS in lockstep with the motivation_weights schema (§5.1)", () => {
    // The schema is spelled out for a precise inferred type; this guards
    // the const array (which the lanes derive from) against drift.
    const vector = Object.fromEntries(MOTIVATION_DIMENSIONS.map((d) => [d, 0.2]));
    const parsed = slotValueSchema("motivation_weights").safeParse(vector);
    expect(parsed.success).toBe(true);
    // A vector missing any declared dimension must fail — proving the
    // schema requires exactly the dimensions the array lists.
    for (const dim of MOTIVATION_DIMENSIONS) {
      const partial = { ...vector };
      delete partial[dim];
      expect(slotValueSchema("motivation_weights").safeParse(partial).success, dim).toBe(false);
    }
  });

  it("preserves unknown fields on object values (additive evolution, §11)", () => {
    const parsed = slotValueSchema("region").safeParse({
      state: "MA",
      county: "Suffolk", // written by a future bundle
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect((parsed.data as Record<string, unknown>).county).toBe("Suffolk");
  });
});

describe("preference entities (§4.3)", () => {
  it("accepts namespaced entities", () => {
    for (const ns of PREFERENCE_ENTITY_NAMESPACES) {
      expect(
        preferenceSchema.safeParse({
          entity: `${ns}:solar-panels`,
          stance: "curious",
          provenance: "inferred",
        }).success,
      ).toBe(true);
    }
  });

  it("rejects unknown namespaces and un-namespaced entities", () => {
    for (const entity of ["solar", "vibe:solar", "tech:", "tech:Solar Panels"]) {
      expect(
        preferenceSchema.safeParse({ entity, stance: "curious", provenance: "inferred" }).success,
        entity,
      ).toBe(false);
    }
  });

  it("rejects unknown stances", () => {
    expect(
      preferenceSchema.safeParse({
        entity: "tech:solar",
        stance: "hates",
        provenance: "stated",
      }).success,
    ).toBe(false);
  });
});
