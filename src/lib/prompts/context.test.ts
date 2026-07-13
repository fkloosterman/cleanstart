import { describe, expect, it } from "vitest";
import { deriveLane } from "@/lib/lanes/derive";
import { buildContext, deriveStage, type RetrievedComponent } from "@/lib/prompts/context";
import { normalizeProfile } from "@/lib/profile/normalize";

/** Build a normalized profile and its derived lane in one step. */
function ctx(raw: unknown) {
  const profile = normalizeProfile(raw);
  const lane = deriveLane(profile.motivation_weights.value);
  return { profile, lane };
}

// Representative profiles spanning lane, stage, and slot coverage.

const NEW_USER = {};

const RENTER_LOWER_BILLS = {
  tenure: { value: "renter", provenance: "stated", confidence: "high" },
  housing_type: { value: "apartment", provenance: "stated", confidence: "high" },
  motivation_weights: {
    value: { cost: 1, carbon: 0.2, comfort: 0.1, resilience: 0, learning: 0 },
    provenance: "inferred",
  },
  goals: { value: [{ text: "cut my electric bill" }], provenance: "stated" },
};

const MIXED_OWNER = {
  tenure: { value: "owner", provenance: "edited", confidence: "high" },
  region: { value: { state: "MA", city: "Boston", zip: "02118" }, provenance: "stated" },
  existing_systems: { value: { heating: "gas", has_solar: false }, provenance: "inferred" },
  motivation_weights: {
    value: { cost: 5, carbon: 4, comfort: 1, resilience: 0, learning: 0 },
    provenance: "inferred",
  },
  preferences: {
    value: [
      { entity: "tech:solar", stance: "ruled_out", note: "shaded roof", provenance: "stated" },
      { entity: "tech:heat-pump", stance: "interested", provenance: "inferred" },
    ],
    provenance: "inferred",
  },
};

const LEARNER = {
  motivation_weights: {
    value: { cost: 0, carbon: 0, comfort: 0, resilience: 0, learning: 1 },
    provenance: "inferred",
  },
  topics_discussed: { value: ["solar", "heat-pump"], provenance: "inferred" },
};

describe("deriveStage — sufficiency, not turn count (WP1.7/WP2.2)", () => {
  it("is discovery on an empty profile", () => {
    const { profile, lane } = ctx(NEW_USER);
    expect(deriveStage(profile, lane.framing)).toBe("discovery");
  });

  it("is deepening once something is known but the gate is still closed", () => {
    // motivation known → lower_bills, but region is missing so not ready.
    const { profile, lane } = ctx(RENTER_LOWER_BILLS);
    expect(deriveStage(profile, lane.framing)).toBe("deepening");
  });

  it("is synthesis once the lane's required slots are filled", () => {
    const { profile, lane } = ctx(MIXED_OWNER);
    expect(deriveStage(profile, lane.framing)).toBe("synthesis");
  });

  it("is forced to synthesis by a ratcheted report gate even if not currently ready", () => {
    const { profile, lane } = ctx(RENTER_LOWER_BILLS); // would be deepening
    expect(deriveStage(profile, lane.framing, { reportGateOpen: true })).toBe("synthesis");
  });
});

describe("buildContext — assembled prompt (§5.3)", () => {
  it("pins the new-user prompt (empty profile → learning framing, discovery)", () => {
    const { profile, lane } = ctx(NEW_USER);
    expect(
      buildContext({ profile, lane, stage: deriveStage(profile, lane.framing) }),
    ).toMatchSnapshot();
  });

  it("pins a renter lowering bills (partial profile, deepening)", () => {
    const { profile, lane } = ctx(RENTER_LOWER_BILLS);
    expect(
      buildContext({ profile, lane, stage: deriveStage(profile, lane.framing) }),
    ).toMatchSnapshot();
  });

  it("pins a mixed-framing owner (close cost/carbon → both goals named, synthesis)", () => {
    const { profile, lane } = ctx(MIXED_OWNER);
    expect(
      buildContext({ profile, lane, stage: deriveStage(profile, lane.framing) }),
    ).toMatchSnapshot();
  });

  it("pins a learner (learning lane relaxes the gate → study-guide framing)", () => {
    const { profile, lane } = ctx(LEARNER);
    expect(
      buildContext({ profile, lane, stage: deriveStage(profile, lane.framing) }),
    ).toMatchSnapshot();
  });

  it("pins the grounding block when retrieved content is present (WP3.4 plumbing)", () => {
    const { profile, lane } = ctx(RENTER_LOWER_BILLS);
    const retrieved: RetrievedComponent[] = [
      {
        slug: "community-solar-basics",
        title: "Community solar for renters",
        summary: "Subscribe to a shared solar array and get bill credits — no rooftop needed.",
        sources: [{ label: "Community Solar 101", publisher: "DOE" }],
        figures: [
          { slug: "community-solar-diagram", alt: "A shared solar array serving several homes" },
        ],
      },
    ];
    expect(
      buildContext({ profile, lane, stage: deriveStage(profile, lane.framing), retrieved }),
    ).toMatchSnapshot();
  });
});

describe("buildContext — behavioral guarantees", () => {
  const build = (raw: unknown, retrieved?: RetrievedComponent[]) => {
    const { profile, lane } = ctx(raw);
    return buildContext({ profile, lane, stage: deriveStage(profile, lane.framing), retrieved });
  };

  it("always carries the base voice and the brevity policy", () => {
    const out = build(NEW_USER);
    expect(out).toContain("You are Clean Start");
    expect(out).toContain("How to answer:");
    expect(out).toContain("always go deep");
  });

  it("marks known slots established and does not list them as still-to-learn", () => {
    const out = build(RENTER_LOWER_BILLS);
    expect(out).toContain("established — do not ask again");
    expect(out).toContain("Own or rent"); // sidebar label for tenure, now known
    // tenure is known, so it is not in the "still to learn" list
    const stillIdx = out.indexOf("Still to learn");
    expect(stillIdx).toBeGreaterThan(-1);
    expect(out.slice(stillIdx)).not.toContain("Own or rent");
  });

  it("omits the profile summary entirely for a brand-new user", () => {
    expect(build(NEW_USER)).not.toContain("established — do not ask again");
  });

  it("names both motivations under mixed framing", () => {
    const out = build(MIXED_OWNER);
    expect(out).toContain("lowering their bills AND reducing their climate footprint");
  });

  it("does not re-ask an asked-but-unknown slot (§4.1, D3 curious tenure)", () => {
    const out = build({
      tenure: { value: null, provenance: "stated", asked_at: "2026-07-09T00:00:00Z" },
      region: { value: { state: "CA" }, provenance: "stated" },
      motivation_weights: {
        value: { cost: 0, carbon: 0, comfort: 0, resilience: 0, learning: 1 },
        provenance: "inferred",
      },
    });
    const stillIdx = out.indexOf("Still to learn");
    if (stillIdx > -1) expect(out.slice(stillIdx)).not.toContain("Own or rent");
  });

  it("omits grounding when nothing is retrieved, includes it when present", () => {
    expect(build(RENTER_LOWER_BILLS)).not.toContain("Grounding —");
    const grounded = build(RENTER_LOWER_BILLS, [
      { slug: "x", title: "Heat pumps 101", summary: "How they move heat." },
    ]);
    expect(grounded).toContain("Grounding —");
    expect(grounded).toContain("Heat pumps 101");
    expect(grounded).toContain("[x]"); // the citable slug is shown to the agent
  });

  it("teaches the inline cite + figure directives when grounding is present", () => {
    const grounded = build(RENTER_LOWER_BILLS, [
      {
        slug: "hp",
        title: "Heat pumps 101",
        summary: "How they move heat.",
        figures: [{ slug: "hp-cycle", alt: "the refrigerant cycle" }],
      },
    ]);
    expect(grounded).toContain("[cite:<slug>]");
    expect(grounded).toContain("[figure:<slug>]");
    expect(grounded).toContain("hp-cycle"); // the available figure is named
  });
});
