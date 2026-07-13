/**
 * Report-gate read site with the ratchet (WP1.7, design §4.5).
 *
 * Wraps the pure `reportGate` and adds the one stateful concern it can't
 * carry: **stamping the moment readiness is first reached**. The caller
 * owns the stamp (`reachedAt`) so it can seed it from storage — the
 * `sessions.readiness_reached_at` column for signed-in users, its
 * localStorage twin for guests — and clear it on "start over". When the
 * profile first becomes ready, this fires `onReach(now)` exactly once so
 * the caller can persist the stamp; thereafter the gate stays open even
 * if a later edit drops a required slot.
 */

import { useEffect, useRef } from "react";
import { reportGate, type ReportGateState } from "@/lib/profile/readiness-gate";
import type { SessionProfile } from "@/lib/profile/registry";

export function useReadinessGate(
  profile: SessionProfile,
  reachedAt: string | null,
  onReach: (at: string) => void,
): ReportGateState {
  const gate = reportGate(profile, reachedAt);

  const onReachRef = useRef(onReach);
  onReachRef.current = onReach;

  useEffect(() => {
    // Ratchet: stamp the first time the gate opens without a stored stamp.
    if (gate.open && !reachedAt) {
      onReachRef.current(new Date().toISOString());
    }
  }, [gate.open, reachedAt]);

  return gate;
}
