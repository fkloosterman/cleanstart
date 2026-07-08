import { createFileRoute, Link } from "@tanstack/react-router";
import { Leaf, Shield, Users, BookOpen, Mail, Database, Lock, Trash2 } from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Clean Start · Privacy-First Energy Guidance" },
      {
        name: "description",
        content:
          "Clean Start is a vendor-neutral, privacy-first companion that helps households explore clean energy options through guided conversation.",
      },
      { property: "og:title", content: "About Clean Start" },
      {
        property: "og:description",
        content:
          "Learn how Clean Start guides households through clean energy decisions — and how we handle your data.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      {/* Intro */}
      <header className="mb-12">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          <Leaf className="h-3.5 w-3.5 text-primary" />
          About Clean Start
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">
          A calmer way to understand your clean energy options.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Clean Start is a conversational guide that helps households — whether you rent, own, or
          are just curious — learn about solar, heat pumps, EVs, weatherization, and incentives at
          your own pace. We don't sell equipment, and we don't take commissions.
        </p>
      </header>

      {/* What we do */}
      <section className="mb-12 grid gap-4 sm:grid-cols-3">
        <Card icon={<BookOpen className="h-5 w-5 text-primary" />} title="Educational, not salesy">
          Plain-language answers grounded in publicly available information. No upsells, no lead
          generation.
        </Card>
        <Card icon={<Users className="h-5 w-5 text-primary" />} title="Built for your situation">
          Guidance adapts to whether you're a renter, a homeowner, or simply exploring — so the next
          step actually fits your life.
        </Card>
        <Card icon={<Shield className="h-5 w-5 text-primary" />} title="Vendor-neutral">
          We don't represent any installer, utility, or manufacturer. Our only job is to help you
          ask better questions.
        </Card>
      </section>

      {/* Privacy */}
      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="mb-2 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
          <Lock className="h-3.5 w-3.5" />
          Privacy
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">How we handle your data</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is maintained by the Clean Start team to answer common privacy questions about
          the app. It describes app-visible controls and current practices — it isn't a legal
          certification or independent audit.
        </p>

        <div className="mt-8 space-y-6 text-sm">
          <PolicyItem icon={<Database className="h-4 w-4 text-primary" />} title="What we collect">
            When you sign in, we store your account identifier and an optional persona (renter,
            homeowner, curious). When you chat, we store your messages, the assistant's replies, and
            any reports you generate so you can come back to them later. We don't ask for your
            address, income, utility account, or other sensitive identifiers.
          </PolicyItem>

          <PolicyItem icon={<Lock className="h-4 w-4 text-primary" />} title="Who can see it">
            Your sessions, messages, and reports are private to your account. Database access is
            enforced with row-level security so that only you — signed in — can read or modify your
            own data. The Clean Start team can't read your conversations through the app interface.
          </PolicyItem>

          <PolicyItem
            icon={<Shield className="h-4 w-4 text-primary" />}
            title="How AI responses are generated"
          >
            Your messages are sent to a hosted AI provider through a server-side gateway to produce
            replies. The provider's API key is never exposed in your browser. We don't use your
            conversations to train models, and we don't share them with third parties for marketing.
          </PolicyItem>

          <PolicyItem icon={<Trash2 className="h-4 w-4 text-primary" />} title="Deleting your data">
            You can delete any conversation (and its report) from{" "}
            <Link to="/history" className="underline underline-offset-4">
              your sessions
            </Link>{" "}
            page at any time. To delete your account entirely, email us at the address below and
            we'll remove your sessions, messages, reports, and profile.
          </PolicyItem>

          <PolicyItem icon={<Mail className="h-4 w-4 text-primary" />} title="Contact">
            Privacy questions, data requests, or feedback:{" "}
            <a href="mailto:hello@cleanstart.app" className="underline underline-offset-4">
              hello@cleanstart.app
            </a>
            .
          </PolicyItem>
        </div>
      </section>

      {/* Disclaimers */}
      <section className="mt-10 rounded-xl border border-dashed border-border bg-muted/30 p-5 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">Not professional advice.</strong> Clean Start provides
          general educational information. Incentive amounts, eligibility rules, and equipment
          options change frequently — confirm specifics with a licensed professional, your utility,
          or the program administrator before making a financial decision.
        </p>
      </section>

      <div className="mt-12 flex justify-center">
        <Link
          to="/chat"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
        >
          Start a conversation
        </Link>
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-2">{icon}</div>
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function PolicyItem({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        {icon}
      </div>
      <div className="flex-1">
        <h3 className="font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
