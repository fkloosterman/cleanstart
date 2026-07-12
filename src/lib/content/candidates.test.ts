import { describe, expect, it } from "vitest";
import {
  buildCandidateContext,
  filterEligible,
  rankCandidates,
  scoreComponent,
  selectCandidates,
  type CandidateContext,
} from "@/lib/content/candidates";
import type { ContentComponent } from "@/lib/content/schema";
import { emptyProfile } from "@/lib/profile/normalize";
import { applyPatches } from "@/lib/profile/patches";
import type { ProfilePatch } from "@/lib/profile/patches";

// --- fixtures ---------------------------------------------------------------

let n = 0;
function comp(overrides: Partial<ContentComponent> = {}): ContentComponent {
  return {
    slug: `c-${n++}`,
    kind: "action",
    title: "T",
    summary: "s",
    body_md: "b",
    technologies: [],
    lanes: [],
    tenures: [],
    housing_types: [],
    regions: [],
    prerequisites: [],
    effort: "trivial",
    impact: { cost: 0, carbon: 0, comfort: 0, resilience: 0 },
    sources: [],
    last_verified: "2026-07-11",
    status: "published",
    version: 1,
    media: [],
    ...overrides,
  };
}

/** A permissive context (matches everything) that tests narrow per-axis. */
function ctx(overrides: Partial<CandidateContext> = {}): CandidateContext {
  return {
    tenure: null,
    housingType: null,
    regionPrefixes: new Set(["US"]),
    interests: new Map(),
    ruledOutTechs: new Set(),
    satisfied: new Set(),
    weights: { cost: 1, carbon: 0, comfort: 0, resilience: 0, learning: 0 },
    ...overrides,
  };
}

const slugs = (cs: { slug: string }[] | { component: { slug: string } }[]) =>
  cs.map((c) => ("slug" in c ? c.slug : c.component.slug)).sort();

// --- eligibility: per-axis --------------------------------------------------

describe("filterEligible — status", () => {
  it("surfaces only published components", () => {
    const pool = [
      comp({ slug: "pub", status: "published" }),
      comp({ slug: "draft", status: "draft" }),
      comp({ slug: "retired", status: "retired" }),
    ];
    expect(slugs(filterEligible(pool, ctx()))).toEqual(["pub"]);
  });
});

describe("filterEligible — tenure", () => {
  const pool = [
    comp({ slug: "any", tenures: [] }),
    comp({ slug: "owner", tenures: ["owner"] }),
    comp({ slug: "renter", tenures: ["renter"] }),
  ];
  it("owner sees untargeted + owner", () => {
    expect(slugs(filterEligible(pool, ctx({ tenure: "owner" })))).toEqual(["any", "owner"]);
  });
  it("unknown tenure sees only untargeted", () => {
    expect(slugs(filterEligible(pool, ctx({ tenure: null })))).toEqual(["any"]);
  });
});

describe("filterEligible — housing", () => {
  const pool = [
    comp({ slug: "any", housing_types: [] }),
    comp({ slug: "sf", housing_types: ["single-family"] }),
  ];
  it("matches the user's housing type", () => {
    expect(slugs(filterEligible(pool, ctx({ housingType: "single-family" })))).toEqual([
      "any",
      "sf",
    ]);
    expect(slugs(filterEligible(pool, ctx({ housingType: "apartment" })))).toEqual(["any"]);
  });
});

describe("filterEligible — region prefix", () => {
  const pool = [
    comp({ slug: "anywhere", regions: [] }),
    comp({ slug: "us", regions: ["US"] }),
    comp({ slug: "va", regions: ["US-VA"] }),
    comp({ slug: "ca", regions: ["US-CA"] }),
  ];
  it("a VA user matches anywhere/US/US-VA but not US-CA", () => {
    expect(slugs(filterEligible(pool, ctx({ regionPrefixes: new Set(["US", "US-VA"]) })))).toEqual([
      "anywhere",
      "us",
      "va",
    ]);
  });
  it("a user with no state matches anywhere/US only", () => {
    expect(slugs(filterEligible(pool, ctx({ regionPrefixes: new Set(["US"]) })))).toEqual([
      "anywhere",
      "us",
    ]);
  });
});

describe("filterEligible — ruled-out suppression", () => {
  it("hides a component about any ruled-out technology", () => {
    const pool = [
      comp({ slug: "solar", technologies: ["solar"] }),
      comp({ slug: "solar-battery", technologies: ["solar", "battery-storage"] }),
      comp({ slug: "hp", technologies: ["heat-pump"] }),
    ];
    const result = filterEligible(pool, ctx({ ruledOutTechs: new Set(["solar"]) }));
    expect(slugs(result)).toEqual(["hp"]);
  });
});

describe("filterEligible — prerequisite holdback", () => {
  it("holds back a component whose prerequisite is not present", () => {
    const pool = [comp({ slug: "advanced", prerequisites: ["basics"] })];
    expect(filterEligible(pool, ctx())).toEqual([]);
  });
  it("bundles a component with its prerequisite when both are eligible", () => {
    const pool = [comp({ slug: "basics" }), comp({ slug: "advanced", prerequisites: ["basics"] })];
    expect(slugs(filterEligible(pool, ctx()))).toEqual(["advanced", "basics"]);
  });
  it("treats an already-satisfied prerequisite as met", () => {
    const pool = [comp({ slug: "advanced", prerequisites: ["done"] })];
    expect(slugs(filterEligible(pool, ctx({ satisfied: new Set(["done"]) })))).toEqual([
      "advanced",
    ]);
  });
  it("holds back a whole chain when its root is ineligible (fixpoint)", () => {
    // root is renter-only, so an owner can't have it → b and c held back too.
    const pool = [
      comp({ slug: "root", tenures: ["renter"] }),
      comp({ slug: "b", prerequisites: ["root"] }),
      comp({ slug: "c", prerequisites: ["b"] }),
      comp({ slug: "standalone" }),
    ];
    expect(slugs(filterEligible(pool, ctx({ tenure: "owner" })))).toEqual(["standalone"]);
  });
});

// --- scoring ----------------------------------------------------------------

describe("scoreComponent", () => {
  it("computes weights · impact over the four impact dimensions", () => {
    const c = comp({ impact: { cost: 3, carbon: 1, comfort: 0, resilience: 0 } });
    const weights = { cost: 0.5, carbon: 0.5, comfort: 0, resilience: 0, learning: 0 };
    const { breakdown, score } = scoreComponent(c, ctx({ weights }));
    expect(breakdown.impact).toBeCloseTo(0.5 * 3 + 0.5 * 1); // 2.0
    expect(score).toBeCloseTo(2.0);
  });

  it("adds an interest boost for a matching technology stance", () => {
    const c = comp({ technologies: ["solar"] });
    const withInterest = scoreComponent(c, ctx({ interests: new Map([["solar", "priority"]]) }));
    expect(withInterest.breakdown.interest).toBeCloseTo(0.5);
    expect(scoreComponent(c, ctx()).breakdown.interest).toBe(0);
  });

  it("subtracts an effort penalty", () => {
    const trivial = scoreComponent(comp({ effort: "trivial" }), ctx());
    const major = scoreComponent(comp({ effort: "major" }), ctx());
    expect(trivial.breakdown.effort).toBe(0);
    expect(major.breakdown.effort).toBe(0.5);
    expect(major.score).toBeCloseTo(trivial.score - 0.5);
  });
});

describe("rankCandidates", () => {
  it("orders by score descending", () => {
    const weights = { cost: 1, carbon: 0, comfort: 0, resilience: 0, learning: 0 };
    const pool = [
      comp({ slug: "low", impact: { cost: 1, carbon: 0, comfort: 0, resilience: 0 } }),
      comp({ slug: "high", impact: { cost: 3, carbon: 0, comfort: 0, resilience: 0 } }),
      comp({ slug: "mid", impact: { cost: 2, carbon: 0, comfort: 0, resilience: 0 } }),
    ];
    expect(rankCandidates(pool, ctx({ weights })).map((s) => s.component.slug)).toEqual([
      "high",
      "mid",
      "low",
    ]);
  });

  it("breaks score ties by slug for stable ordering", () => {
    const pool = [comp({ slug: "b" }), comp({ slug: "a" })];
    expect(rankCandidates(pool, ctx()).map((s) => s.component.slug)).toEqual(["a", "b"]);
  });

  it("caps the shortlist at the limit", () => {
    const pool = Array.from({ length: 20 }, (_, i) => comp({ slug: `x${i}` }));
    expect(rankCandidates(pool, ctx(), 5)).toHaveLength(5);
  });
});

// --- integration from a profile --------------------------------------------

describe("selectCandidates (profile → shortlist)", () => {
  const set = (slot: string, value: unknown): ProfilePatch =>
    ({ op: "set", slot, value, provenance: "stated" }) as ProfilePatch;
  const append = (value: unknown): ProfilePatch =>
    ({ op: "append", slot: "preferences", value, provenance: "stated" }) as ProfilePatch;

  const profile = applyPatches(emptyProfile(), [
    set("tenure", "owner"),
    set("region", { state: "VA" }),
    set("housing_type", "single-family"),
    set("motivation_weights", { cost: 1, carbon: 0, comfort: 0, resilience: 0, learning: 0 }),
    append({ entity: "tech:solar", stance: "interested", provenance: "stated" }),
    append({ entity: "tech:heat-pump", stance: "ruled_out", provenance: "stated" }),
  ]).profile;

  it("derives tenure, region prefixes, interests, and ruled-out from the profile", () => {
    const c = buildCandidateContext(profile);
    expect(c.tenure).toBe("owner");
    expect([...c.regionPrefixes].sort()).toEqual(["US", "US-VA"]);
    expect(c.interests.get("solar")).toBe("interested");
    expect(c.ruledOutTechs.has("heat-pump")).toBe(true);
  });

  it("suppresses ruled-out topics and boosts interested ones end-to-end", () => {
    const pool = [
      comp({ slug: "solar-va", technologies: ["solar"], tenures: ["owner"], regions: ["US-VA"] }),
      comp({ slug: "heatpump", technologies: ["heat-pump"] }), // ruled out → gone
      comp({ slug: "ca-only", regions: ["US-CA"] }), // wrong region → gone
    ];
    const ranked = selectCandidates(pool, profile);
    expect(ranked.map((s) => s.component.slug)).toEqual(["solar-va"]);
    expect(ranked[0].breakdown.interest).toBeGreaterThan(0);
  });
});
