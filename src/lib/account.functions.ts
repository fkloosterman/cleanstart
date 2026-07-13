import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Account & data deletion — server half.
 *
 * Both functions require auth (requireSupabaseAuth injects the RLS-scoped client
 * and the caller's userId). The schema cascades on delete (see
 * 20260630000000_initial_schema.sql), so removing a row at the right level takes
 * everything beneath it — no per-table manual deletes.
 */

/**
 * Delete the caller's entire account: identity + all app data.
 *
 * Deleting the auth.users row cascades profiles → sessions/reports →
 * messages/feedback. Only the service-role admin client can touch auth.users,
 * so we load it lazily (a top-level import would ship it to the client bundle).
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) {
      console.error("[account] deleteUser failed:", error);
      throw new Error("Couldn't delete your account. Please try again.");
    }
    return { ok: true as const };
  });

/**
 * Delete all of the caller's conversations (sessions), keeping the account.
 *
 * Uses the RLS-scoped client, so the "Users manage own sessions" policy already
 * confines the delete to this user's rows; the userId filter is belt-and-braces.
 * Deleting sessions cascades to their messages, reports, and feedback. The
 * account, profile, and login are untouched.
 */
export const deleteAllConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("sessions").delete().eq("user_id", userId);
    if (error) {
      console.error("[account] deleteAllConversations failed:", error);
      throw new Error("Couldn't delete your conversations. Please try again.");
    }
    return { ok: true as const };
  });
