/**
 * Lane derivation — the pure math that turns a motivation vector into a
 * lane, a framing, and a scoring vector (WP2.1, design §5.1).
 *
 * The vector is primary; everything here is derived and re-derivable, so a
 * mid-session weight shift changes the lane for free:
 *
 * - `deriveLane` — argmax over the dimensions picks the primary lane; the
 *   runner-up is the secondary. When the top two are within
 *   `MIXED_THRESHOLD` (after normalization) the *framing* becomes `"mixed"`
 *   — the one place ambiguity forces a discrete choice. Ranking never
 *   touches this.
 * - `blendImpactWeights` — the vector actually used for scoring. The
 *   user's own normalized vector *is* the blend; only when there is no
 *   vector do we fall back to a framing's default `impact_weights`.
 * - `mergedPriorityQuestions` — the top two lanes' probes, in order,
 *   deduped (§5.1).
 * - `laneReadinessRequirements` — feeds a framing's `required_slots` into
 *   WP1.1's `readiness()`, so the report gate is lane-aware.
 */

import {
  MOTIVATION_DIMENSIONS,
  type MotivationDimension,
  type MotivationWeights,
  type SlotName,
} from "@/lib/profile/registry";
import type { ReadinessRequirements } from "@/lib/profile/readiness";
import {
  DIMENSION_BY_LANE,
  LANE_BY_DIMENSION,
  LANE_PLAYBOOKS,
  type FramingId,
  type LaneId,
} from "@/lib/lanes/playbooks";

/**
 * How close the top two normalized weights must be to force `"mixed"`
 * framing (§5.1, "within ~0.15"). A named constant so the threshold is a
 * data edit, not a magic number buried in a comparison.
 */
export const MIXED_THRESHOLD = 0.15;

const ZERO_WEIGHTS: MotivationWeights = {
  cost: 0,
  carbon: 0,
  comfort: 0,
  resilience: 0,
  learning: 0,
};

/** Sum of a weight vector's known dimensions. */
export function weightSum(weights: MotivationWeights): number {
  return MOTIVATION_DIMENSIONS.reduce((total, dim) => total + weights[dim], 0);
}

/**
 * Read an untrusted value into a clean per-dimension vector and normalize
 * it to sum 1. Missing or non-finite entries and negatives are treated as
 * 0. An all-zero (or absent) input stays all-zero — a deliberate signal of
 * "no motivation known" that callers treat as the degenerate case.
 */
export function normalizeWeights(raw: unknown): MotivationWeights {
  const source = (raw ?? {}) as Record<string, unknown>;
  const clean = { ...ZERO_WEIGHTS };
  for (const dim of MOTIVATION_DIMENSIONS) {
    const v = source[dim];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) clean[dim] = v;
  }
  const total = weightSum(clean);
  if (total === 0) return clean;
  const normalized = { ...ZERO_WEIGHTS };
  for (const dim of MOTIVATION_DIMENSIONS) normalized[dim] = clean[dim] / total;
  return normalized;
}

export interface LaneDerivation {
  /** argmax(weights) — always one of the five lanes. */
  primary: LaneId;
  /** The runner-up lane, or `null` when only one dimension has weight. */
  secondary: LaneId | null;
  /** Narrative framing: `primary`, or `"mixed"` when the top two are close. */
  framing: FramingId;
  /** True iff the top two normalized weights are within `MIXED_THRESHOLD`. */
  mixed: boolean;
  /** The normalized vector the derivation was computed from. */
  weights: MotivationWeights;
}

/** Dimensions sorted by weight desc, ties broken by registry order (stable). */
function rankDimensions(weights: MotivationWeights): MotivationDimension[] {
  return [...MOTIVATION_DIMENSIONS].sort((a, b) => weights[b] - weights[a]);
}

/**
 * Derive the lane, secondary, and framing from a motivation vector.
 *
 * Degenerate case: an all-zero / absent vector carries no motivation
 * signal, so we default to the `learning` framing — the lane that
 * legitimizes a user with no stated project intent (§5.2) — rather than
 * inventing a preference. (In practice `motivation_weights` is a required
 * slot for the action lanes, so the report gate is closed here anyway.)
 */
export function deriveLane(raw: unknown): LaneDerivation {
  const weights = normalizeWeights(raw);

  if (weightSum(weights) === 0) {
    return { primary: "learning", secondary: null, framing: "learning", mixed: false, weights };
  }

  const ranked = rankDimensions(weights);
  const primary = LANE_BY_DIMENSION[ranked[0]];
  const secondHasWeight = weights[ranked[1]] > 0;
  const secondary = secondHasWeight ? LANE_BY_DIMENSION[ranked[1]] : null;

  const mixed = secondHasWeight && weights[ranked[0]] - weights[ranked[1]] <= MIXED_THRESHOLD;
  return {
    primary,
    secondary,
    framing: mixed ? "mixed" : primary,
    mixed,
    weights,
  };
}

/**
 * The scoring weights for ranking candidate components (§5.1, §6.1). The
 * user's own normalized vector is the blend and is used directly; only
 * when no vector exists (a lane picked explicitly, e.g. from a preset) do
 * we fall back to that framing's default `impact_weights`.
 */
export function blendImpactWeights(raw: unknown, framing: FramingId): MotivationWeights {
  const weights = normalizeWeights(raw);
  if (weightSum(weights) > 0) return weights;
  return LANE_PLAYBOOKS[framing].impact_weights;
}

/**
 * The two top lanes' `priority_questions`, primary first, deduped and
 * order-preserving (§5.1: "question priority merges the top two lanes").
 * Pass a derivation; the secondary is skipped when absent.
 */
export function mergedPriorityQuestions(derivation: LaneDerivation): SlotName[] {
  const ordered = [
    ...LANE_PLAYBOOKS[derivation.primary].priority_questions,
    ...(derivation.secondary ? LANE_PLAYBOOKS[derivation.secondary].priority_questions : []),
  ];
  return [...new Set(ordered)];
}

/**
 * A framing's report-gate requirements, in the shape WP1.1's `readiness()`
 * expects. This is how per-lane requirements feed the readiness function:
 * `readiness(profile, laneReadinessRequirements(framing))`.
 */
export function laneReadinessRequirements(framing: FramingId): ReadinessRequirements {
  return { required: LANE_PLAYBOOKS[framing].required_slots };
}

/** Convenience: the anchor dimension of a lane (inverse of `deriveLane`). */
export function laneDimension(lane: LaneId): MotivationDimension {
  return DIMENSION_BY_LANE[lane];
}
