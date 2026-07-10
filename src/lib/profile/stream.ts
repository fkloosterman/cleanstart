/**
 * The wire format for extraction patches streamed after a chat reply
 * (WP1.5, plan §1.5, design §4.4, §9).
 *
 * The decide-in-code: extraction runs *after* the assistant reply has
 * streamed (never before — it must add zero time-to-first-token), and
 * its result rides the *same* response stream as a data part. Both chat
 * endpoints emit `data-profile-patch`; the guest client reads it back
 * off the stream and applies it to its localStorage profile, and the
 * authenticated path additionally persists server-side.
 *
 * This module owns just the shape and a tolerant reader, so the write
 * side (server) and read side (client) agree on one contract and it can
 * be unit-tested without a stream. The patches themselves are still
 * untrusted: every one flows through `applyPatches` at the sink, which
 * validates shape and enforces edited-wins.
 */

import type { ProfilePatch } from "@/lib/profile/patches";

/** The data-part name; the emitted/received part `type` is `data-${NAME}`. */
export const PROFILE_PATCH_DATA_NAME = "profile-patch" as const;

/** The part/chunk `type` string the server writes and the client matches. */
export const PROFILE_PATCH_PART_TYPE = `data-${PROFILE_PATCH_DATA_NAME}` as const;

/** Payload carried by a `data-profile-patch` part. */
export interface ProfilePatchData {
  patches: ProfilePatch[];
}

/**
 * Read patch operations out of an untyped data-part payload. Tolerant by
 * design — a malformed or foreign payload yields `[]` rather than
 * throwing into the client's stream handler. The returned entries are
 * still raw: `applyPatches` validates each one before it touches a
 * profile.
 */
export function readProfilePatchData(data: unknown): unknown[] {
  if (typeof data !== "object" || data === null) return [];
  const patches = (data as { patches?: unknown }).patches;
  return Array.isArray(patches) ? patches : [];
}
