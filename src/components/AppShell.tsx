import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/AuthModal";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/chat", label: "Chat" },
  { to: "/history", label: "History" },
  { to: "/resources", label: "Resources" },
  { to: "/about", label: "About" },
] as const;


export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut, loading } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
              <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
            ) : (
              <Button size="sm" onClick={() => setAuthOpen(true)}>Sign in</Button>
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
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setMenuOpen(false); signOut(); }}>
                    Sign out
                  </Button>
                ) : (
                  <Button size="sm" className="w-full" onClick={() => { setMenuOpen(false); setAuthOpen(true); }}>
                    Sign in
                  </Button>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-background py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 text-xs text-muted-foreground sm:flex-row">
          <p>Privacy-first · Vendor-neutral · © 2026 Clean Start</p>
          <Link to="/privacy" className="hover:text-foreground">Privacy &amp; Terms of Service</Link>
        </div>
      </footer>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  );
}
