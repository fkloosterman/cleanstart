import { describe, expect, it } from "vitest";
import {
  buildCorpusReport,
  formatCorpusReport,
  LAUNCH_REGIONS,
  type CorpusInput,
} from "@/lib/content/corpus-report";
import type { ContentComponent, ContentMedia, ContentPreset } from "@/lib/content/schema";
import { LANE_IDS } from "@/lib/lanes/playbooks";

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

const TODAY = new Date("2026-07-11T00:00:00Z");

function report(content: Partial<CorpusInput>, overrides = {}) {
  return buildCorpusReport(
    { components: [], media: [], presets: [], ...content },
    { today: TODAY, ...overrides },
  );
}

// --- grid shape -------------------------------------------------------------

describe("grid", () => {
  it("spans tenure × launch regions × lanes, plus one cell per preset", () => {
    const presets: ContentPreset[] = [
      {
        slug: "p1",
        label: "P1",
        category: "c",
        first_message: "hi",
        profile_patches: [],
        tenures: [],
        regions: [],
      },
    ];
    const r = report({ components: [comp()], presets });
    const gridCells = r.cells.filter((c) => c.source === "grid");
    const presetCells = r.cells.filter((c) => c.source === "preset");
    expect(gridCells).toHaveLength(2 * LAUNCH_REGIONS.length * LANE_IDS.length);
    expect(presetCells).toHaveLength(1);
    expect(presetCells[0].label).toBe("preset:p1");
  });

  it("sorts cells worst (smallest pool) first", () => {
    // A US-VA owner-only component: only owner+VA cells see it; everyone else 0.
    const r = report({ components: [comp({ tenures: ["owner"], regions: ["US-VA"] })] });
    const sizes = r.cells.map((c) => c.poolSize);
    expect([...sizes]).toEqual([...sizes].sort((a, b) => a - b));
    expect(sizes[0]).toBe(0);
  });
});

// --- pool size uses the real pipeline (hard filters) ------------------------

describe("pool size", () => {
  it("counts only components eligible for the cell (tenure + region prefix)", () => {
    const r = report({ components: [comp({ tenures: ["owner"], regions: ["US-VA"] })] });
    const ownerVa = r.cells.find((c) => c.label.startsWith("owner · US-VA · lower_bills"));
    const renterVa = r.cells.find((c) => c.label.startsWith("renter · US-VA · lower_bills"));
    const ownerUs = r.cells.find((c) => c.label.startsWith("owner · US · lower_bills"));
    expect(ownerVa?.poolSize).toBe(1);
    expect(renterVa?.poolSize).toBe(0); // wrong tenure
    expect(ownerUs?.poolSize).toBe(0); // no state → no US-VA prefix
  });

  it("excludes draft/retired components (production-faithful)", () => {
    const r = report({
      components: [comp({ status: "draft" }), comp({ status: "retired" })],
    });
    expect(r.inventory.publishedComponents).toBe(0);
    expect(r.cells.every((c) => c.poolSize === 0)).toBe(true);
    expect(r.inventory.componentsByStatus).toEqual({ draft: 1, retired: 1 });
  });
});

// --- kind mix ---------------------------------------------------------------

describe("kind mix", () => {
  it("reports counts per kind in the eligible pool", () => {
    const r = report({
      components: [
        comp({ kind: "action" }),
        comp({ kind: "explainer" }),
        comp({ kind: "explainer" }),
      ],
    });
    const cell = r.cells.find((c) => c.label.startsWith("owner · US · lower_bills"));
    expect(cell?.kindMix).toEqual({
      action: 1,
      explainer: 2,
      incentive: 0,
      resource: 0,
      caveat: 0,
    });
  });
});

// --- projected authored share + gate ----------------------------------------

describe("authored share", () => {
  it("is max(0, 1 − pool/target) per cell", () => {
    // target 4, a cell with 1 eligible → 75% authored.
    const r = report({ components: [comp()] }, { targetReportItems: 4 });
    const cell = r.cells.find((c) => c.label.startsWith("owner · US · lower_bills"));
    expect(cell?.authoredShare).toBeCloseTo(0.75);
  });

  it("caps at 0 (a full pool authors nothing)", () => {
    const many = Array.from({ length: 6 }, () => comp());
    const r = report({ components: many }, { targetReportItems: 4 });
    const cell = r.cells.find((c) => c.label.startsWith("owner · US · lower_bills"));
    expect(cell?.authoredShare).toBe(0);
  });

  it("gate takes the worst grid cell and compares to the cap", () => {
    // Nothing published anywhere → every grid cell authors 100%.
    const r = report({ components: [] }, { targetReportItems: 5, authoredShareCap: 0.4 });
    expect(r.gate.maxAuthoredShare).toBe(1);
    expect(r.gate.withinCap).toBe(false);
    expect(r.gate.cellsOverCap).toBe(2 * LAUNCH_REGIONS.length * LANE_IDS.length);
  });

  it("gate ignores preset cells (only launch-scope grid counts)", () => {
    // Five solar components, untargeted otherwise → every grid cell sees all
    // five (interest never filters), so the grid authors 0%. A preset that
    // rules out solar resolves to an empty pool (would author 100%) — the gate
    // must still read 0%, proving preset cells don't count toward it.
    const solar = Array.from({ length: 5 }, () => comp({ technologies: ["solar"] }));
    const solarAverse: ContentPreset = {
      slug: "solar-averse",
      label: "T",
      category: "c",
      first_message: "hi",
      profile_patches: [
        {
          op: "append",
          slot: "preferences",
          provenance: "stated",
          value: { entity: "tech:solar", stance: "ruled_out", provenance: "stated" },
        },
      ],
      tenures: [],
      regions: [],
    };
    const r = report({ components: solar, presets: [solarAverse] }, { targetReportItems: 5 });
    const presetCell = r.cells.find((c) => c.label === "preset:solar-averse");
    expect(presetCell?.authoredShare).toBe(1); // the preset itself is fully thin
    expect(r.gate.maxAuthoredShare).toBe(0); // …but the gate ignores it
  });
});

// --- lane coverage ----------------------------------------------------------

describe("lane coverage", () => {
  it("counts published components with nonzero impact on each lane's dimension", () => {
    const r = report({
      components: [
        comp({ impact: { cost: 2, carbon: 0, comfort: 0, resilience: 0 } }),
        comp({ impact: { cost: 0, carbon: 3, comfort: 0, resilience: 0 } }),
      ],
    });
    const byLane = Object.fromEntries(r.laneCoverage.map((l) => [l.lane, l.usableComponents]));
    expect(byLane.lower_bills).toBe(1); // one has cost > 0
    expect(byLane.climate_impact).toBe(1); // one has carbon > 0
    expect(byLane.comfort_health).toBe(0);
    expect(byLane.resilience).toBe(0);
  });

  it("treats learning as interest-ordered: every published component is usable", () => {
    const r = report({ components: [comp(), comp()] });
    const learning = r.laneCoverage.find((l) => l.lane === "learning");
    expect(learning?.dimension).toBeNull();
    expect(learning?.usableComponents).toBe(2);
  });
});

// --- technology coverage ----------------------------------------------------

describe("technology coverage", () => {
  it("counts published components per technology, thinnest first", () => {
    const r = report({
      components: [
        comp({ technologies: ["solar"] }),
        comp({ technologies: ["solar", "battery-storage"] }),
      ],
    });
    expect(r.technologyCoverage).toEqual([
      { technology: "battery-storage", publishedComponents: 1 },
      { technology: "solar", publishedComponents: 2 },
    ]);
  });
});

// --- prerequisite reachability ----------------------------------------------

describe("prerequisite reachability", () => {
  it("flags a component whose prerequisite is not a published component", () => {
    const r = report({
      components: [comp({ slug: "adv", prerequisites: ["missing"] })],
    });
    expect(r.heldBack).toEqual([{ slug: "adv", unmetPrerequisites: ["missing"] }]);
  });

  it("flags a component whose prerequisite is only a draft", () => {
    const r = report({
      components: [
        comp({ slug: "basics", status: "draft" }),
        comp({ slug: "adv", prerequisites: ["basics"] }),
      ],
    });
    expect(r.heldBack.map((h) => h.slug)).toEqual(["adv"]);
  });

  it("holds back a whole chain past a broken link (fixpoint)", () => {
    const r = report({
      components: [
        comp({ slug: "adv", prerequisites: ["missing"] }),
        comp({ slug: "expert", prerequisites: ["adv"] }),
      ],
    });
    expect(r.heldBack.map((h) => h.slug)).toEqual(["adv", "expert"]);
  });

  it("does not flag a satisfiable chain", () => {
    const r = report({
      components: [comp({ slug: "basics" }), comp({ slug: "adv", prerequisites: ["basics"] })],
    });
    expect(r.heldBack).toEqual([]);
  });
});

// --- freshness --------------------------------------------------------------

describe("freshness", () => {
  it("buckets last_verified age over published components", () => {
    const r = report({
      components: [
        comp({ last_verified: "2026-07-01" }), // 10d
        comp({ last_verified: "2026-01-01" }), // ~191d
        comp({ last_verified: "2024-01-01" }), // > 365d
      ],
    });
    const byLabel = Object.fromEntries(r.freshness.buckets.map((b) => [b.label, b.count]));
    expect(byLabel["≤ 90d"]).toBe(1);
    expect(byLabel["181–365d"]).toBe(1);
    expect(byLabel["> 365d"]).toBe(1);
    expect(r.freshness.oldestVerifiedDays).toBeGreaterThan(365);
  });

  it("splits expired vs expiring-soon incentives by the warn window", () => {
    const r = report(
      {
        components: [
          comp({ slug: "gone", kind: "incentive", expires: "2026-06-01" }), // past
          comp({ slug: "soon", kind: "incentive", expires: "2026-08-01" }), // ~21d
          comp({ slug: "later", kind: "incentive", expires: "2027-01-01" }), // > 90d
        ],
      },
      { expiryWarnDays: 90 },
    );
    expect(r.freshness.expired.map((e) => e.slug)).toEqual(["gone"]);
    expect(r.freshness.expiringSoon.map((e) => e.slug)).toEqual(["soon"]);
  });
});

// --- orphans ----------------------------------------------------------------

describe("orphans", () => {
  it("flags media referenced by no published component", () => {
    const media: ContentMedia[] = [
      {
        slug: "used",
        kind: "diagram",
        storage_path: "m/used.svg",
        alt: "a",
        caption: "",
        credit: { source: "s", license: "l" },
        technologies: [],
        regions: [],
      },
      {
        slug: "orphan",
        kind: "photo",
        storage_path: "m/orphan.jpg",
        alt: "a",
        caption: "",
        credit: { source: "s", license: "l" },
        technologies: [],
        regions: [],
      },
    ];
    const r = report({ components: [comp({ media: ["used"] })], media });
    expect(r.orphans.unreferencedMedia).toEqual(["orphan"]);
  });

  it("counts media referenced by a draft component as used (lifecycle hygiene)", () => {
    // A diagram travels with its component to publication, so a draft
    // reference means it is NOT an orphan — unlike the production-faithful
    // pool metrics, which see published content only.
    const media: ContentMedia[] = [
      {
        slug: "d",
        kind: "diagram",
        storage_path: "m/d.svg",
        alt: "a",
        caption: "",
        credit: { source: "s", license: "l" },
        technologies: [],
        regions: [],
      },
    ];
    const r = report({ components: [comp({ status: "draft", media: ["d"] })], media });
    expect(r.orphans.unreferencedMedia).toEqual([]);
  });

  it("flags presets whose seed profile resolves to a thin pool", () => {
    // Preset rules out solar; the only component is about solar → pool 0.
    const preset: ContentPreset = {
      slug: "solar-averse",
      label: "S",
      category: "c",
      first_message: "hi",
      profile_patches: [
        {
          op: "append",
          slot: "preferences",
          provenance: "stated",
          value: { entity: "tech:solar", stance: "ruled_out", provenance: "stated" },
        },
      ],
      tenures: [],
      regions: [],
    };
    const r = report(
      { components: [comp({ technologies: ["solar"] })], presets: [preset] },
      { thinPoolThreshold: 0 },
    );
    expect(r.orphans.thinPresets).toEqual([{ slug: "solar-averse", poolSize: 0 }]);
  });
});

// --- formatting -------------------------------------------------------------

describe("formatCorpusReport", () => {
  it("renders the gate number and a worst-first cell table deterministically", () => {
    const r = report({ components: [comp({ tenures: ["owner"], regions: ["US-VA"] })] });
    const text = formatCorpusReport(r);
    expect(text).toContain("PROJECTED AUTHORED SHARE");
    expect(text).toContain("CANDIDATE POOL PER CELL");
    // Deterministic: same report formats identically.
    expect(formatCorpusReport(r)).toBe(text);
  });
});
