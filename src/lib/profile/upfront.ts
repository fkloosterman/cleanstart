/**
 * Upfront slots: stepper output → profile (WP1.3, design §4.8, D3).
 *
 * The tenure card picker and the zip step are the two `elicitation:
 * "upfront"` slots — collected before the conversation because the first
 * agent answer would be generic without them. This module is the pure,
 * deterministic mapping from what those UI steps produce into profile
 * patches; no LLM is involved, so upfront answers enter as
 * `provenance: "stated"`, `confidence: "high"` — the strongest signal we
 * get, for free.
 *
 * D3 (fate of `curious`): the "Not sure yet" card leaves `tenure`
 * unset but marks it asked (so the agent won't nag) and nudges the
 * motivation vector toward the learning lane.
 */

import { emptyProfile } from "@/lib/profile/normalize";
import { applyPatches, type ProfilePatch } from "@/lib/profile/patches";
import type { SessionProfile } from "@/lib/profile/registry";

/** The card picker's three options (the existing stepper's `Tenure`). */
export type UpfrontTenure = "homeowner" | "renter" | "curious";

/** What the zip step resolves to (the existing stepper's `Location`). */
export interface UpfrontLocation {
  zip: string;
  city: string;
  state: string;
}

/**
 * Card → tenure slot value. "curious" maps to no value (see D3); the
 * enum's "other" is reachable only conversationally, never from a card.
 */
const TENURE_CARD_TO_SLOT: Record<UpfrontTenure, "owner" | "renter" | null> = {
  homeowner: "owner",
  renter: "renter",
  curious: null,
};

/**
 * The learning-lane nudge applied when the user picks "Not sure yet"
 * (D3). A soft, low-confidence prior — the only nonzero weight, so lane
 * derivation lands on `learning` until the extractor learns real
 * motivation, at which point it is freely overwritten (inferred/low).
 */
const CURIOUS_MOTIVATION_NUDGE = {
  cost: 0,
  carbon: 0,
  comfort: 0,
  resilience: 0,
  learning: 1,
} as const;

export interface UpfrontInput {
  /** Null when the tenure step hasn't been answered at all. */
  tenure: UpfrontTenure | null;
  /** The resolved location, or null when the zip step was skipped/unanswered. */
  location: UpfrontLocation | null;
}

/**
 * The patches an upfront step produces. Returned separately so callers
 * can apply them onto an existing profile (e.g. a returning user's
 * propagated durable values, WP1.10) rather than always starting fresh.
 */
export function upfrontPatches(input: UpfrontInput, now: string): ProfilePatch[] {
  const patches: ProfilePatch[] = [];

  if (input.tenure !== null) {
    const value = TENURE_CARD_TO_SLOT[input.tenure];
    if (value !== null) {
      patches.push({ op: "set", slot: "tenure", value, provenance: "stated", asked_at: now });
    } else {
      // D3: "Not sure yet" — record that we asked (don't re-ask) and
      // leave tenure unset, then nudge toward the learning lane.
      patches.push({ op: "set", slot: "tenure", value: null, provenance: "stated", asked_at: now });
      patches.push({
        op: "set",
        slot: "motivation_weights",
        value: { ...CURIOUS_MOTIVATION_NUDGE },
        provenance: "inferred",
      });
    }
  }

  if (input.location !== null) {
    // Only the coarse, content-matching fields — never anything the
    // region schema doesn't name (e.g. the UI's derived utility).
    patches.push({
      op: "set",
      slot: "region",
      value: { state: input.location.state, city: input.location.city, zip: input.location.zip },
      provenance: "stated",
    });
  }
  // A skipped zip deliberately sets nothing: region stays empty and the
  // agent is free to learn it conversationally later (§4.8), so we do
  // NOT mark it asked.

  return patches;
}

/**
 * Build (or update) a profile from the upfront steps. Applies onto
 * `base` when given — otherwise onto an empty profile — reusing
 * `applyPatches`, so the edited-wins rule and schema validation hold
 * here too (a returning user's edited values survive re-running upfront).
 */
export function profileFromUpfront(
  input: UpfrontInput,
  base?: SessionProfile,
  now: string = new Date().toISOString(),
): SessionProfile {
  return applyPatches(base ?? emptyProfile(), upfrontPatches(input, now), now).profile;
}
