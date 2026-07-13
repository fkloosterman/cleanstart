/**
 * Reactive session-profile state (WP1.6).
 *
 * The sidebar needs the profile in React state so it re-renders when a
 * sidebar edit lands *and* when per-turn extraction streams a
 * `data-profile-patch` (WP1.5). This hook owns that state and funnels
 * every mutation through `applyPatches` — the single write path, which
 * enforces edited-wins and schema validation — then persists via the
 * adapter the caller supplies (localStorage for guests, the `sessions`
 * row for signed-in users). Guest and signed-in share this hook; only
 * the persistence adapter differs.
 */

import { useCallback, useRef, useState } from "react";
import { applyPatches } from "@/lib/profile/patches";
import type { SessionProfile } from "@/lib/profile/registry";

export interface SessionProfileStore {
  profile: SessionProfile;
  /** Apply patches (a sidebar edit or streamed extraction) and persist. */
  applyProfilePatches: (patches: unknown[]) => void;
  /** Replace the profile wholesale (e.g. upfront-slot sync); also persists. */
  setProfile: (next: SessionProfile | ((prev: SessionProfile) => SessionProfile)) => void;
}

export function useSessionProfile(
  initial: SessionProfile,
  persist: (profile: SessionProfile) => void,
): SessionProfileStore {
  const [profile, setProfileState] = useState<SessionProfile>(() => initial);

  // Keep the latest persist without making the mutators change identity —
  // adapters are typically recreated each render (they close over sessionId
  // etc.), but the callbacks handed to the sidebar should stay stable.
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const setProfile = useCallback(
    (next: SessionProfile | ((prev: SessionProfile) => SessionProfile)) => {
      setProfileState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        persistRef.current(value);
        return value;
      });
    },
    [],
  );

  const applyProfilePatches = useCallback(
    (patches: unknown[]) => {
      if (patches.length === 0) return;
      setProfile((prev) => applyPatches(prev, patches).profile);
    },
    [setProfile],
  );

  return { profile, applyProfilePatches, setProfile };
}
