import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Sun,
  Thermometer,
  Car,
  Home,
  MessageCircle,
  FileText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Clean Start — Your Clean Energy Education Companion" },
      {
        name: "description",
        content:
          "Understand solar, heat pumps, EVs, and efficiency upgrades at your own pace. No jargon, no pressure, no vendor pitches.",
      },
      { property: "og:title", content: "Clean Start — Clean energy, clearly explained" },
      {
        property: "og:description",
        content:
          "A conversational guide to solar, heat pumps, EVs and home efficiency — built for households, not sales pipelines.",
      },
    ],
  }),
  component: Landing,
});

const topics = [
  { icon: Sun, label: "Solar" },
  { icon: Thermometer, label: "Heat pumps" },
  { icon: Car, label: "EVs & charging" },
  { icon: Home, label: "Home efficiency" },
];

const steps = [
  {
    icon: MessageCircle,
    title: "Have a real conversation",
    body: "Tell Clean Start about your home and what you're curious about. Ask anything — there are no dumb questions.",
  },
  {
    icon: Sparkles,
    title: "Learn at your own pace",
    body: "Get plain-language answers tailored to renters, homeowners, or the climate-curious. No vendor pitches.",
  },
  {
    icon: FileText,
    title: "Take a summary with you",
    body: "Wrap up with a personalized research report you can revisit, share, or use to plan next steps.",
  },
];

function Landing() {
  return (
    <div className="relative">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, color-mix(in oklab, var(--primary) 18%, transparent) 0%, transparent 70%)",
          }}
        />
        <div className="mx-auto flex max-w-5xl flex-col items-center px-4 pt-8 pb-16 text-center sm:pt-12 sm:pb-20">
          <img src="/Clean-Start-Logo.png" alt="Clean Start" className="mb-6 h-32 w-auto sm:h-48" />

          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Independent. Educational. Privacy-first.
          </span>

          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Clean energy,{" "}
            <span className="bg-gradient-to-r from-[var(--primary)] to-[var(--primary-dark)] bg-clip-text text-transparent">
              clearly explained.
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
            Clean Start is a conversational guide that helps households understand solar, heat
            pumps, EVs, and efficiency upgrades — at your own pace, with no jargon and no sales
            pressure.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="shadow-sm">
              <Link to="/chat">
                Start chatting <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/report">See an example report</Link>
            </Button>
          </div>

          <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            No account required to start. Your conversations stay yours.
          </p>

          {/* Topic chips */}
          <ul className="mt-12 flex flex-wrap items-center justify-center gap-2">
            {topics.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground/80"
              >
                <Icon className="h-3.5 w-3.5 text-primary" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              A calmer way to learn what's right for your home.
            </h2>
            <p className="mt-4 text-muted-foreground">
              No quotes, no lead forms, no upsells — just guided education designed around your
              situation.
            </p>
          </div>

          <ol className="mt-12 grid gap-6 sm:grid-cols-3">
            {steps.map(({ icon: Icon, title, body }, i) => (
              <li
                key={title}
                className="relative rounded-2xl border border-border bg-card p-6 text-left shadow-sm"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary-light text-primary-dark">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="text-xs font-medium tracking-wider text-muted-foreground">
                  STEP {i + 1}
                </div>
                <h3 className="mt-1 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-4 py-20">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-[var(--primary-light)] to-card p-10 text-center sm:p-14">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Ready to make sense of clean energy?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Start a conversation now — or peek at an example research report to see what you'll walk
            away with.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/chat">
                Start chatting <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/report">See an example report</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
