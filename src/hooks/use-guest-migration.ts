/**
 * Global guest→signup migration (WP1.9, design §9).
 *
 * Mounted once (in AppShell) so it fires on whatever route the user lands on
 * after authenticating — the OAuth redirect (home) and the email-confirmation
 * redirect included, not only the chat page. When a guest conversation exists
 * in localStorage, copy it + the profile into a persisted DB session, clear
 * the local guest state (we read from the DB now), and hand the user off to
 * the session — which renders its own DB-backed sidebar. No-op when there is
 * nothing to migrate.
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { clearGuestState, readGuestMessages, readGuestProfile } from "@/lib/guest-storage";
import { guestMessagesFromUI, migrateGuestSession } from "@/lib/guest-migration";

export function useGuestMigration() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  // One attempt per app load; stays true after a run so a token refresh (which
  // changes the user object identity) can't re-migrate, and a cleared
  // localStorage after success can't either.
  const ranRef = useRef(false);

  useEffect(() => {
    if (loading || !user || ranRef.current) return;
    const messages = guestMessagesFromUI(readGuestMessages());
    if (messages.length === 0) return; // nothing to migrate
    ranRef.current = true;
    const profile = readGuestProfile();
    void (async () => {
      try {
        const result = await migrateGuestSession(user.id, messages, profile);
        // Stop using local state; clearing also makes a repeat migration a
        // no-op even if this hook runs again.
        clearGuestState();
        if (result) {
          navigate({ to: "/chat/$sessionId", params: { sessionId: result.sessionId } });
        }
      } catch {
        // Keep the guest data and let the user retry with a reload rather than
        // looping into orphan sessions (ranRef stays true this load).
        toast.error("Couldn't move your conversation to your account. Try reloading.");
      }
    })();
  }, [user, loading, navigate]);
}
