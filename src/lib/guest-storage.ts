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
/**
 * The guest's generated report (WP3.10, §9): the frozen ReportDocument plus the
 * two fields the `reports` row carries alongside it. Persisted so a browser
 * restart re-renders it without regenerating (no model call, no report-cap
 * hit), and so the signup migration can copy it into a DB `reports` row. The
 * document holds the action-plan items inline (Tier A seam 1), so this one key
 * covers "report document + items".
 */
export const GUEST_REPORT_KEY = "cleanstart.report.v1";
/**
 * The guest session id (WP3.10): a stable per-conversation uuid that keys the
 * per-session turn cap (D7). Minted lazily and re-minted on start-over, so a
 * fresh conversation gets a fresh turn budget.
 */
export const GUEST_SESSION_ID_KEY = "cleanstart.guest-session-id.v1";

/** The stored guest report — the DB `reports` row's shape, minus the ids (§9). */
export interface StoredGuestReport {
  persona: string | null;
  created_at: string;
  /** The frozen ReportDocument JSON; parsed with `parseReportDocument` on read. */
  document: unknown;
}

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

/** The guest's stored report, or null if none was generated / it's corrupt. */
export function readGuestReport(): StoredGuestReport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(GUEST_REPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGuestReport;
    // A report without a document is unusable; treat it as absent.
    return parsed && parsed.document ? parsed : null;
  } catch {
    return null;
  }
}

export function writeGuestReport(report: StoredGuestReport) {
  try {
    window.localStorage.setItem(GUEST_REPORT_KEY, JSON.stringify(report));
  } catch {
    // ignore
  }
}

/**
 * The guest session id, minted and persisted on first read (§9, WP3.10). SSR-
 * safe: returns a throwaway id off the client (no window/localStorage), which
 * is never persisted — the per-session cap only matters for real client turns.
 */
export function getGuestSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.localStorage.getItem(GUEST_SESSION_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(GUEST_SESSION_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
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
    window.localStorage.removeItem(GUEST_REPORT_KEY);
    window.localStorage.removeItem(GUEST_SESSION_ID_KEY);
  } catch {
    // ignore
  }
}
