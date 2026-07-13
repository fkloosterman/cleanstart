import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { MessageSquare, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/hooks/use-auth";
import {
  submitContact,
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  type ContactCategory,
} from "@/lib/contact.functions";

const searchSchema = z.object({
  category: z.enum(CONTACT_CATEGORIES).optional(),
});

export const Route = createFileRoute("/contact")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Contact & Feedback · Clean Start" },
      {
        name: "description",
        content:
          "Report a bug, suggest an improvement, ask a question, or share feedback about Clean Start.",
      },
    ],
  }),
  component: ContactPage,
});

// Short helper text under each category so all options read clearly.
const CATEGORY_HINTS: Record<ContactCategory, string> = {
  bug: "Something's broken or not working right.",
  suggestion: "An idea to make Clean Start better.",
  question: "Ask us anything about the app or your data.",
  praise: "Tell us what you like.",
  other: "Anything else.",
};

function ContactPage() {
  const { category: initialCategory } = Route.useSearch();
  const { user } = useAuth();
  const submit = useServerFn(submitContact);

  const [category, setCategory] = useState<ContactCategory>(initialCategory ?? "question");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      toast.error("Please enter a message.");
      return;
    }
    setLoading(true);
    try {
      await submit({ data: { category, message: message.trim(), email: email.trim() } });
      toast.success("Thanks for your message", {
        description: "We've received it and will take a look.",
      });
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <header className="mb-8">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5 text-primary" />
          Contact & Feedback
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Get in touch</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Found a bug, have an idea, or just want to say hello? Send us a note below — no account
          needed. Leave an email if you'd like a reply.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-8 rounded-2xl border border-border bg-card p-6 sm:p-8"
      >
        {/* Category */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-foreground">What's this about?</legend>
          <RadioGroup
            value={category}
            onValueChange={(v) => setCategory(v as ContactCategory)}
            className="gap-3"
          >
            {CONTACT_CATEGORIES.map((c) => (
              <label
                key={c}
                htmlFor={`category-${c}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <RadioGroupItem id={`category-${c}`} value={c} className="mt-0.5" />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {CONTACT_CATEGORY_LABELS[c]}
                  </span>
                  <span className="block text-xs text-muted-foreground">{CATEGORY_HINTS[c]}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>

        {/* Message */}
        <div className="space-y-1.5">
          <Label htmlFor="message">Message</Label>
          <Textarea
            id="message"
            required
            rows={6}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell us what's on your mind…"
          />
        </div>

        {/* Optional email */}
        <div className="space-y-1.5">
          <Label htmlFor="reply-email">
            Email <span className="text-muted-foreground">(optional, for a reply)</span>
          </Label>
          <Input
            id="reply-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <Button type="submit" className="w-full sm:w-auto" disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Send className="mr-1 h-4 w-4" /> Send message
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
