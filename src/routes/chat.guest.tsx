import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
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
import { ArrowLeft, Leaf, Info, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({
  persona: z.enum(["renter", "homeowner", "curious"]).optional(),
});

export const Route = createFileRoute("/chat/guest")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Guest conversation — Clean Start" },
      {
        name: "description",
        content:
          "Chat with Clean Start without an account. Your conversation stays in this browser and isn't saved to our servers.",
      },
    ],
  }),
  component: GuestChatPage,
});

const STORAGE_KEY_PREFIX = "cleanstart.guest.v1";

function storageKey(persona: string | null) {
  return `${STORAGE_KEY_PREFIX}.${persona ?? "default"}`;
}

// Outer component: loads this persona's saved transcript from localStorage.
// The actual useChat-driven view is a separate component keyed on persona, so
// it only mounts once initialMessages is loaded — ai-sdk's useChat seeds its
// message list from props once per mount and ignores later prop changes, so
// mounting before the load finished would leave the list stuck at [] and let
// the persist effect clobber the stored conversation.
function GuestChatPage() {
  const { persona: searchPersona } = Route.useSearch();
  const persona = searchPersona ?? null;

  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);

  // Load from localStorage once per persona (client-only)
  useEffect(() => {
    setInitialMessages(null);
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey(persona));
      if (raw) {
        const parsed = JSON.parse(raw) as UIMessage[];
        setInitialMessages(Array.isArray(parsed) ? parsed : []);
        return;
      }
    } catch {
      // ignore
    }
    setInitialMessages([]);
  }, [persona]);

  if (initialMessages === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <GuestChatConversation
      key={persona ?? "default"}
      persona={persona}
      initialMessages={initialMessages}
    />
  );
}

function GuestChatConversation({
  persona,
  initialMessages,
}: {
  persona: string | null;
  initialMessages: UIMessage[];
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/public/chat-guest",
        body: () => ({ persona }),
      }),
    [persona],
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    id: `guest:${persona ?? "default"}`,
    messages: initialMessages,
    transport,
    onError(err) {
      toast.error(err.message || "Something went wrong");
    },
  });

  // Persist on every change. Safe from mount: useChat seeded from
  // initialMessages, so the first write mirrors what was just loaded rather
  // than overwriting it with an empty list.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey(persona), JSON.stringify(messages));
    } catch {
      // storage full or unavailable; ignore
    }
  }, [messages, persona]);

  useEffect(() => {
    if (status === "ready") textareaRef.current?.focus();
  }, [status]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const isBusy = status === "submitted" || status === "streaming";

  const handleClear = () => {
    if (!confirm("Clear this guest conversation? It can't be recovered.")) return;
    setMessages([]);
    try {
      window.localStorage.removeItem(storageKey(persona));
    } catch {
      // ignore
    }
  };

  return (
    <>
      <PrivacyBanner />
      <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col px-4 pb-6 pt-4">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/chat">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Link>
          </Button>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClear}>
              <RotateCcw className="mr-1 h-4 w-4" /> Clear
            </Button>
          )}
        </div>

        {/* Guest notice */}
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p>
            You're chatting as a guest. Messages stay in this browser only — nothing is saved to
            your account, and you won't be able to generate a report.{" "}
            <Link to="/chat" className="underline underline-offset-4">
              Sign in
            </Link>{" "}
            to save conversations.
          </p>
        </div>

        {/* Transcript */}
        <Conversation className="flex-1 rounded-2xl border border-border bg-card">
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<Leaf className="h-6 w-6 text-primary" />}
                title="Let's get started"
                description="Ask anything about solar, heat pumps, EVs, weatherization, or incentives."
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
    </>
  );
}
