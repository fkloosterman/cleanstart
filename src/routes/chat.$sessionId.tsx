import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import type { Session, User } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { createSession } from "@/lib/sessions";
import { emptyProfile, normalizeProfile } from "@/lib/profile/normalize";
import type { SessionProfile } from "@/lib/profile/registry";
import { missingSlotLabels } from "@/lib/profile/readiness-gate";
import { PROFILE_PATCH_PART_TYPE, readProfilePatchData } from "@/lib/profile/stream";
import {
  CONTEXT_DEBUG_PART_TYPE,
  readContextDebugData,
  type ContextDebugData,
} from "@/lib/prompts/inspector";
import { PromptInspector } from "@/components/PromptInspector";
import { useSessionProfile } from "@/hooks/use-session-profile";
import { useReadinessGate } from "@/hooks/use-readiness-gate";
import { ProfilePanel } from "@/components/ProfileSidebar";
import { AuthModal } from "@/components/AuthModal";
import { PrivacyBanner } from "@/components/PrivacyBanner";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Leaf, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({
  persona: z.enum(["renter", "homeowner", "curious"]).optional(),
  // Handed off from /chat when a signed-in user's first message creates this
  // session (see chat.index.tsx) — auto-sent once, then stripped from the URL.
  initialMessage: z.string().optional(),
});

export const Route = createFileRoute("/chat/$sessionId")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Conversation — Clean Start" },
      { name: "description", content: "Your guided clean energy conversation." },
    ],
  }),
  component: ChatSessionPage,
});

type MessageRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

function rowToUIMessage(row: MessageRow): UIMessage {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : row.role === "system" ? "system" : "user",
    parts: [{ type: "text", text: row.content }],
  };
}

// Outer component: handles auth gating and loading this session's data.
// The actual useChat-driven conversation view is a separate component keyed
// on sessionId, so switching sessions fully remounts it — useChat only seeds
// its message list from props once per mount, so without a remount, a stale
// previous session's messages (or an empty list captured mid-load) would
// leak into the next session's view.
function ChatSessionPage() {
  const { sessionId } = Route.useParams();
  const { persona: searchPersona, initialMessage } = Route.useSearch();
  const { user, session: authSession, loading: authLoading } = useAuth();

  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [persona, setPersona] = useState<string | null>(searchPersona ?? null);
  const [initialProfile, setInitialProfile] = useState<SessionProfile>(emptyProfile);
  const [initialReachedAt, setInitialReachedAt] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setInitialMessages(null);
    setNotFound(false);
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [sessionRes, msgRes, profileRes] = await Promise.all([
        // Load the session profile (WP1.6) + readiness stamp (WP1.7) so the
        // sidebar and the report gate render from them.
        supabase
          .from("sessions")
          .select("id, user_id, profile, readiness_reached_at")
          .eq("id", sessionId)
          .maybeSingle(),
        supabase
          .from("messages")
          .select("id, role, content, created_at")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true }),
        supabase.from("profiles").select("persona").eq("id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      if (sessionRes.error || !sessionRes.data || sessionRes.data.user_id !== user.id) {
        setNotFound(true);
        return;
      }
      // Normalize on read: an old or junk-shaped column heals rather than
      // blocks (§11).
      setInitialProfile(normalizeProfile(sessionRes.data.profile));
      setInitialReachedAt(sessionRes.data.readiness_reached_at);
      setInitialMessages((msgRes.data ?? []).map(rowToUIMessage));
      setPersona((prev) => prev ?? profileRes.data?.persona ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, user]);

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
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your conversation is saved to your account so you can pick it up later.
        </p>
        <AuthOpener />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Conversation not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          It may have been deleted, or it belongs to a different account.
        </p>
        <Button asChild className="mt-6">
          <Link to="/history">Back to your sessions</Link>
        </Button>
      </div>
    );
  }

  if (initialMessages === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ChatConversation
      key={sessionId}
      sessionId={sessionId}
      initialMessages={initialMessages}
      initialProfile={initialProfile}
      initialReachedAt={initialReachedAt}
      persona={persona}
      initialMessage={initialMessage}
      user={user}
      authSession={authSession}
    />
  );
}

function ChatConversation({
  sessionId,
  initialMessages,
  initialProfile,
  initialReachedAt,
  persona,
  initialMessage,
  user,
  authSession,
}: {
  sessionId: string;
  initialMessages: UIMessage[];
  initialProfile: SessionProfile;
  initialReachedAt: string | null;
  persona: string | null;
  initialMessage: string | undefined;
  user: User;
  authSession: Session | null;
}) {
  const navigate = useNavigate();
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [creatingNext, setCreatingNext] = useState(false);
  // The readiness ratchet stamp (§4.5). Seeded from the loaded session and
  // remembered locally the moment the gate first opens, so a within-session
  // edit that drops a required slot can't re-lock the report. The DB stamp is
  // written server-side per turn (api/chat.ts) — this is the read-side memory.
  const [reachedAt, setReachedAt] = useState<string | null>(initialReachedAt);
  // The assembled system prompt for the last turn — populated only when the
  // server streams it (dev prompt inspector, off in prod).
  const [contextDebug, setContextDebug] = useState<ContextDebugData | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sentInitialRef = useRef(false);

  // Reactive session profile (WP1.6): seeded from the loaded column, kept
  // live by per-turn extraction (onData) and sidebar edits, and persisted
  // to sessions.profile with the browser Supabase client — RLS ("Users
  // manage own sessions") permits it, so no new endpoint is needed.
  const profileStore = useSessionProfile(initialProfile, (updated) => {
    void supabase
      .from("sessions")
      .update({ profile: updated as unknown as Json })
      .eq("id", sessionId)
      .then(({ error }) => {
        if (error) console.error("[chat] profile persist failed", error);
      });
  });

  // Report gate (WP1.7): unlocks on information sufficiency, not turn count,
  // and ratchets — once open it stays open. onReach only remembers the stamp
  // locally; the server already persisted it to sessions.readiness_reached_at.
  const gate = useReadinessGate(profileStore.profile, reachedAt, setReachedAt);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: () => ({
          ...(authSession?.access_token
            ? { Authorization: `Bearer ${authSession.access_token}` }
            : {}),
        }),
        body: () => ({ sessionId, persona }),
      }),
    [sessionId, persona, authSession?.access_token],
  );

  const { messages, sendMessage, status, error } = useChat({
    id: sessionId,
    messages: initialMessages,
    transport,
    onError(err) {
      toast.error(err.message || "Something went wrong");
    },
    // The server persists the profile itself each turn and streams a transient
    // `data-profile-patch` (WP1.5); apply it into local state so the sidebar
    // updates live without a reload. This does not re-persist — the server
    // already wrote sessions.profile — but applyPatches is idempotent enough
    // that a redundant write would be harmless.
    onData(part) {
      if (part.type === CONTEXT_DEBUG_PART_TYPE) {
        setContextDebug(readContextDebugData(part.data));
        return;
      }
      if (part.type !== PROFILE_PATCH_PART_TYPE) return;
      const patches = readProfilePatchData(part.data);
      profileStore.applyProfilePatches(patches);
    },
  });

  // Auto-send the first message handed off from /chat (see chat.index.tsx),
  // then strip it from the URL so a refresh doesn't resend it.
  useEffect(() => {
    if (!sentInitialRef.current && initialMessage && initialMessages.length === 0) {
      sentInitialRef.current = true;
      sendMessage({ text: initialMessage });
      navigate({
        to: "/chat/$sessionId",
        params: { sessionId },
        search: (prev) => ({ ...prev, initialMessage: undefined }),
        replace: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refocus the composer
  useEffect(() => {
    if (status === "ready") textareaRef.current?.focus();
  }, [status]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const isBusy = status === "submitted" || status === "streaming";

  const sendFeedback = async (rating: "up" | "down") => {
    if (feedbackSent) return;
    setFeedbackSent(true);
    const { error } = await supabase.from("feedback").insert({
      session_id: sessionId,
      rating,
    });
    if (error) {
      setFeedbackSent(false);
      toast.error("Couldn't record feedback");
      return;
    }
    toast.success("Thanks for the feedback");
  };

  return (
    <>
      <PrivacyBanner />
      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 lg:flex-row lg:gap-4">
        <div className="flex h-[calc(100vh-8rem)] w-full max-w-3xl flex-1 flex-col pb-6 pt-4 lg:order-1">
          {/* Header */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/history">
                <ArrowLeft className="mr-1 h-4 w-4" /> All chats
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              {contextDebug ? <PromptInspector data={contextDebug} /> : null}
              <Button
                variant="outline"
                size="sm"
                disabled={creatingNext}
                onClick={async () => {
                  if (creatingNext) return;
                  setCreatingNext(true);
                  try {
                    const newId = await createSession(user.id);
                    navigate({ to: "/chat/$sessionId", params: { sessionId: newId } });
                  } catch {
                    toast.error("Couldn't start a new conversation");
                  } finally {
                    setCreatingNext(false);
                  }
                }}
              >
                {creatingNext ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                New chat
              </Button>
              {gate.open ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/report" search={{ sessionId } as never}>
                    <FileText className="mr-1 h-4 w-4" /> Generate report
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  title={`Still need: ${missingSlotLabels(gate.missing).join(", ")}`}
                >
                  <FileText className="mr-1 h-4 w-4" /> Generate report
                </Button>
              )}
            </div>
          </div>

          {/* What still gates the report (WP1.7) — visible, not just a tooltip. */}
          {!gate.open && messages.length > 0 && (
            <p className="mb-3 text-center text-xs text-muted-foreground">
              Your report unlocks once we know:{" "}
              <span className="font-medium text-foreground">
                {missingSlotLabels(gate.missing).join(", ")}
              </span>
            </p>
          )}

          {/* Transcript */}
          <Conversation className="flex-1 rounded-2xl border border-border bg-card">
            <ConversationContent>
              {messages.length === 0 ? (
                <ConversationEmptyState
                  icon={<Leaf className="h-6 w-6 text-primary" />}
                  title="Let's get started"
                  description="Tell me a little about your home or what's on your mind — there are no wrong questions."
                />
              ) : (
                messages.map((m) => {
                  const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
                  return (
                    <Message key={m.id} from={m.role === "user" ? "user" : "assistant"}>
                      <MessageContent>
                        {m.role === "assistant" ? (
                          <AssistantMessage text={text} />
                        ) : (
                          <MessageResponse>{text}</MessageResponse>
                        )}
                      </MessageContent>
                    </Message>
                  );
                })
              )}
              {status === "submitted" && (
                <Message from="assistant">
                  <MessageContent>
                    <Shimmer>Thinking…</Shimmer>
                  </MessageContent>
                </Message>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Feedback */}
          {messages.filter((m) => m.role === "assistant").length >= 2 && !feedbackSent && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span>Is this helpful?</span>
              <Button variant="ghost" size="sm" onClick={() => sendFeedback("up")}>
                <ThumbsUp className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => sendFeedback("down")}>
                <ThumbsDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Composer */}
          <div className="mt-3">
            <PromptInput
              onSubmit={(msg) => {
                const text = msg.text?.trim();
                if (!text || isBusy) return;
                sendMessage({ text });
              }}
            >
              <PromptInputTextarea
                ref={textareaRef}
                placeholder="Ask anything — solar, heat pumps, EVs, efficiency…"
              />
              <PromptInputFooter className="justify-end">
                <PromptInputSubmit status={status} disabled={isBusy} />
              </PromptInputFooter>
            </PromptInput>
            {error && <p className="mt-2 text-xs text-destructive">{error.message}</p>}
          </div>
        </div>
        <ProfilePanel
          profile={profileStore.profile}
          onEdit={profileStore.applyProfilePatches}
          className="mt-4 max-h-[calc(100vh-8rem)] lg:order-2"
        />
      </div>
    </>
  );
}

function AuthOpener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="mt-6" onClick={() => setOpen(true)}>
        Sign in
      </Button>
      <AuthModal open={open} onOpenChange={setOpen} defaultTab="login" />
    </>
  );
}
