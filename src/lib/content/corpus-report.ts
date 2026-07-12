/**
 * Corpus coverage survey (WP3.3b, design §6.6 gate + C2 curation queue).
 *
 * Measures how complete the content library is **using the production candidate
 * pipeline itself** — the same `filterEligible` + `scoreComponent` from WP3.3
 * that the composer (WP3.6) and chat grounding (WP3.4) will run — over a grid of
 * synthetic profiles spanning the D9 launch scope. If a report would be thin for
 * a real user in some (tenure, region, lane), it is thin here, because the code
 * deciding is identical. Nothing here talks to a database or a model: it reads
 * the validated `content/` records and does pure arithmetic, so a curator gets
 * the same answer locally that CI prints on a content PR.
 *
 * The seven measures (design §3.6 / plan WP3.3b), and why each matters:
 *   1. Pool size per synthetic profile — the number that actually determines
 *      report quality; the worst cells are C2's work queue.
 *   2. Lane coverage — published components with nonzero impact on each lane's
 *      dimension (a lane with no impactful material can't frame a report).
 *   3. Kind mix per cell — five explainers and zero actions is not a usable pool.
 *   4. Prerequisite reachability — components permanently held back because
 *      nothing *published* satisfies their prerequisite chain.
 *   5. Freshness — `last_verified` age distribution and incentives past / near
 *      `expires`.
 *   6. Orphans — media referenced by no published component; presets whose seed
 *      profile resolves to too few components.
 *   7. Projected authored share — the fraction of a report the hybrid composer
 *      (§6.6) would have to *author* rather than *select*, per launch-scope cell.
 *      Its maximum across the grid is the WP3.6 merge gate — a number this tool
 *      prints, not a judgment call.
 *
 * Production-faithful by construction: the pipeline only ever sees `published`
 * components, so every gate metric below is computed over published content
 * only. Draft/retired counts are surfaced in the inventory so an all-empty pool
 * (the expected state of a seed corpus) reads as "nothing reviewed yet", not as
 * a bug.
 *
 * Design note — the grid axes are exactly the *hard filters* that change which
 * components are eligible: tenure × region × housing. Lane and technology
 * interest are deliberately NOT grid axes — they only *order* and *boost/suppress*
 * score, never eligibility, so multiplying the grid by them would inflate the
 * cell count without moving a single pool size (a lane-multiplied grid printed 5
 * identical rows per tenure/region). Housing earns its axis because a house-only
 * action (attic insulation, rooftop solar) is genuinely ineligible for an
 * apartment — so an apartment cell must show that thinner pool. `null` housing
 * models "not yet stated": the conservative floor a report sees before the user
 * reveals their home type. Lane depth is measured directly (lane coverage), and
 * interest depth through per-technology coverage and the preset seeds.
 */

import { buildCandidateContext, filterEligible, IMPACT_DIMENSIONS } from "@/lib/content/candidates";
import {
  COMPONENT_KINDS,
  type ContentComponent,
  type ContentMedia,
  type ContentPreset,
} from "@/lib/content/schema";
import { emptyProfile } from "@/lib/profile/normalize";
import { applyPatches, type ProfilePatch } from "@/lib/profile/patches";
import { DIMENSION_BY_LANE, LANE_IDS, type LaneId } from "@/lib/lanes/playbooks";
import { HOUSING_TYPES, type SessionProfile } from "@/lib/profile/registry";

// ---------------------------------------------------------------------------
// Configuration — placeholder-quality tuning knobs (like WP3.3's scoring
// constants). The D9 gate thresholds are "set once WP3.3b can measure them"
// (plan), so these are clearly-marked defaults, overridable by the CLI; the
// tool's job is to *print the number*, WP3.6's job is to *enforce* it.

export interface CorpusReportConfig {
  /**
   * Launch-scope region ids for the systematic grid (D9: US-national + DMV
   * pilot). "US" models a user whose state we don't yet know; "US-XX" a known
   * DMV state.
   */
  regions: string[];
  /**
   * Housing types for the grid — the second hard-filter axis. `null` models
   * "housing not yet stated" (the conservative floor: only housing-agnostic
   * content is eligible). The concrete types reveal where house-only content
   * leaves apartment/condo/mobile pools thin.
   */
  housingTypes: (string | null)[];
  /**
   * The action-plan size the authored-share projection assumes a report wants.
   * If the eligible pool is smaller, the composer must author the remainder.
   */
  targetReportItems: number;
  /** WP3.6 merge-gate cap on projected authored share (0..1). Placeholder until D9. */
  authoredShareCap: number;
  /** A cell (or preset) pool at or below this size is flagged "thin". */
  thinPoolThreshold: number;
  /** `last_verified` older than this many days is counted as stale. */
  freshnessStaleDays: number;
  /** `expires` within this many days (or already past) is flagged. */
  expiryWarnDays: number;
  /** "Now" for all age/expiry math — injected so the report is a pure function. */
  today: Date;
}

/** DMV pilot + national — the D9 launch region scope. */
export const LAUNCH_REGIONS = ["US", "US-DC", "US-MD", "US-VA"] as const;

/**
 * The housing axis for the grid: `null` ("not yet stated") plus the housing
 * types a *profile* can actually hold (`HOUSING_TYPES` from the profile
 * registry). `null` reproduces the pre-housing behavior (the conservative
 * floor); the concrete types surface where house-only content thins out for
 * flats. Deliberately the profile enum, NOT content/vocabulary.yaml — the grid
 * models real user profiles, and a content file may target a housing tag (e.g.
 * `townhouse`) that no profile can represent, which the coverage of that tag
 * would silently overstate.
 */
export const GRID_HOUSING = [null, ...HOUSING_TYPES] as const;

export const DEFAULT_CORPUS_CONFIG: Omit<CorpusReportConfig, "today"> = {
  regions: [...LAUNCH_REGIONS],
  housingTypes: [...GRID_HOUSING],
  targetReportItems: 5, // PLACEHOLDER (D9/WP3.6): a typical action-plan length
  authoredShareCap: 0.4, // PLACEHOLDER (D9/WP3.6): "≤ the D9 cap" (plan §WP3.6)
  thinPoolThreshold: 3,
  freshnessStaleDays: 365,
  expiryWarnDays: 90,
};

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Report shape

export type ComponentKind = ContentComponent["kind"];

/** Count per component kind — a zeroed record so every kind is always present. */
export type KindMix = Record<ComponentKind, number>;

function zeroKindMix(): KindMix {
  return Object.fromEntries(COMPONENT_KINDS.map((k) => [k, 0])) as KindMix;
}

export interface CellReport {
  /** Human-readable cell id, e.g. "owner · US-VA · single-family" or "preset:community-solar". */
  label: string;
  /** "grid" cells span the launch scope and drive the gate; "preset" cells are supplementary seeds. */
  source: "grid" | "preset";
  tenure: "owner" | "renter" | null;
  region: string;
  /** The grid housing type, `null` for "not yet stated" (and for preset cells). */
  housing: string | null;
  /** Eligible pool size after the real hard filters + prerequisite holdback. */
  poolSize: number;
  kindMix: KindMix;
  /** max(0, 1 − poolSize/target): the share of a report that must be authored, not selected. */
  authoredShare: number;
  /** True when `poolSize <= thinPoolThreshold`. */
  thin: boolean;
}

export interface LaneCoverage {
  lane: LaneId;
  /** The impact dimension this lane ranks by, or null for `learning` (interest-ordered). */
  dimension: string | null;
  /**
   * Published components with nonzero impact on the lane's dimension. For
   * `learning` (no impact dimension) this is the count of published components
   * usable as study-guide material — all of them.
   */
  usableComponents: number;
}

export interface HeldBackComponent {
  slug: string;
  /** The prerequisite slugs that are not satisfiable by any published component. */
  unmetPrerequisites: string[];
}

export interface FreshnessReport {
  /** last_verified age buckets over published components. */
  buckets: { label: string; maxAgeDays: number | null; count: number }[];
  oldestVerifiedDays: number | null;
  /** Published components whose `expires` is already past. */
  expired: { slug: string; kind: ComponentKind; expires: string }[];
  /** Published components expiring within `expiryWarnDays`. */
  expiringSoon: { slug: string; kind: ComponentKind; expires: string; inDays: number }[];
}

export interface OrphanReport {
  /** Media slugs referenced by no published component. */
  unreferencedMedia: string[];
  /** Presets whose seed profile resolves to a thin pool (≤ thinPoolThreshold). */
  thinPresets: { slug: string; poolSize: number }[];
}

export interface TechnologyCoverage {
  technology: string;
  /** Published components tagged with this technology. */
  publishedComponents: number;
}

export interface AuthoredShareGate {
  /** The max projected authored share across launch-scope grid cells — the gate number. */
  maxAuthoredShare: number;
  /** The grid cell that produced it (the thinnest launch-scope cell). */
  worstCell: string | null;
  cap: number;
  /** True when max ≤ cap. Informational here; enforced as WP3.6's merge gate. */
  withinCap: boolean;
  /** How many grid cells exceed the cap. */
  cellsOverCap: number;
}

export interface CorpusReport {
  config: CorpusReportConfig;
  inventory: {
    componentsByStatus: Record<string, number>;
    publishedComponents: number;
    media: number;
    presets: number;
  };
  /** Every synthetic cell, worst (smallest) pool first — the curation work queue. */
  cells: CellReport[];
  laneCoverage: LaneCoverage[];
  technologyCoverage: TechnologyCoverage[];
  heldBack: HeldBackComponent[];
  freshness: FreshnessReport;
  orphans: OrphanReport;
  gate: AuthoredShareGate;
}

// ---------------------------------------------------------------------------
// Synthetic profiles

/** The state code a launch region targets ("US" → none; "US-VA" → "VA"). */
function regionState(region: string): string | null {
  const m = /^US-([A-Z0-9]+)$/.exec(region);
  return m ? m[1] : null;
}

/**
 * A synthetic profile for one (tenure, region, housing): each hard-filter axis
 * set as `stated`. Motivation is deliberately left unset — it drives lane and
 * scoring, neither of which affects *eligibility* (the only thing this grid
 * measures), so seeding it would add nothing. `housing === null` leaves the slot
 * empty, reproducing the pre-housing "not yet stated" behavior. Built through
 * `applyPatches` so it is exactly the shape the production pipeline consumes.
 */
function gridProfile(
  tenure: "owner" | "renter",
  region: string,
  housing: string | null,
): SessionProfile {
  const state = regionState(region);
  const patches: ProfilePatch[] = [
    { op: "set", slot: "tenure", value: tenure, provenance: "stated" },
  ];
  if (state) {
    patches.push({ op: "set", slot: "region", value: { state }, provenance: "stated" });
  }
  if (housing) {
    patches.push({ op: "set", slot: "housing_type", value: housing, provenance: "stated" });
  }
  return applyPatches(emptyProfile(), patches).profile;
}

/** A synthetic profile from a preset's warm-start patches (the real §3.6 path). */
function presetProfile(preset: ContentPreset): SessionProfile {
  return applyPatches(emptyProfile(), preset.profile_patches).profile;
}

// ---------------------------------------------------------------------------
// Per-cell evaluation

function evaluateCell(
  components: ContentComponent[],
  profile: SessionProfile,
  config: CorpusReportConfig,
  base: Pick<CellReport, "label" | "source" | "tenure" | "region" | "housing">,
): CellReport {
  const ctx = buildCandidateContext(profile);
  const eligible = filterEligible(components, ctx);

  const kindMix = zeroKindMix();
  for (const c of eligible) kindMix[c.kind] += 1;

  const poolSize = eligible.length;
  const authoredShare =
    config.targetReportItems > 0 ? Math.max(0, 1 - poolSize / config.targetReportItems) : 0;

  return {
    ...base,
    poolSize,
    kindMix,
    authoredShare,
    thin: poolSize <= config.thinPoolThreshold,
  };
}

/** Build every synthetic cell (grid × launch scope, then preset seeds). */
function buildCells(
  components: ContentComponent[],
  presets: ContentPreset[],
  config: CorpusReportConfig,
): CellReport[] {
  const cells: CellReport[] = [];

  for (const tenure of ["owner", "renter"] as const) {
    for (const region of config.regions) {
      for (const housing of config.housingTypes) {
        cells.push(
          evaluateCell(components, gridProfile(tenure, region, housing), config, {
            label: `${tenure} · ${region} · ${housing ?? "any"}`,
            source: "grid",
            tenure,
            region,
            housing,
          }),
        );
      }
    }
  }

  for (const preset of presets) {
    cells.push(
      evaluateCell(components, presetProfile(preset), config, {
        label: `preset:${preset.slug}`,
        source: "preset",
        tenure: null,
        region: "(preset)",
        housing: null,
      }),
    );
  }

  // Worst (smallest pool) first — the report doubles as C2's work queue.
  // Stable tie-break on label so output is deterministic.
  return cells.sort((a, b) => a.poolSize - b.poolSize || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Global measures

function laneCoverage(published: ContentComponent[]): LaneCoverage[] {
  const impactDims = new Set<string>(IMPACT_DIMENSIONS);
  return LANE_IDS.map((lane) => {
    const dim = DIMENSION_BY_LANE[lane];
    if (!impactDims.has(dim)) {
      // `learning` has no impact axis — a study guide is ordered by interest, so
      // every published component is usable material.
      return { lane, dimension: null, usableComponents: published.length };
    }
    const usable = published.filter(
      (c) => c.impact[dim as (typeof IMPACT_DIMENSIONS)[number]] > 0,
    ).length;
    return { lane, dimension: dim, usableComponents: usable };
  });
}

function technologyCoverage(published: ContentComponent[]): TechnologyCoverage[] {
  const counts = new Map<string, number>();
  for (const c of published) {
    for (const tech of c.technologies) counts.set(tech, (counts.get(tech) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([technology, publishedComponents]) => ({ technology, publishedComponents }))
    .sort(
      (a, b) =>
        a.publishedComponents - b.publishedComponents || a.technology.localeCompare(b.technology),
    );
}

/**
 * Components permanently held back: those whose prerequisite chain can't be
 * satisfied by *published* content. Mirrors WP3.3's `filterPrerequisites` at
 * corpus scope with nothing pre-satisfied — a component is reachable only if
 * every prerequisite is a reachable published component (fixpoint). Anything
 * left over cites a draft/retired/nonexistent prerequisite and can never appear.
 */
function heldBackComponents(published: ContentComponent[]): HeldBackComponent[] {
  const publishedSlugs = new Set(published.map((c) => c.slug));

  // Fixpoint: grow the reachable set until it stops changing.
  let reachable = new Set<string>();
  for (;;) {
    const next = new Set(
      published.filter((c) => c.prerequisites.every((p) => reachable.has(p))).map((c) => c.slug),
    );
    if (next.size === reachable.size) break;
    reachable = next;
  }

  return published
    .filter((c) => !reachable.has(c.slug))
    .map((c) => ({
      slug: c.slug,
      // A prerequisite is unmet if it isn't a published component, or is itself
      // held back (not reachable). Surface the concrete offending slugs.
      unmetPrerequisites: c.prerequisites.filter(
        (p) => !publishedSlugs.has(p) || !reachable.has(p),
      ),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function ageDays(dateStr: string, today: Date): number {
  return Math.floor((today.getTime() - Date.parse(dateStr)) / MS_PER_DAY);
}

function freshnessReport(
  published: ContentComponent[],
  config: CorpusReportConfig,
): FreshnessReport {
  const edges: { label: string; maxAgeDays: number | null }[] = [
    { label: "≤ 90d", maxAgeDays: 90 },
    { label: "91–180d", maxAgeDays: 180 },
    { label: "181–365d", maxAgeDays: 365 },
    { label: "> 365d", maxAgeDays: null },
  ];
  const buckets = edges.map((e) => ({ ...e, count: 0 }));

  let oldest: number | null = null;
  for (const c of published) {
    const age = ageDays(c.last_verified, config.today);
    if (oldest === null || age > oldest) oldest = age;
    const bucket = buckets.find((b) => b.maxAgeDays === null || age <= b.maxAgeDays);
    if (bucket) bucket.count += 1;
  }

  const expired: FreshnessReport["expired"] = [];
  const expiringSoon: FreshnessReport["expiringSoon"] = [];
  for (const c of published) {
    if (!c.expires) continue;
    const inDays = -ageDays(c.expires, config.today); // days until expiry (negative = past)
    if (inDays < 0) {
      expired.push({ slug: c.slug, kind: c.kind, expires: c.expires });
    } else if (inDays <= config.expiryWarnDays) {
      expiringSoon.push({ slug: c.slug, kind: c.kind, expires: c.expires, inDays });
    }
  }
  expired.sort((a, b) => a.expires.localeCompare(b.expires));
  expiringSoon.sort((a, b) => a.inDays - b.inDays);

  return { buckets, oldestVerifiedDays: oldest, expired, expiringSoon };
}

function orphanReport(
  allComponents: ContentComponent[],
  media: ContentMedia[],
  cells: CellReport[],
  config: CorpusReportConfig,
): OrphanReport {
  // Media hygiene spans the lifecycle: a diagram referenced only by a *draft*
  // is not an orphan — it travels with its component to publication. So this
  // check looks at every component regardless of status, unlike the pool
  // metrics, which are production-faithful (published only).
  const referenced = new Set<string>();
  for (const c of allComponents) for (const m of c.media) referenced.add(m);
  const unreferencedMedia = media
    .map((m) => m.slug)
    .filter((slug) => !referenced.has(slug))
    .sort();

  const thinPresets = cells
    .filter((c) => c.source === "preset" && c.poolSize <= config.thinPoolThreshold)
    .map((c) => ({ slug: c.label.replace(/^preset:/, ""), poolSize: c.poolSize }))
    .sort((a, b) => a.poolSize - b.poolSize || a.slug.localeCompare(b.slug));

  return { unreferencedMedia, thinPresets };
}

function authoredShareGate(cells: CellReport[], config: CorpusReportConfig): AuthoredShareGate {
  const grid = cells.filter((c) => c.source === "grid");
  let worst: CellReport | null = null;
  for (const c of grid) {
    if (worst === null || c.authoredShare > worst.authoredShare) worst = c;
  }
  const maxAuthoredShare = worst?.authoredShare ?? 0;
  return {
    maxAuthoredShare,
    worstCell: worst?.label ?? null,
    cap: config.authoredShareCap,
    withinCap: maxAuthoredShare <= config.authoredShareCap,
    cellsOverCap: grid.filter((c) => c.authoredShare > config.authoredShareCap).length,
  };
}

// ---------------------------------------------------------------------------
// Top-level

export interface CorpusInput {
  components: ContentComponent[];
  media: ContentMedia[];
  presets: ContentPreset[];
}

/**
 * Build the full corpus report. Pure: every time-dependent input is in
 * `config.today`, so the same content + config yield the same report.
 */
export function buildCorpusReport(
  content: CorpusInput,
  overrides: Partial<CorpusReportConfig> = {},
): CorpusReport {
  const config: CorpusReportConfig = {
    ...DEFAULT_CORPUS_CONFIG,
    today: new Date(),
    ...overrides,
  };

  const { components, media, presets } = content;
  const published = components.filter((c) => c.status === "published");

  const componentsByStatus: Record<string, number> = {};
  for (const c of components) {
    componentsByStatus[c.status] = (componentsByStatus[c.status] ?? 0) + 1;
  }

  const cells = buildCells(published, presets, config);

  return {
    config,
    inventory: {
      componentsByStatus,
      publishedComponents: published.length,
      media: media.length,
      presets: presets.length,
    },
    cells,
    laneCoverage: laneCoverage(published),
    technologyCoverage: technologyCoverage(published),
    heldBack: heldBackComponents(published),
    freshness: freshnessReport(published, config),
    orphans: orphanReport(components, media, cells, config),
    gate: authoredShareGate(cells, config),
  };
}

// ---------------------------------------------------------------------------
// Human-readable formatting (pure — the CLI just prints the string)

const KIND_ABBR: Record<ComponentKind, string> = {
  action: "act",
  explainer: "exp",
  incentive: "inc",
  resource: "res",
  caveat: "cav",
};

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function kindMixSummary(mix: KindMix): string {
  return COMPONENT_KINDS.map((k) => `${KIND_ABBR[k]} ${mix[k]}`).join("  ");
}

/**
 * A curator-facing text report, worst cells first. Deterministic given a
 * `CorpusReport`, so it can be snapshot-tested and diffed across content PRs.
 */
export function formatCorpusReport(report: CorpusReport): string {
  const out: string[] = [];
  const rule = "─".repeat(72);
  const h = (title: string) => out.push("", rule, title, rule);

  const { inventory, gate, config } = report;

  h("CORPUS COVERAGE REPORT");
  const statusBits = Object.entries(inventory.componentsByStatus)
    .sort()
    .map(([s, n]) => `${n} ${s}`)
    .join(", ");
  out.push(
    `Components: ${inventory.publishedComponents} published` +
      (statusBits ? ` (all: ${statusBits})` : ""),
    `Media: ${inventory.media}   Presets: ${inventory.presets}`,
    `Grid: tenure × ${config.regions.length} region(s) × ${config.housingTypes.length} housing type(s)` +
      `, target report size ${config.targetReportItems}`,
  );

  // The gate number, up top — it's the headline.
  h("PROJECTED AUTHORED SHARE  (WP3.6 gate)");
  out.push(
    `Max across launch-scope cells: ${pct(gate.maxAuthoredShare)}` +
      (gate.worstCell ? `  (worst: ${gate.worstCell})` : ""),
    `Cap (placeholder until D9): ${pct(gate.cap)}  →  ${gate.withinCap ? "WITHIN CAP" : "OVER CAP"}`,
    `Grid cells over cap: ${gate.cellsOverCap}`,
  );

  h("CANDIDATE POOL PER CELL  (worst first — the curation work queue)");
  out.push(`${"pool".padStart(4)}  ${"auth".padStart(4)}  cell`);
  for (const c of report.cells) {
    const flag = c.thin ? " ⚠" : "";
    out.push(
      `${String(c.poolSize).padStart(4)}  ${pct(c.authoredShare).padStart(4)}  ` +
        `${c.label}${flag}   [${kindMixSummary(c.kindMix)}]`,
    );
  }

  h("LANE COVERAGE  (published components with nonzero impact on the lane)");
  for (const l of report.laneCoverage) {
    const dim = l.dimension ? `impact.${l.dimension}` : "interest-ordered (no impact axis)";
    out.push(`${String(l.usableComponents).padStart(4)}  ${l.lane}  — ${dim}`);
  }

  h("TECHNOLOGY COVERAGE  (published components per technology)");
  if (report.technologyCoverage.length === 0) {
    out.push("(no published components tag any technology)");
  } else {
    for (const t of report.technologyCoverage) {
      out.push(`${String(t.publishedComponents).padStart(4)}  ${t.technology}`);
    }
  }

  h("PREREQUISITE REACHABILITY  (permanently held back)");
  if (report.heldBack.length === 0) {
    out.push("None — every published component's prerequisites are satisfiable.");
  } else {
    for (const hb of report.heldBack) {
      out.push(
        `  ${hb.slug} — unmet: ${hb.unmetPrerequisites.join(", ") || "(chain unreachable)"}`,
      );
    }
  }

  h("FRESHNESS  (last_verified age; expiring incentives)");
  for (const b of report.freshness.buckets) {
    out.push(`${String(b.count).padStart(4)}  ${b.label}`);
  }
  if (report.freshness.oldestVerifiedDays !== null) {
    out.push(`Oldest last_verified: ${report.freshness.oldestVerifiedDays}d`);
  }
  for (const e of report.freshness.expired) {
    out.push(`  EXPIRED ${e.expires}  ${e.slug} (${e.kind})`);
  }
  for (const e of report.freshness.expiringSoon) {
    out.push(`  expires in ${e.inDays}d (${e.expires})  ${e.slug} (${e.kind})`);
  }

  h("ORPHANS");
  out.push(
    report.orphans.unreferencedMedia.length === 0
      ? "Unreferenced media: none"
      : `Unreferenced media: ${report.orphans.unreferencedMedia.join(", ")}`,
  );
  if (report.orphans.thinPresets.length === 0) {
    out.push("Thin presets: none");
  } else {
    out.push("Thin presets (pool ≤ threshold):");
    for (const p of report.orphans.thinPresets) {
      out.push(`  ${p.slug} — pool ${p.poolSize}`);
    }
  }

  out.push("");
  return out.join("\n");
}
