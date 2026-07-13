import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { deleteAccount } from "@/lib/account.functions";
import { clearGuestState } from "@/lib/guest-storage";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, ShieldAlert, Trash2, User } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Account — Clean Start" },
      { name: "description", content: "Manage your Clean Start account and data." },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const removeAccount = useServerFn(deleteAccount);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await removeAccount({});
      // Order matters: sign out clears the session, then wipe any guest-mode
      // leftovers in this browser, then leave the (now-gone) account area.
      await signOut();
      clearGuestState();
      toast.success("Your account and data have been deleted");
      navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete your account.");
      setDeleting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to manage your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account settings and data controls live here once you're signed in.
        </p>
        <Button className="mt-6" asChild>
          <Link to="/chat">Go to chat</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Manage your account and your data.</p>

      {/* Account info */}
      <section className="mt-8 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Signed in as</div>
            <div className="truncate text-sm text-muted-foreground">{user.email}</div>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          You can delete individual conversations, or all of them at once, from your{" "}
          <Link to="/history" className="underline underline-offset-4">
            sessions
          </Link>{" "}
          page. That keeps your account — use the option below to remove everything.
        </p>
      </section>

      {/* Danger zone */}
      <section className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/5 p-6">
        <div className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-4 w-4" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">Danger zone</h2>
        </div>
        <h3 className="mt-3 font-medium text-foreground">Delete my account</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanently deletes your account and all associated data — your profile, sessions,
          messages, and reports. This can't be undone.
        </p>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="mt-4" disabled={deleting}>
              {deleting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-4 w-4" />
              )}
              Delete my account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes your account and all your data — profile, sessions,
                messages, and reports. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  // Keep the dialog's default close behavior; run the async
                  // deletion after. Guard against a double-submit.
                  e.preventDefault();
                  if (!deleting) handleDeleteAccount();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Yes, delete everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>
  );
}
