import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { SessionProfile } from "@/lib/profile/registry";

/**
 * Create a session, optionally seeding its `profile` with the upfront
 * slots collected before the conversation (WP1.3, §4.8). The seed is a
 * plain deterministic mapping — the per-turn extractor (WP1.5) updates
 * the same column from here.
 */
export async function createSession(
  userId: string,
  initialProfile?: SessionProfile,
): Promise<string> {
  const { data, error } = await supabase
    .from("sessions")
    // The profile is a JSONB column; its tolerant slot envelopes carry
    // `unknown`-indexed values that don't line up with the generated `Json`
    // type, so cast at this boundary (it is round-tripped by normalizeProfile).
    .insert({
      user_id: userId,
      ...(initialProfile ? { profile: initialProfile as unknown as Json } : {}),
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to create session");
  return data.id;
}
