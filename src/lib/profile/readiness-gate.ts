/**
 * Report gate with the ratchet applied (WP1.7, design §4.5).
 *
 * `readiness()` only measures the current profile; the gate is what the
 * report button actually reads. It layers the **ratchet** on top: once
 * readiness has been reached (a persisted `readiness_reached_at` — the
 * `sessions` column for signed-in users, its localStorage twin for
 * guests) the report stays unlocked, even if a later profile edit drops
 * a required slot. A gate that moves backwards reads as a bug.
 *
 * Pure and testable without a model or a clock. The read-site hook
 * (`useReadinessGate`) owns the "first reached" stamping; this function
 * only decides open/closed given a stamp.
 */

import { readiness } from "@/lib/profile/readiness";
import { SLOT_REGISTRY, type SessionProfile, type SlotName } from "@/lib/profile/registry";

export interface ReportGateState {
  /** True when the report may be generated (currently ready, or ratcheted). */
  open: boolean;
  /** Required slots still unfilled — always empty once the gate is open. */
  missing: SlotName[];
}

/**
 * The report gate. Open when the profile is ready now, or when a prior
 * readiness stamp exists (`reachedAt` truthy) — the ratchet.
 */
export function reportGate(profile: SessionProfile, reachedAt: string | null): ReportGateState {
  const { ready, missing } = readiness(profile);
  const open = ready || Boolean(reachedAt);
  return { open, missing: open ? [] : missing };
}

/**
 * Friendly labels for the slots a closed gate is still waiting on — the
 * disabled button copy tells the user exactly what's missing (§4.5). Uses
 * the same sidebar labels the profile panel shows, so the two agree.
 */
export function missingSlotLabels(missing: SlotName[]): string[] {
  return missing.map((name) => SLOT_REGISTRY[name].sidebar.label);
}
