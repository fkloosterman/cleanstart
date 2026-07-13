import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { createSession } from "@/lib/sessions";
import { deleteAllConversations } from "@/lib/account.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ArrowRight, FileText, Loader2, MessageCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Your Sessions — Clean Start" },
      { name: "description", content: "Review your past clean energy research sessions." },
    ],
  }),
  component: HistoryPage,
});

type SessionRow = {
  id: string;
  title: string;
  is_complete: boolean;
  created_at: string;
  updated_at: string;
  messages: { count: number }[];
  // `reports` embeds as a to-one relationship (reports.session_id is UNIQUE),
  // so PostgREST returns a single object or null here — not an array.
  reports: { id: string } | { id: string }[] | null;
};

function HistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const removeAllConversations = useServerFn(deleteAllConversations);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("sessions")
      .select("id, title, is_complete, created_at, updated_at, messages(count), reports(id)")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) toast.error("Couldn't load sessions");
    setSessions((data as unknown as SessionRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  const handleNewSession = async () => {
    if (!user || creating) return;
    setCreating(true);
    try {
      const sessionId = await createSession(user.id);
      navigate({ to: "/chat/$sessionId", params: { sessionId } });
    } catch {
      toast.error("Couldn't start a new conversation");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this conversation and its report?")) return;
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) return toast.error("Couldn't delete");
    setSessions((s) => s?.filter((x) => x.id !== id) ?? null);
    toast.success("Deleted");
  };

  const handleDeleteAll = async () => {
    setDeletingAll(true);
    try {
      await removeAllConversations({});
      setSessions([]);
      toast.success("All conversations deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete your conversations");
    } finally {
      setDeletingAll(false);
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
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to view your sessions</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your conversations and reports are saved to your account.
        </p>
        <Button className="mt-6" asChild>
          <Link to="/chat">Go to chat</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick up a past conversation or open its summary.
          </p>
        </div>
        <Button onClick={handleNewSession} disabled={creating}>
          {creating ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-1 h-4 w-4" />
          )}
          New conversation
        </Button>
      </div>

      {loading && !sessions && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {sessions && sessions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <MessageCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="font-medium">No sessions yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Start a conversation to get personalized clean energy guidance.
          </p>
          <Button className="mt-5" onClick={handleNewSession} disabled={creating}>
            {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Start chatting
          </Button>
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <ul className="space-y-3">
          {sessions.map((s, i) => {
            const msgCount = s.messages?.[0]?.count ?? 0;
            const hasReport = Array.isArray(s.reports) ? s.reports.length > 0 : !!s.reports;
            const isCurrent = i === 0;
            return (
              <li
                key={s.id}
                className={`group rounded-xl border p-4 transition hover:border-primary/40 ${
                  isCurrent ? "border-primary/50 bg-primary-light/20" : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-medium">{s.title}</h3>
                      {isCurrent && (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-primary text-primary-dark"
                        >
                          Current
                        </Badge>
                      )}
                      {s.is_complete && (
                        <Badge variant="secondary" className="shrink-0">
                          Complete
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(s.updated_at).toLocaleString()} · {msgCount} message
                      {msgCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {hasReport && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link to="/report" search={{ sessionId: s.id }}>
                          <FileText className="mr-1 h-4 w-4" /> Report
                        </Link>
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/chat/$sessionId" params={{ sessionId: s.id }}>
                        Open <ArrowRight className="ml-1 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(s.id)}
                      aria-label="Delete session"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {sessions && sessions.length > 0 && (
        <div className="mt-8 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Delete every conversation, message, and report. Your account stays — manage it on your{" "}
            <Link to="/account" className="underline underline-offset-4">
              account
            </Link>{" "}
            page.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0" disabled={deletingAll}>
                {deletingAll ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-4 w-4" />
                )}
                Delete all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all conversations?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes all your conversations and their reports. Your account
                  itself stays. This can't be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deletingAll}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    if (!deletingAll) handleDeleteAll();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deletingAll ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  Yes, delete all
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
