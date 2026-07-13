/**
 * Tolerant profile read — normalize-on-read (WP1.1, design §11).
 *
 * Profiles live in `sessions.profile` and in guest localStorage; you
 * can't run a SQL migration over browsers, so old or junk data is never
 * rejected — it is normalized: missing slots filled with empty
 * envelopes, unknown keys passed through untouched (an old bundle
 * saving a profile must not strip slots a newer bundle wrote), and
 * per-slot parse failures coerced to an empty slot instead of failing
 * the whole object.
 */

import {
  CONFIDENCE_VALUES,
  PROVENANCE_VALUES,
  SLOT_NAMES,
  SLOT_REGISTRY,
  slotValueSchema,
  type Confidence,
  type Provenance,
  type SessionProfile,
  type Slot,
  type SlotName,
  type SlotValue,
} from "@/lib/profile/registry";

/** A slot that has never been written. */
export function emptySlot<T>(): Slot<T> {
  return { value: null, provenance: null, confidence: "low" };
}

/** A profile with every registry slot empty. */
export function emptyProfile(): SessionProfile {
  const profile = {} as Record<SlotName, Slot<unknown>>;
  for (const name of SLOT_NAMES) profile[name] = emptySlot();
  return profile as SessionProfile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEnvelopeField<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : null;
}

function normalizeSlot(name: SlotName, raw: unknown): Slot<unknown> {
  if (!isRecord(raw)) return emptySlot();

  const slot = emptySlot<unknown>();

  slot.provenance = normalizeEnvelopeField<Provenance>(raw.provenance, PROVENANCE_VALUES);
  slot.confidence = normalizeEnvelopeField<Confidence>(raw.confidence, CONFIDENCE_VALUES) ?? "low";
  if (typeof raw.asked_at === "string") slot.asked_at = raw.asked_at;
  if (typeof raw.updated_at === "string") slot.updated_at = raw.updated_at;

  if (raw.value !== null && raw.value !== undefined) {
    if (SLOT_REGISTRY[name].kind === "list") {
      // Lists heal per entry: junk entries drop, valid ones survive.
      const entries = Array.isArray(raw.value) ? raw.value : [];
      const entrySchema = SLOT_REGISTRY[name].schema;
      const valid = entries.filter((entry) => entrySchema.safeParse(entry).success);
      slot.value = valid.length > 0 ? valid : null;
    } else {
      const parsed = slotValueSchema(name).safeParse(raw.value);
      slot.value = parsed.success ? parsed.data : null;
    }
  }

  // A value without a readable provenance is still a value; a provenance
  // without a value is metadata worth keeping (e.g. asked-but-unknown).
  return slot;
}

/**
 * Normalize anything into a well-formed `SessionProfile`. Never throws.
 * Unknown top-level keys are copied through untouched (§11 passthrough
 * — they are carried at runtime but deliberately absent from the type).
 */
export function normalizeProfile(raw: unknown): SessionProfile {
  const profile = emptyProfile();
  if (!isRecord(raw)) return profile;

  const slots = profile as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    if ((SLOT_NAMES as string[]).includes(key)) {
      slots[key] = normalizeSlot(key as SlotName, value);
    } else {
      slots[key] = value; // passthrough, untouched
    }
  }
  return profile;
}

/** True when a slot holds usable information (non-null; non-empty for lists). */
export function slotFilled(slot: Slot<unknown>): boolean {
  if (slot.value === null || slot.value === undefined) return false;
  return Array.isArray(slot.value) ? slot.value.length > 0 : true;
}

/** Convenience: the normalized value of a named slot. */
export function slotValue<K extends SlotName>(
  profile: SessionProfile,
  name: K,
): SlotValue<K> | null {
  return profile[name].value;
}
