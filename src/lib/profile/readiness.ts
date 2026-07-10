/**
 * Readiness — the information-sufficiency gate that replaces the
 * "3 assistant turns" rule (WP1.1, design §4.5).
 *
 * Deterministic, explainable, testable without a model. The `missing`
 * array powers three things: the sidebar shows exactly what's unknown,
 * the context builder tells the agent what to learn next, and the
 * report button's disabled state can say why.
 *
 * Requirements are a parameter: lane playbooks (WP2.1) will supply
 * per-lane requirement sets; until then callers use the default below.
 * The ratchet (`readiness_reached_at`, never revoked) is enforced where
 * the gate is read (WP1.7), not here — this function only measures.
 */

import { slotFilled } from "@/lib/profile/normalize";
import type { SessionProfile, SlotName } from "@/lib/profile/registry";

export interface ReadinessRequirements {
  /** Slots that must be filled before a report is offered, in ask order. */
  required: SlotName[];
}

/**
 * Provisional default until lane playbooks land (WP2.1): the report
 * needs to know who the user is (tenure, region) and why they came
 * (motivation, at least one goal).
 */
export const DEFAULT_READINESS_REQUIREMENTS: ReadinessRequirements = {
  required: ["tenure", "region", "motivation_weights", "goals"],
};

export interface ReadinessResult {
  /** 0–100: share of required slots filled. */
  score: number;
  /** Required slots still unfilled, in requirement order. */
  missing: SlotName[];
  ready: boolean;
}

export function readiness(
  profile: SessionProfile,
  requirements: ReadinessRequirements = DEFAULT_READINESS_REQUIREMENTS,
): ReadinessResult {
  const { required } = requirements;
  if (required.length === 0) return { score: 100, missing: [], ready: true };

  const missing = required.filter((name) => !slotFilled(profile[name]));
  const score = Math.round(((required.length - missing.length) / required.length) * 100);
  return { score, missing, ready: missing.length === 0 };
}
