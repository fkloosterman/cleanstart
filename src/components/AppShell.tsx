import { useState, type ReactNode } from "react";
import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import { Menu, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useGuestMigration } from "@/hooks/use-guest-migration";
import { AuthModal } from "@/components/AuthModal";
import { previewGuardMessage } from "@/lib/preview-guard";

// Where sign-out lands, by current route. Pages that look the same for guests
// and signed-in users (home, resources, about, the guest chat start, the
// example/guest/bare report views) stay put; pages that gate or differ for a
// signed-out user funnel to the guest chat — the natural "keep using the app"
// destination.
function signOutRedirect(pathname: string, search: Record<string, unknown>): "/chat" | null {
  if (pathname.startsWith("/chat/")) return "/chat"; // a specific session
  if (pathname === "/history" || pathname.startsWith("/history/")) return "/chat";
  // Only the authenticated report view (a sessionId, without example/guest)
  // walls a signed-out user; the example, guest, and bare /report pages render
  // fine without auth.
  if (pathname === "/report" && search.sessionId && !search.example && !search.guest) {
    return "/chat";
  }
  return null; // stay put
}

// Vercel inlines VITE_-prefixed system env vars into the client bundle (when
// "Automatically expose System Environment Variables" is enabled); locally
// VITE_VERCEL_ENV is undefined and the guard stays silent.
const PREVIEW_WARNING = previewGuardMessage({
  VERCEL_ENV: import.meta.env.VITE_VERCEL_ENV as string | undefined,
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string | undefined,
});

const NAV = [
  { to: "/", label: "Home" },
  { to: "/chat", label: "Chat" },
  { to: "/history", label: "History" },
  { to: "/resources", label: "Resources" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Give Feedback" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [authOpen, setAuthOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Migrate a guest's conversation + profile into their account on sign-in,
  // from whatever route auth lands on (WP1.9, incl. the OAuth/email-confirm
  // redirects). Mounted here because AppShell wraps every route.
  useGuestMigration();

  // Sign out, confirm it, and redirect away from any page that would now wall
  // the user (session/history) — otherwise leave them where they are.
  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    const dest = signOutRedirect(location.pathname, location.search as Record<string, unknown>);
    if (dest) navigate({ to: dest });
  };
  const nav = NAV.filter((n) => n.to !== "/history" || user);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/Clean-Start-Logo-No-Text.png" alt="" className="h-8 w-auto" />
            <span className="text-base">Clean Start</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: n.to === "/" }}
                activeProps={{ className: "text-foreground bg-accent" }}
                inactiveProps={{ className: "text-muted-foreground" }}
                className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:text-foreground hover:bg-accent"
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            {loading ? null : user ? (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/account">Account</Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={handleSignOut}>
                  Sign out
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setAuthOpen(true)}>
                Sign in
              </Button>
            )}
          </div>

          <button
            type="button"
            className="md:hidden rounded-md p-2 text-muted-foreground hover:text-foreground"
            aria-label="Open menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-border bg-background px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1">
              {nav.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
                >
                  {n.label}
                </Link>
              ))}
              <div className="mt-2 border-t border-border pt-3">
                {user ? (
                  <>
                    <Link
                      to="/account"
                      onClick={() => setMenuOpen(false)}
                      className="block rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
                    >
                      Account
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setMenuOpen(false);
                        handleSignOut();
                      }}
                    >
                      Sign out
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setMenuOpen(false);
                      setAuthOpen(true);
                    }}
                  >
                    Sign in
                  </Button>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      {PREVIEW_WARNING && (
        <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
          <TriangleAlert className="mr-1.5 inline h-4 w-4 align-text-bottom" />
          {PREVIEW_WARNING}
        </div>
      )}

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-background py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 text-xs text-muted-foreground sm:flex-row">
          <p>Privacy-first · Vendor-neutral · © 2026 Clean Start</p>
          <div className="flex items-center gap-4">
            <Link to="/contact" className="hover:text-foreground">
              Contact
            </Link>
            <Link to="/privacy" className="hover:text-foreground">
              Privacy &amp; Terms of Service
            </Link>
          </div>
        </div>
      </footer>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  );
}
