/**
 * Profile patch operations — the only write path into a profile
 * (WP1.1, design §4.4).
 *
 * The extractor (WP1.4), quick replies (WP1.8), sidebar edits (WP1.6),
 * and presets all express changes as patches; `applyPatches` is where
 * the invariants live, so a malformed model response can never corrupt
 * a profile:
 *
 * - **Edited wins.** A patch whose provenance is not "edited" can never
 *   modify a slot (or, for preferences, an entry) the user edited.
 * - Values are validated against the registry schema; invalid patches
 *   are rejected, never partially applied.
 * - "propagated" values enter at confidence "low" so the agent
 *   naturally re-confirms them.
 *
 * Rejections are returned, not thrown — callers log and move on
 * (extraction failure must never block the chat reply).
 */

import { emptySlot, normalizeProfile } from "@/lib/profile/normalize";
import {
  SLOT_NAMES,
  SLOT_REGISTRY,
  type Confidence,
  type Preference,
  type Provenance,
  type SessionProfile,
  type Slot,
  type SlotName,
} from "@/lib/profile/registry";

export type ProfilePatch =
  | {
      op: "set";
      slot: SlotName;
      /** For list slots: the full replacement array. `null` records "asked but unknown" (D3). */
      value: unknown;
      provenance: Provenance;
      confidence?: Confidence;
      /** Marks the slot as asked-about, preventing re-asking (§4.1). */
      asked_at?: string;
    }
  | {
      op: "append";
      slot: SlotName; // list slots only
      /** A single list entry. */
      value: unknown;
      provenance: Provenance;
      confidence?: Confidence;
    }
  | {
      op: "clear";
      slot: SlotName;
      provenance: Provenance;
    };

export interface RejectedPatch {
  patch: ProfilePatch;
  reason: string;
}

export interface ApplyPatchesResult {
  profile: SessionProfile;
  rejected: RejectedPatch[];
}

/** Default confidence per provenance: direct signals high, indirect low. */
function defaultConfidence(provenance: Provenance): Confidence {
  return provenance === "stated" || provenance === "edited" ? "high" : "low";
}

function effectiveConfidence(provenance: Provenance, requested?: Confidence): Confidence {
  // §4.4: propagated values always start low, whatever the patch claims.
  if (provenance === "propagated") return "low";
  return requested ?? defaultConfidence(provenance);
}

function isValidPatchShape(patch: unknown): patch is ProfilePatch {
  if (typeof patch !== "object" || patch === null) return false;
  const p = patch as Record<string, unknown>;
  if (p.op !== "set" && p.op !== "append" && p.op !== "clear") return false;
  if (typeof p.slot !== "string" || !(SLOT_NAMES as string[]).includes(p.slot)) return false;
  if (
    typeof p.provenance !== "string" ||
    !["stated", "inferred", "edited", "propagated"].includes(p.provenance)
  ) {
    return false;
  }
  return true;
}

/** Preferences upsert by entity; other lists append with exact-duplicate suppression. */
function appendToList(
  name: SlotName,
  existing: unknown[],
  entry: unknown,
): { next: unknown[] } | { rejected: string } {
  if (name === "preferences") {
    const incoming = entry as Preference;
    const index = existing.findIndex((e) => (e as Preference).entity === incoming.entity);
    if (index === -1) return { next: [...existing, incoming] };
    const current = existing[index] as Preference;
    if (current.provenance === "edited" && incoming.provenance !== "edited") {
      return { rejected: `preference "${incoming.entity}" was edited by the user` };
    }
    const next = [...existing];
    next[index] = incoming;
    return { next };
  }

  const duplicate = existing.some((e) => JSON.stringify(e) === JSON.stringify(entry));
  return { next: duplicate ? existing : [...existing, entry] };
}

function applyOne(
  profile: SessionProfile,
  patch: ProfilePatch,
  now: string,
): { slot: Slot<unknown> } | { rejected: string } {
  const def = SLOT_REGISTRY[patch.slot];
  const current = profile[patch.slot] as Slot<unknown>;

  // Edited wins: only another edit may replace or clear an edited slot.
  // Appends are exempt — adding a new entry to a user-edited list is
  // fine; overwriting an edited entry is prevented per-entry below.
  if (current.provenance === "edited" && patch.provenance !== "edited" && patch.op !== "append") {
    return { rejected: `slot "${patch.slot}" was edited by the user` };
  }

  if (patch.op === "clear") {
    const slot = emptySlot<unknown>();
    slot.provenance = patch.provenance;
    slot.updated_at = now;
    if (current.asked_at) slot.asked_at = current.asked_at;
    return { slot };
  }

  if (patch.op === "append") {
    if (def.kind !== "list") {
      return { rejected: `cannot append to scalar slot "${patch.slot}"` };
    }
    const parsed = def.schema.safeParse(patch.value);
    if (!parsed.success) {
      return { rejected: `invalid entry for "${patch.slot}": ${parsed.error.message}` };
    }
    const existing = Array.isArray(current.value) ? current.value : [];
    const result = appendToList(patch.slot, existing, parsed.data);
    if ("rejected" in result) return result;
    // A non-edited append never downgrades an edited envelope — the
    // edited-wins protection on set/clear must survive later appends.
    const keepEdited = current.provenance === "edited" && patch.provenance !== "edited";
    return {
      slot: {
        ...current,
        value: result.next,
        provenance: keepEdited ? "edited" : patch.provenance,
        confidence: keepEdited
          ? current.confidence
          : effectiveConfidence(patch.provenance, patch.confidence),
        updated_at: now,
      },
    };
  }

  // op === "set"
  let value: unknown = null;
  if (patch.value !== null && patch.value !== undefined) {
    const schema = def.kind === "list" ? def.schema.array() : def.schema;
    const parsed = schema.safeParse(patch.value);
    if (!parsed.success) {
      return { rejected: `invalid value for "${patch.slot}": ${parsed.error.message}` };
    }
    value = parsed.data;
  }

  const slot: Slot<unknown> = {
    ...current,
    value,
    provenance: patch.provenance,
    confidence: effectiveConfidence(patch.provenance, patch.confidence),
    updated_at: now,
  };
  if (patch.asked_at) slot.asked_at = patch.asked_at;
  return { slot };
}

/**
 * Apply patches in order, immutably. Untrusted input is welcome: the
 * profile is normalized first, malformed patches are rejected
 * individually, and the rest still apply.
 */
export function applyPatches(
  profile: unknown,
  patches: unknown[],
  now: string = new Date().toISOString(),
): ApplyPatchesResult {
  const result = { ...normalizeProfile(profile) };
  const rejected: RejectedPatch[] = [];

  for (const raw of patches) {
    if (!isValidPatchShape(raw)) {
      rejected.push({ patch: raw as ProfilePatch, reason: "malformed patch" });
      continue;
    }
    const outcome = applyOne(result, raw, now);
    if ("rejected" in outcome) {
      rejected.push({ patch: raw, reason: outcome.rejected });
    } else {
      (result as Record<SlotName, Slot<unknown>>)[raw.slot] = outcome.slot;
    }
  }

  return { profile: result, rejected };
}
