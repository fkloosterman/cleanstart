/**
 * Lane playbook registry — the single source of truth for the five
 * motivation lanes and the mixed-framing fallback (WP2.1, design §5.1–§5.3).
 *
 * A lane is a *sort and framing*, never a filter: tenure filters which
 * components are eligible; the lane orders and frames them. The user's
 * `motivation_weights` vector is primary; the lane is derived from it
 * (argmax → lane, see `deriveLane` in ./derive), so nothing here is ever
 * stored as the source of truth. Each lane is anchored to exactly one
 * motivation dimension.
 *
 * Adding a lane is a data edit *plus* a library-wide impact backfill — a
 * deliberately expensive content-curation project (§11); it is never a
 * silent code change, and a lane id is never removed or repurposed.
 *
 * COPY IS PLACEHOLDER. The `tone` lines and the framing of report sections
 * are content work (C4) — they land here at placeholder quality, clearly
 * marked, so the wiring can be built and tested before a curator writes the
 * real words.
 */

import type { MotivationDimension, MotivationWeights, SlotName } from "@/lib/profile/registry";

// ---------------------------------------------------------------------------
// Lane and framing identities

export type LaneId =
  | "lower_bills"
  | "climate_impact"
  | "comfort_health"
  | "resilience"
  | "learning";

/**
 * Narrative framing is the only forced discrete choice (§5.1): a concrete
 * lane, or the `"mixed"` fallback when the top two motivations are close.
 * Ranking never uses this — it always uses the blended vector.
 */
export type FramingId = LaneId | "mixed";

export const LANE_IDS: LaneId[] = [
  "lower_bills",
  "climate_impact",
  "comfort_health",
  "resilience",
  "learning",
];

/**
 * Each motivation dimension anchors one lane; `deriveLane` maps the
 * argmax dimension to its lane through this table. Keyed by dimension so
 * it stays exhaustive over `MOTIVATION_DIMENSIONS` at the type level.
 */
export const LANE_BY_DIMENSION: Record<MotivationDimension, LaneId> = {
  cost: "lower_bills",
  carbon: "climate_impact",
  comfort: "comfort_health",
  resilience: "resilience",
  learning: "learning",
};

export const DIMENSION_BY_LANE: Record<LaneId, MotivationDimension> = {
  lower_bills: "cost",
  climate_impact: "carbon",
  comfort_health: "comfort",
  resilience: "resilience",
  learning: "learning",
};

// ---------------------------------------------------------------------------
// Report section framing (§7.1)

/** The report's fixed sections; a playbook orders and weights them. */
export type ReportSectionId =
  | "about_you"
  | "your_goals"
  | "background"
  | "action_plan"
  | "open_questions"
  | "sources";

export interface SectionSpec {
  id: ReportSectionId;
  /**
   * How much room this section gets in this lane's report (§7.1): the
   * `background` explainer block is `full` in `learning` (it *is* the
   * report) and `collapsed` in action-first lanes.
   */
  emphasis: "full" | "standard" | "collapsed";
}

/** The default section order; lanes override individual emphases. */
const STANDARD_SECTIONS: SectionSpec[] = [
  { id: "about_you", emphasis: "standard" },
  { id: "your_goals", emphasis: "standard" },
  { id: "background", emphasis: "standard" },
  { id: "action_plan", emphasis: "full" },
  { id: "open_questions", emphasis: "standard" },
  { id: "sources", emphasis: "standard" },
];

function sectionsWith(overrides: Partial<Record<ReportSectionId, SectionSpec["emphasis"]>>) {
  return STANDARD_SECTIONS.map((s) => ({ ...s, emphasis: overrides[s.id] ?? s.emphasis }));
}

// ---------------------------------------------------------------------------
// The playbook shape

export interface LanePlaybook {
  id: FramingId;
  /**
   * Slots that gate the report for this framing — fed to WP1.1's
   * `readiness()` via `laneReadinessRequirements` (./derive). `learning`
   * needs almost none; the action lanes need to know the home and place.
   */
  required_slots: SlotName[];
  /** What to probe next, in order. Merged across the top two lanes (§5.1). */
  priority_questions: SlotName[];
  /**
   * Default scoring weights when this lane is chosen *explicitly* (e.g. a
   * preset) without a full motivation vector. When the user's own vector
   * exists it is used instead — see `blendImpactWeights`.
   */
  impact_weights: MotivationWeights;
  report_sections: SectionSpec[];
  /** PLACEHOLDER copy (C4): one line steering the chat voice for this lane. */
  tone: string;
}

/**
 * A default weight vector that leans hard on one dimension while leaving
 * the others a small non-zero floor (so a lane-only choice still ranks
 * secondary benefits sensibly). Values are relative; downstream scoring
 * normalizes.
 */
function anchoredWeights(primary: MotivationDimension): MotivationWeights {
  const base: MotivationWeights = {
    cost: 0.1,
    carbon: 0.1,
    comfort: 0.1,
    resilience: 0.1,
    learning: 0.1,
  };
  return { ...base, [primary]: 1 };
}

// ---------------------------------------------------------------------------
// The five lanes + the mixed fallback

export const LANE_PLAYBOOKS: Record<FramingId, LanePlaybook> = {
  lower_bills: {
    id: "lower_bills",
    required_slots: ["tenure", "region", "motivation_weights"],
    priority_questions: ["budget_posture", "existing_systems", "timeline"],
    impact_weights: anchoredWeights("cost"),
    report_sections: sectionsWith({ background: "collapsed", action_plan: "full" }),
    // PLACEHOLDER (C4): "How do I spend less?" — lead with numbers, quick wins first.
    tone: "Lead with concrete savings and quick wins; be honest about payback speed.",
  },
  climate_impact: {
    id: "climate_impact",
    required_slots: ["tenure", "region", "motivation_weights"],
    priority_questions: ["existing_systems", "timeline", "budget_posture"],
    impact_weights: anchoredWeights("carbon"),
    report_sections: sectionsWith({ action_plan: "full" }),
    // PLACEHOLDER (C4): "What actually reduces my footprint?" — rank by carbon, be honest about magnitude.
    tone: "Rank by real carbon impact and be honest about how much each step moves the needle.",
  },
  comfort_health: {
    id: "comfort_health",
    required_slots: ["tenure", "region", "motivation_weights", "existing_systems"],
    priority_questions: ["existing_systems", "housing_type", "timeline"],
    impact_weights: anchoredWeights("comfort"),
    report_sections: sectionsWith({ background: "standard", action_plan: "full" }),
    // PLACEHOLDER (C4): "Why is my home drafty/stuffy/cold?" — problem-first: diagnose, then fix.
    tone: "Start from the discomfort the user describes: diagnose the cause, then fix it.",
  },
  resilience: {
    id: "resilience",
    required_slots: ["tenure", "region", "motivation_weights", "existing_systems"],
    priority_questions: ["existing_systems", "housing_type", "timeline"],
    impact_weights: anchoredWeights("resilience"),
    report_sections: sectionsWith({ action_plan: "full" }),
    // PLACEHOLDER (C4): "What happens when the grid fails?" — scenario-first: outages, backup.
    tone: "Frame around outage scenarios: what fails, what keeps working, how to add backup.",
  },
  learning: {
    // The load-bearing lane (§5.2): it legitimizes users with no project
    // intent, relaxes the gate, and changes the report *type* to a study
    // guide — so it must not pressure a browser into a fake action plan.
    id: "learning",
    required_slots: ["motivation_weights"],
    priority_questions: ["topics_discussed", "tenure", "region"],
    impact_weights: anchoredWeights("learning"),
    report_sections: sectionsWith({ background: "full", action_plan: "collapsed" }),
    // PLACEHOLDER (C4): "Help me understand this space" — a study guide, not an action plan.
    tone: "Teach for understanding: lead with how things work before any tactics or steps.",
  },
  mixed: {
    // Framing-only fallback (§5.1): names both goals and groups the report
    // by technology instead of by a single motivation. Ranking still uses
    // the blended vector, so this is narrative only.
    id: "mixed",
    required_slots: ["tenure", "region", "motivation_weights"],
    priority_questions: ["budget_posture", "existing_systems", "timeline"],
    // Balanced default; in practice `mixed` only arises from a real vector,
    // which `blendImpactWeights` uses in preference to this.
    impact_weights: { cost: 1, carbon: 1, comfort: 1, resilience: 1, learning: 1 },
    report_sections: sectionsWith({}),
    // PLACEHOLDER (C4): name both motivations explicitly; group by technology.
    tone: "Name both of the user's top motivations; organize around technologies, not one goal.",
  },
};
