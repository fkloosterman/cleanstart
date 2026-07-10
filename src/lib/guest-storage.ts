/**
 * Guest localStorage access (§9).
 *
 * Guest state lives in localStorage in exactly the shapes the DB rows would
 * have. These keys and readers are the single definition of that storage, so
 * the chat page and the global signup-migration hook (WP1.9) agree on one
 * contract rather than re-declaring key strings (drift is what §9 warns
 * against). All readers are SSR-safe and never throw.
 */

import type { UIMessage } from "ai";
import { emptyProfile, normalizeProfile } from "@/lib/profile/normalize";
import type { SessionProfile } from "@/lib/profile/registry";

export const GUEST_CHAT_KEY = "cleanstart.chat.v1";
export const GUEST_TENURE_KEY = "cleanstart.tenure.v1";
export const GUEST_LOCATION_KEY = "cleanstart.location.v1";
/** The guest session profile: same shape as sessions.profile (§9). */
export const GUEST_PROFILE_KEY = "cleanstart.profile.v1";
/**
 * The guest readiness ratchet: an ISO timestamp, the localStorage twin of
 * `sessions.readiness_reached_at` (WP1.7, §4.5). Kept as its own key — not
 * folded into the profile — so it mirrors the DB's separate column and
 * migrates as its own field.
 */
export const GUEST_READINESS_KEY = "cleanstart.readiness-reached-at.v1";

/** The guest conversation as stored, or [] if absent/corrupt. */
export function readGuestMessages(): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(GUEST_CHAT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

/** The guest profile, normalized on read (empty if none). */
export function readGuestProfile(): SessionProfile {
  if (typeof window === "undefined") return emptyProfile();
  try {
    const raw = window.localStorage.getItem(GUEST_PROFILE_KEY);
    return raw ? normalizeProfile(JSON.parse(raw)) : emptyProfile();
  } catch {
    return emptyProfile();
  }
}

export function writeGuestProfile(profile: SessionProfile) {
  try {
    window.localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

/** The guest readiness stamp, or null if the gate was never reached. */
export function readGuestReadinessReachedAt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(GUEST_READINESS_KEY);
  } catch {
    return null;
  }
}

export function writeGuestReadinessReachedAt(reachedAt: string) {
  try {
    window.localStorage.setItem(GUEST_READINESS_KEY, reachedAt);
  } catch {
    // ignore
  }
}

/** Drop every guest key — used on start-over and after a successful migration. */
export function clearGuestState() {
  try {
    window.localStorage.removeItem(GUEST_CHAT_KEY);
    window.localStorage.removeItem(GUEST_PROFILE_KEY);
    window.localStorage.removeItem(GUEST_READINESS_KEY);
    window.localStorage.removeItem(GUEST_TENURE_KEY);
    window.localStorage.removeItem(GUEST_LOCATION_KEY);
  } catch {
    // ignore
  }
}
