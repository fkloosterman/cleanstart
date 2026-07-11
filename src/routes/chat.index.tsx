import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { createSession } from "@/lib/sessions";
import { profileFromUpfront, type UpfrontInput } from "@/lib/profile/upfront";
import { applyPatches } from "@/lib/profile/patches";
import { getPresets, type StarterPreset } from "@/lib/content/presets.functions";
import { emptyProfile } from "@/lib/profile/normalize";
import { PROFILE_PATCH_PART_TYPE, readProfilePatchData } from "@/lib/profile/stream";
import {
  CONTEXT_DEBUG_PART_TYPE,
  readContextDebugData,
  type ContextDebugData,
} from "@/lib/prompts/inspector";
import { PromptInspector } from "@/components/PromptInspector";
import {
  GUEST_CHAT_KEY,
  GUEST_TENURE_KEY,
  GUEST_LOCATION_KEY,
  GUEST_PROFILE_KEY,
  GUEST_READINESS_KEY,
  readGuestProfile,
  writeGuestProfile,
  readGuestReadinessReachedAt,
  writeGuestReadinessReachedAt,
  clearGuestState,
} from "@/lib/guest-storage";
import { missingSlotLabels } from "@/lib/profile/readiness-gate";
import { useSessionProfile } from "@/hooks/use-session-profile";
import { useReadinessGate } from "@/hooks/use-readiness-gate";
import { ProfilePanel } from "@/components/ProfileSidebar";
import { PrivacyBanner } from "@/components/PrivacyBanner";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import {
  Home,
  Building2,
  HelpCircle,
  ArrowUp,
  FileText,
  MapPin,
  MapPinCheck,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/chat/")({
  head: () => ({
    meta: [
      { title: "Chat — Clean Start" },
      {
        name: "description",
        content:
          "Ask anything about solar, heat pumps, EVs, or home efficiency. Plain-language answers, no pressure.",
      },
    ],
  }),
  component: ChatPage,
});

/** The upfront steps as the profile mapper consumes them (§4.8). */
function toUpfrontInput(tenure: Tenure | null, location: Location | null): UpfrontInput {
  return {
    tenure,
    location: location ? { zip: location.zip, city: location.city, state: location.state } : null,
  };
}

type Tenure = "homeowner" | "renter" | "curious";
type Location = {
  zip: string;
  city: string;
  state: string;
  utility: string;
};

const TENURE_META: Record<Tenure, { label: string; icon: typeof Home }> = {
  homeowner: { label: "Homeowner", icon: Home },
  renter: { label: "Renter", icon: Building2 },
  curious: { label: "Exploring", icon: HelpCircle },
};

const STATE_UTILITY: Record<string, string> = {
  CA: "PG&E",
  NY: "Con Edison",
  MA: "Eversource",
  IL: "ComEd",
  GA: "Georgia Power",
  VA: "Dominion Energy",
  TX: "Oncor",
  AZ: "APS",
  WA: "Puget Sound Energy",
  FL: "FPL",
  CT: "Eversource",
  NH: "Eversource",
  NJ: "PSE&G",
  PA: "PECO",
  OH: "AEP Ohio",
  MI: "DTE Energy",
  MN: "Xcel Energy",
  CO: "Xcel Energy",
  NC: "Duke Energy",
  SC: "Duke Energy",
  TN: "TVA",
  OR: "Portland General Electric",
  NV: "NV Energy",
  MD: "BGE",
  IN: "Duke Energy Indiana",
  WI: "We Energies",
  MO: "Ameren Missouri",
  AL: "Alabama Power",
  LA: "Entergy",
  KY: "LG&E",
};

/** The stepper's tenure maps to the content preset targeting (owner/renter). */
function presetTenure(tenure: Tenure): "owner" | "renter" | null {
  if (tenure === "homeowner") return "owner";
  if (tenure === "renter") return "renter";
  return null; // "curious" — show only general (untargeted) presets
}

function ChatPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  // Signed-in users see the same starting points as guests, plus (if they
  // have one) the option to continue their most recently active session or
  // explicitly start a blank new one.
  const [recentSessionChecked, setRecentSessionChecked] = useState(false);
  const [recentSession, setRecentSession] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRecentSessionChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, title")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setRecentSession(data ?? null);
      setRecentSessionChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  const goToRecentSession = () => {
    if (recentSession) {
      navigate({ to: "/chat/$sessionId", params: { sessionId: recentSession.id } });
    }
  };

  const startBlankSession = async () => {
    if (!user || creatingSession) return;
    setCreatingSession(true);
    try {
      const sessionId = await createSession(user.id);
      navigate({ to: "/chat/$sessionId", params: { sessionId } });
    } catch {
      toast.error("Couldn't start a new conversation");
      setCreatingSession(false);
    }
  };

  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [tenure, setTenure] = useState<Tenure | null>(null);
  const [location, setLocation] = useState<Location | null>(null);
  const [zipStepDone, setZipStepDone] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);

  // Starter presets (WP3.2, §3.6) from the content library, filtered to the
  // chosen tenure. Replaces the hardcoded CHIPS. Empty until a tenure is
  // picked, or if the fetch fails — the opening screen keeps its text input.
  const [presets, setPresets] = useState<StarterPreset[]>([]);
  const fetchPresets = useServerFn(getPresets);
  useEffect(() => {
    if (tenure === null) {
      setPresets([]);
      return;
    }
    let cancelled = false;
    fetchPresets({ data: { tenure: presetTenure(tenure) } })
      .then((p) => !cancelled && setPresets(p))
      .catch(() => !cancelled && setPresets([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenure]);

  // Reactive guest profile (WP1.6): starts empty and is hydrated from
  // localStorage after mount (below), kept in sync by the upfront stepper
  // and per-turn extraction (onData), and edited by the sidebar. The hook
  // persists every change to localStorage via writeGuestProfile.
  const profileStore = useSessionProfile(emptyProfile(), writeGuestProfile);

  // Guest readiness ratchet (WP1.7, §4.5): the localStorage twin of
  // sessions.readiness_reached_at. Hydrated from storage after mount (below),
  // stamped the first time the gate opens, and cleared on start-over.
  const [reachedAt, setReachedAt] = useState<string | null>(null);
  // Assembled system prompt for the last turn — set only when the server
  // streams it (dev prompt inspector, off in prod).
  const [contextDebug, setContextDebug] = useState<ContextDebugData | null>(null);
  const stampReadiness = useCallback((at: string) => {
    setReachedAt(at);
    writeGuestReadinessReachedAt(at);
  }, []);
  const gate = useReadinessGate(profileStore.profile, reachedAt, stampReadiness);

  useEffect(() => {
    if (typeof window === "undefined") {
      setInitialMessages([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(GUEST_CHAT_KEY);
      const parsed = raw ? (JSON.parse(raw) as UIMessage[]) : [];
      setInitialMessages(Array.isArray(parsed) ? parsed : []);
    } catch {
      setInitialMessages([]);
    }
    try {
      const t = window.localStorage.getItem(GUEST_TENURE_KEY) as Tenure | null;
      if (t === "homeowner" || t === "renter" || t === "curious") setTenure(t);
    } catch {
      // ignore
    }
    try {
      const raw = window.localStorage.getItem(GUEST_LOCATION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Location | { skipped: true };
        if ("zip" in parsed) setLocation(parsed);
        setZipStepDone(true);
      }
    } catch {
      // ignore
    }
    // Rehydrate the readiness ratchet so a reload keeps the report unlocked.
    setReachedAt(readGuestReadinessReachedAt());
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/public/chat-guest",
        // Read the profile fresh at send time so it carries any patches
        // applied since mount (WP1.5); the server patches onto it and
        // streams the delta back (see onData below).
        body: () => ({ persona: null, tenure, location, profile: readGuestProfile() }),
      }),
    [tenure, location],
  );

  // useChat only seeds its internal message list from `messages` once, when
  // it (re)creates its Chat instance — which only happens on mount or when
  // `id` changes. localStorage is read asynchronously in the effect above, so
  // on first render `initialMessages` is still null and the Chat instance
  // gets seeded empty. Switching `id` once loading completes forces the SDK
  // to recreate the instance with the now-loaded messages instead of quietly
  // discarding them (and then overwriting localStorage with an empty array
  // via the persistence effect below).
  const chatId = initialMessages === null ? "cleanstart-chat-pending" : "cleanstart-chat";
  const { messages, sendMessage, status, setMessages } = useChat({
    id: chatId,
    messages: initialMessages ?? [],
    transport,
    onError(err) {
      toast.error(err.message || "Something went wrong");
    },
    // The server streams a transient `data-profile-patch` after each reply
    // (WP1.5); apply it onto the stored profile so it accumulates across the
    // conversation. `applyPatches` validates and enforces edited-wins, so a
    // malformed payload can never corrupt the profile.
    onData(part) {
      if (part.type === CONTEXT_DEBUG_PART_TYPE) {
        setContextDebug(readContextDebugData(part.data));
        return;
      }
      if (part.type !== PROFILE_PATCH_PART_TYPE) return;
      const patches = readProfilePatchData(part.data);
      if (patches.length === 0) return;
      // Lift into React state (and persist) so the sidebar re-renders live.
      profileStore.applyProfilePatches(patches);
    },
  });

  // Hydrate the reactive profile from localStorage once on the client. The
  // transport still reads localStorage directly at send time, so this only
  // drives the sidebar UI; state and storage stay in sync via the hook.
  useEffect(() => {
    if (typeof window === "undefined") return;
    profileStore.setProfile(readGuestProfile());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the guest transcript — but only while logged out. Once signed in,
  // the guest→signup migration (useGuestMigration, mounted in AppShell) owns
  // this conversation: it copies it to the DB and clears local state, so this
  // page must not re-write it back to localStorage after that.
  useEffect(() => {
    if (typeof window === "undefined" || initialMessages === null || user) return;
    try {
      window.localStorage.setItem(GUEST_CHAT_KEY, JSON.stringify(messages));
    } catch {
      // ignore
    }
  }, [messages, initialMessages, user]);

  // Guests: keep the localStorage profile's upfront slots in sync with the
  // stepper. Signed-in users' profile lives in sessions.profile (seeded at
  // session creation in handleSend). The upfront patches are applied *onto*
  // the stored profile — not a fresh one — so per-turn extraction patches
  // (WP1.5, applied in onData) accumulate rather than being reset each render.
  useEffect(() => {
    if (typeof window === "undefined" || initialMessages === null || user) return;
    if (tenure === null && location === null) {
      profileStore.setProfile(emptyProfile());
      return;
    }
    // Apply the upfront patches onto the current profile (not a fresh one) so
    // extraction patches accumulated this session survive; the hook persists.
    profileStore.setProfile((prev) => profileFromUpfront(toUpfrontInput(tenure, location), prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenure, location, user, initialMessages]);

  useEffect(() => {
    if (status === "ready") inputRef.current?.focus();
  }, [status]);

  useEffect(() => {
    if (initialMessages !== null) inputRef.current?.focus();
  }, [initialMessages]);

  const isBusy = status === "submitted" || status === "streaming";

  const pickTenure = (t: Tenure) => {
    setTenure(t);
    try {
      window.localStorage.setItem(GUEST_TENURE_KEY, t);
    } catch {
      // ignore
    }
  };

  const resetTenure = () => {
    setTenure(null);
    setZipStepDone(false);
    setLocation(null);
    setReachedAt(null);
    try {
      window.localStorage.removeItem(GUEST_TENURE_KEY);
      window.localStorage.removeItem(GUEST_LOCATION_KEY);
      window.localStorage.removeItem(GUEST_PROFILE_KEY);
      window.localStorage.removeItem(GUEST_READINESS_KEY);
    } catch {
      // ignore
    }
  };

  const resetZip = () => {
    setZipStepDone(false);
    setLocation(null);
    try {
      window.localStorage.removeItem(GUEST_LOCATION_KEY);
    } catch {
      // ignore
    }
  };

  // Once messages exist, `step` is pinned to 4 and TenureStep/ZipStep (with
  // their "change" pills) never render again — this is the only way back to
  // step 1 to pick a different tenure/location or ditch a stuck conversation.
  const handleStartOver = () => {
    if (!confirm("Start a new conversation? This clears your current chat and can't be undone.")) {
      return;
    }
    setMessages([]);
    setTenure(null);
    setLocation(null);
    setZipStepDone(false);
    setReachedAt(null);
    clearGuestState();
  };

  const handleLocationResolved = (loc: Location | null) => {
    if (loc) {
      setLocation(loc);
      try {
        window.localStorage.setItem(GUEST_LOCATION_KEY, JSON.stringify(loc));
      } catch {
        // ignore
      }
    } else {
      try {
        window.localStorage.setItem(GUEST_LOCATION_KEY, JSON.stringify({ skipped: true }));
      } catch {
        // ignore
      }
    }
    setZipStepDone(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSend = async (text: string, presetPatches?: unknown[]) => {
    const trimmed = text.trim();
    if (!trimmed || isBusy || creatingSession) return;
    const effectiveTenure = tenure ?? "curious";
    if (!tenure) pickTenure(effectiveTenure);
    if (!zipStepDone) setZipStepDone(true);

    if (user) {
      // Signed in: create a real session and hand off the first message to
      // the persisted chat page instead of the ephemeral guest flow. Seed
      // the session profile with the upfront slots (§4.8) plus any preset
      // warm-start patches, so both are populated before the first answer.
      setCreatingSession(true);
      try {
        let initialProfile = profileFromUpfront(toUpfrontInput(effectiveTenure, location));
        if (presetPatches?.length) {
          initialProfile = applyPatches(initialProfile, presetPatches).profile;
        }
        const sessionId = await createSession(user.id, initialProfile);
        navigate({
          to: "/chat/$sessionId",
          params: { sessionId },
          search: { persona: effectiveTenure, initialMessage: trimmed },
        });
      } catch {
        toast.error("Couldn't start a new conversation");
        setCreatingSession(false);
      }
      return;
    }

    // Guest: persist the preset warm-start onto the localStorage profile
    // *synchronously* before sending — the transport reads readGuestProfile()
    // at send time, and React state updates are batched, so we can't rely on
    // profileStore alone to have flushed. setProfile also updates the sidebar.
    if (presetPatches?.length) {
      const patched = applyPatches(readGuestProfile(), presetPatches).profile;
      writeGuestProfile(patched);
      profileStore.setProfile(patched);
    }

    sendMessage({ text: trimmed });
    setInput("");
  };

  // A preset click sends its first message AND warm-starts the profile with
  // its patches (§3.6), so the first agent turn already has real context.
  const handlePickPreset = (preset: StarterPreset) => {
    handleSend(preset.first_message, preset.profile_patches);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  const hasMessages = messages.length > 0;
  const step: 1 | 2 | 3 | 4 = hasMessages ? 4 : !tenure ? 1 : !zipStepDone ? 2 : 3;
  // The sidebar shows for guests once the conversation is underway. A guest
  // who signs in mid-conversation is migrated to a persisted session (below),
  // which renders its own DB-backed sidebar — so on this page the panel is
  // guest-only, and there's no doomed local sidebar to keep alive.
  const showProfile = step === 4 && !user;

  if (authLoading || !recentSessionChecked || creatingSession) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <PrivacyBanner />
      <div
        className={cn(
          "mx-auto flex w-full flex-col px-4 lg:flex-row lg:gap-4",
          showProfile ? "max-w-6xl" : "max-w-3xl",
        )}
      >
        <div className="flex h-[calc(100vh-12rem)] min-h-[500px] w-full max-w-3xl flex-1 flex-col pb-4 pt-4 lg:order-1">
          {user && recentSession && step !== 4 && (
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary-light/30 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Welcome back</p>
                <p className="truncate text-xs text-muted-foreground">
                  Continue "{recentSession.title}", or start something new below.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={goToRecentSession}>
                  Continue chat
                </Button>
                <Button size="sm" variant="outline" onClick={startBlankSession}>
                  Start new chat
                </Button>
              </div>
            </div>
          )}
          {step === 4 ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {tenure && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary-light/40 px-3 py-1 text-xs font-medium text-primary-dark">
                      {(() => {
                        const Icon = TENURE_META[tenure].icon;
                        return <Icon className="h-3.5 w-3.5" />;
                      })()}
                      {TENURE_META[tenure].label}
                    </span>
                  )}
                  {location && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary-light/40 px-3 py-1 text-xs font-medium text-primary-dark">
                      <MapPin className="h-3.5 w-3.5" />
                      {location.city}, {location.state}
                    </span>
                  )}
                  <Button variant="ghost" size="sm" onClick={handleStartOver}>
                    <RotateCcw className="mr-1 h-4 w-4" /> Start over
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  {contextDebug ? <PromptInspector data={contextDebug} /> : null}
                  {gate.open ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        try {
                          const transcript = messages
                            .map((m) => ({
                              role: m.role,
                              content: m.parts
                                .map((p) => (p.type === "text" ? p.text : ""))
                                .join(""),
                            }))
                            .filter((m) => m.content.trim().length > 0);
                          window.sessionStorage.setItem(
                            "cleanstart.guest-report.v1",
                            JSON.stringify({ tenure, location, messages: transcript }),
                          );
                        } catch {
                          // ignore
                        }
                        navigate({ to: "/report", search: { guest: true } });
                      }}
                    >
                      <FileText className="mr-1 h-4 w-4" /> Generate report
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
              {!gate.open && (
                <p className="mb-3 text-center text-xs text-muted-foreground">
                  Your report unlocks once we know:{" "}
                  <span className="font-medium text-foreground">
                    {missingSlotLabels(gate.missing).join(", ")}
                  </span>
                </p>
              )}
              <Conversation className="flex-1">
                <ConversationContent className="px-0">
                  <div className="flex flex-col gap-6">
                    {messages.map((m) => {
                      const isUser = m.role === "user";
                      const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
                      return (
                        <div
                          key={m.id}
                          className={cn(
                            "flex flex-col gap-1",
                            isUser ? "items-end" : "items-start",
                          )}
                        >
                          <span className="px-1 text-xs text-muted-foreground">
                            {isUser ? "You" : "Clean Start"}
                          </span>
                          <div
                            className={cn(
                              "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
                              isUser
                                ? "rounded-br-sm bg-primary text-primary-foreground"
                                : "rounded-bl-sm border border-border bg-card text-foreground",
                            )}
                          >
                            {isUser ? (
                              <p className="whitespace-pre-wrap">{text}</p>
                            ) : (
                              <MessageResponse>{text}</MessageResponse>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {status === "submitted" && (
                      <div className="flex flex-col gap-1 items-start">
                        <span className="px-1 text-xs text-muted-foreground">Clean Start</span>
                        <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3">
                          <TypingDots />
                        </div>
                      </div>
                    )}
                  </div>
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {step === 1 && <TenureStep onPick={pickTenure} />}
              {step === 2 && <ZipStep onDone={handleLocationResolved} />}
              {step === 3 && (
                <ChipsStep
                  tenure={tenure!}
                  location={location}
                  presets={presets}
                  onPick={handlePickPreset}
                  onChangeTenure={resetTenure}
                  onChangeZip={resetZip}
                  disabled={isBusy}
                />
              )}
            </div>
          )}

          <div className="mt-3 border-t border-border pt-3">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Ask anything about clean energy…"
                className="w-full resize-none rounded-full border border-border bg-card py-3 pl-5 pr-14 text-sm shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => handleSend(input)}
                disabled={!input.trim() || isBusy}
                aria-label="Send message"
                className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary-dark disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              No account required · your conversations stay private
            </p>
          </div>
        </div>
        {showProfile && (
          <ProfilePanel
            profile={profileStore.profile}
            onEdit={profileStore.applyProfilePatches}
            className="mt-4 max-h-[calc(100vh-12rem)] lg:order-2"
          />
        )}
      </div>
    </>
  );
}

function StepDots({ active }: { active: 1 | 2 | 3 }) {
  const dots: (1 | 2 | 3)[] = [1, 2, 3];
  return (
    <div className="mb-4 flex items-center justify-center gap-2">
      {dots.map((n) => {
        const isActive = n === active;
        const isDone = n < active;
        return (
          <span
            key={n}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              isActive ? "w-5 bg-primary" : isDone ? "w-1.5 bg-primary" : "w-1.5 bg-muted",
            )}
          />
        );
      })}
    </div>
  );
}

function TenureStep({ onPick }: { onPick: (t: Tenure) => void }) {
  const cards: { id: Tenure; title: string; sub: string; Icon: typeof Home }[] = [
    {
      id: "homeowner",
      title: "I own my home",
      sub: "Solar, heat pumps, efficiency upgrades",
      Icon: Home,
    },
    { id: "renter", title: "I rent", sub: "Community solar, renter rebates, EVs", Icon: Building2 },
    {
      id: "curious",
      title: "Not sure yet",
      sub: "Just learning — show me everything",
      Icon: HelpCircle,
    },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center px-2 py-8 text-center">
      <StepDots active={1} />
      <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-primary-light">
        <Home className="h-5 w-5 text-primary-dark" />
      </span>
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Tell us about your home</h2>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Helps us tailor advice, rebates, and programs to your actual situation.
      </p>

      <div className="mt-8 grid w-full max-w-[560px] grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map(({ id, title, sub, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className="group flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-4 text-center transition hover:border-primary hover:bg-primary-light/40"
          >
            <Icon className="h-6 w-6 text-primary-dark" />
            <span className="text-sm font-semibold text-foreground">{title}</span>
            <span className="text-xs text-muted-foreground">{sub}</span>
          </button>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">No account needed · not stored anywhere</p>
    </div>
  );
}

function ZipStep({ onDone }: { onDone: (loc: Location | null) => void }) {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Location | null>(null);

  const lookup = async () => {
    if (zip.length !== 5) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (!res.ok) throw new Error("not found");
      const data = (await res.json()) as {
        places: Array<{ "place name": string; "state abbreviation": string }>;
      };
      const place = data.places?.[0];
      if (!place) throw new Error("not found");
      const state = place["state abbreviation"];
      const loc: Location = {
        zip,
        city: place["place name"],
        state,
        utility: STATE_UTILITY[state] ?? "your local utility",
      };
      setResolved(loc);
      setTimeout(() => onDone(loc), 900);
    } catch {
      setError("We couldn't find that zip code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-2 py-8 text-center">
      <StepDots active={2} />
      <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-primary-light">
        <MapPin className="h-5 w-5 text-primary-dark" />
      </span>
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">What's your zip code?</h2>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Rebates and programs vary by utility and state. Your zip helps us surface what's actually
        available where you live.
      </p>

      <div className="mt-8 flex w-full max-w-[320px] flex-col gap-3">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={5}
          value={zip}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 5);
            setZip(v);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && zip.length === 5) lookup();
          }}
          placeholder="e.g. 94103"
          disabled={loading || !!resolved}
          className="rounded-md border border-border bg-card px-4 py-3 text-center text-lg tracking-[0.3em] shadow-sm placeholder:tracking-normal placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
        />
        <Button onClick={lookup} disabled={zip.length !== 5 || loading || !!resolved}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Look up"}
        </Button>

        {resolved && (
          <div className="mt-1 inline-flex items-center justify-center gap-2 self-center rounded-full border border-primary bg-primary-light px-3 py-1.5 text-sm font-medium text-primary-dark">
            <MapPinCheck className="h-4 w-4" />
            {resolved.city}, {resolved.state} · {resolved.utility}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <p className="mt-1 text-xs text-muted-foreground">Only your zip — never your address</p>
        <button
          type="button"
          onClick={() => onDone(null)}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Skip for now →
        </button>
      </div>
    </div>
  );
}

function ChipsStep({
  tenure,
  location,
  presets,
  onPick,
  onChangeTenure,
  onChangeZip,
  disabled,
}: {
  tenure: Tenure;
  location: Location | null;
  presets: StarterPreset[];
  onPick: (preset: StarterPreset) => void;
  onChangeTenure: () => void;
  onChangeZip: () => void;
  disabled: boolean;
}) {
  const { label, icon: Icon } = TENURE_META[tenure];
  return (
    // min-h-full (not h-full): centers when the content fits, but grows and
    // scrolls from the top when it doesn't — so the pills + heading are never
    // clipped above the scroll viewport (a plain h-full + justify-center does).
    <div className="flex min-h-full flex-col items-center justify-center px-2 py-6 text-center">
      <StepDots active={3} />

      <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onChangeTenure}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary-light px-3 py-1 text-xs font-medium text-primary-dark hover:bg-primary-light/70"
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
          <span className="text-[11px] font-normal text-muted-foreground">· change</span>
        </button>
        <button
          type="button"
          onClick={onChangeZip}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary-light px-3 py-1 text-xs font-medium text-primary-dark hover:bg-primary-light/70"
        >
          <MapPin className="h-3.5 w-3.5" />
          {location ? `${location.city}, ${location.state}` : "No location"}
          <span className="text-[11px] font-normal text-muted-foreground">
            · {location ? "change" : "add"}
          </span>
        </button>
      </div>

      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        What are you curious about?
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {location
          ? `Showing what's available in ${location.city}, ${location.state} — no jargon, no pressure.`
          : "Ask anything — no jargon, no pressure."}
      </p>

      <div className="mt-5 grid w-full max-w-[480px] grid-cols-1 gap-2.5 sm:grid-cols-2">
        {presets.map((p) => (
          <button
            key={p.slug}
            type="button"
            disabled={disabled}
            onClick={() => onPick(p)}
            className="group flex flex-col items-start gap-1 rounded-xl border border-border bg-card p-3.5 text-left transition hover:border-primary hover:shadow-sm disabled:opacity-60"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-primary-dark">
              {p.category}
            </span>
            <span className="text-sm text-muted-foreground transition group-hover:text-foreground">
              {p.first_message}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1" aria-label="Assistant is typing">
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" />
    </div>
  );
}
