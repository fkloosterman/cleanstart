/**
 * Guest → signup migration (WP1.9, design §9).
 *
 * Guest state lives in localStorage in exactly the shapes the database rows
 * would have (§9), so migration on signup is a transform-free copy: the guest
 * conversation becomes `messages` rows and the guest `SessionProfile` becomes
 * `sessions.profile`, all under the new `user_id`. The browser Supabase client
 * writes it directly — RLS ("Users manage own sessions" / "Users manage
 * messages in own sessions") permits it, so no new endpoint is needed.
 *
 * The guest's generated report (WP3.10), when present, migrates too: it becomes
 * the session's `reports` row, `document` and all, so a guest who generated a
 * report before signing up keeps it. Action items live inside that document
 * (Tier A seam 1), so no separate items copy is needed.
 *
 * Idempotent by contract: the caller clears guest localStorage on success, so
 * a second invocation has nothing to migrate. The shared-shape drift guard
 * lives in the colocated test — if the guest and DB profile representations
 * ever diverge, that test fails.
 */

import type { UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { createSession } from "@/lib/sessions";
import type { StoredGuestReport } from "@/lib/guest-storage";
import { slotFilled } from "@/lib/profile/normalize";
import { readiness } from "@/lib/profile/readiness";
import { SLOT_NAMES, type SessionProfile } from "@/lib/profile/registry";

export interface GuestMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GuestMigrationResult {
  sessionId: string;
  messageCount: number;
}

/**
 * Flatten the client's `UIMessage[]` into the `{ role, content }` shape the
 * `messages` table stores: user/assistant turns only (the CHECK constraint),
 * text parts joined, empties dropped. Pure — the drift guard tests it.
 */
export function guestMessagesFromUI(messages: UIMessage[]): GuestMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("")
        .trim(),
    }))
    .filter((m) => m.content.length > 0);
}

/** True when the profile carries any user information worth migrating. */
function profileHasData(profile: SessionProfile): boolean {
  return SLOT_NAMES.some((name) => slotFilled(profile[name]) || Boolean(profile[name].asked_at));
}

/**
 * Copy a guest's conversation + profile into DB rows under `userId`. Returns
 * the new session, or `null` when there is nothing to migrate.
 *
 * Not transactional across the two tables (the browser client has no
 * transaction), but ordered so a partial failure leaves at worst an empty
 * orphan session, never a session whose messages half-wrote: the profile is
 * seeded at insert, then messages, then the title.
 */
export async function migrateGuestSession(
  userId: string,
  messages: GuestMessage[],
  profile: SessionProfile,
  /** The guest's readiness stamp, if the gate was reached (§4.5, WP1.7). */
  readinessReachedAt: string | null,
  /** The guest's generated report, if any (WP3.10) — copied to a `reports` row. */
  report: StoredGuestReport | null = null,
): Promise<GuestMigrationResult | null> {
  const hasMessages = messages.length > 0;
  if (!hasMessages && !profileHasData(profile) && !report) return null;

  // Carry the ratchet: an explicit guest stamp wins, but if the migrated
  // profile is already ready without one (older guest data), stamp it now so
  // the report doesn't silently re-lock after signup.
  const reachedAt =
    readinessReachedAt ?? (readiness(profile).ready ? new Date().toISOString() : null);

  // Seed the session with the migrated profile (same JSONB cast as the
  // per-turn extractor path; round-tripped by normalizeProfile on read).
  const sessionId = await createSession(userId, profile, reachedAt);

  if (hasMessages) {
    const base = Date.now();
    const rows = messages.map((m, i) => ({
      session_id: sessionId,
      role: m.role,
      content: m.content,
      // Space the timestamps so read order (created_at ASC) matches the guest
      // transcript order even when inserted in one batch.
      created_at: new Date(base + i).toISOString(),
    }));
    const { error } = await supabase.from("messages").insert(rows);
    if (error) throw error;

    // Match the chat API's titling: first user message, capped at 80 chars.
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser) {
      await supabase
        .from("sessions")
        .update({ title: firstUser.content.slice(0, 80), updated_at: new Date().toISOString() })
        .eq("id", sessionId);
    }
  }

  // Carry the guest's report, if they generated one (WP3.10). Attach it to the
  // new session as its `reports` row — the same shape the authenticated path
  // writes (document + persona; legacy columns keep their table defaults). RLS
  // ("Users manage own reports") permits the insert under the new user_id.
  // Ordered last so a report failure can't strand the conversation migration.
  if (report?.document) {
    const { error } = await supabase.from("reports").insert({
      session_id: sessionId,
      user_id: userId,
      persona: report.persona,
      document: report.document as Json,
    });
    if (error) throw error;
    await supabase.from("sessions").update({ is_complete: true }).eq("id", sessionId);
  }

  return { sessionId, messageCount: messages.length };
}
