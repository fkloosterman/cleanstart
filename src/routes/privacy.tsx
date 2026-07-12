import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FileText,
  Lock,
  Database,
  Shield,
  Trash2,
  Cookie,
  Mail,
  Scale,
  AlertTriangle,
  Ban,
  RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy & Terms of Service · Clean Start" },
      {
        name: "description",
        content:
          "Read Clean Start's Privacy Policy and Terms of Service — how we handle your data and the rules for using the app.",
      },
      { property: "og:title", content: "Privacy Policy & Terms of Service · Clean Start" },
      {
        property: "og:description",
        content:
          "How Clean Start collects, stores, and protects your data, and the terms that govern using the app.",
      },
    ],
  }),
  component: PrivacyPage,
});

const LAST_UPDATED = "July 9, 2026";

function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      {/* Intro */}
      <header className="mb-10">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5 text-primary" />
          Legal
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Privacy Policy & Terms of Service</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          This page explains how Clean Start handles your data and the terms that govern your use of
          the app. It's written in plain language on purpose — if anything is unclear, reach out and
          we'll explain it further.
        </p>
        <p className="mt-4 text-xs text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <nav className="mt-6 flex gap-2 text-sm">
          <a
            href="#privacy-policy"
            className="rounded-full border border-border bg-card px-3 py-1.5 hover:bg-accent"
          >
            Privacy Policy
          </a>
          <a
            href="#terms-of-service"
            className="rounded-full border border-border bg-card px-3 py-1.5 hover:bg-accent"
          >
            Terms of Service
          </a>
        </nav>
      </header>

      {/* Privacy Policy */}
      <section
        id="privacy-policy"
        className="scroll-mt-20 rounded-2xl border border-border bg-card p-6 sm:p-8"
      >
        <div className="mb-2 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
          <Lock className="h-3.5 w-3.5" />
          Privacy Policy
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">How we handle your data</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Clean Start does not sell your data, track you across the web, or recommend specific
          vendors. This section describes what we collect, how it's used, and the controls you have
          over it.
        </p>

        <div className="mt-8 space-y-6 text-sm">
          <PolicyItem icon={<Database className="h-4 w-4 text-primary" />} title="What we collect">
            If you create an account, we store your email address and an optional persona (renter,
            homeowner, or curious). When you chat, we store your messages, the assistant's replies,
            and any reports you generate so you can return to them later. We don't ask for your
            address, income, utility account number, or other sensitive identifiers.
          </PolicyItem>

          <PolicyItem icon={<Cookie className="h-4 w-4 text-primary" />} title="Guest mode">
            You can use Clean Start without an account. Guest conversations are kept in your
            browser's local storage on your device and are not linked to an identity or saved to our
            servers. Clearing your browser data or switching devices will remove them.
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
            conversations to train models, and we don't share them with third parties for marketing
            or advertising.
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

          <PolicyItem
            icon={<RefreshCw className="h-4 w-4 text-primary" />}
            title="Changes to this policy"
          >
            If we make material changes to how we handle your data, we'll update this page and
            revise the "last updated" date above.
          </PolicyItem>
        </div>
      </section>

      {/* Terms of Service */}
      <section
        id="terms-of-service"
        className="mt-10 scroll-mt-20 rounded-2xl border border-border bg-card p-6 sm:p-8"
      >
        <div className="mb-2 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
          <Scale className="h-3.5 w-3.5" />
          Terms of Service
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">Terms for using Clean Start</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          By using Clean Start, you agree to the terms below. If you don't agree, please don't use
          the app.
        </p>

        <div className="mt-8 space-y-6 text-sm">
          <PolicyItem
            icon={<FileText className="h-4 w-4 text-primary" />}
            title="What Clean Start is"
          >
            Clean Start is an educational, vendor-neutral guide that helps you explore clean energy
            options — solar, heat pumps, EVs, weatherization, and incentives — through conversation.
            Responses are generated by an AI model and are general in nature.
          </PolicyItem>

          <PolicyItem
            icon={<AlertTriangle className="h-4 w-4 text-primary" />}
            title="Not professional advice"
          >
            Clean Start does not provide financial, legal, tax, engineering, or contracting advice.
            Incentive amounts, eligibility rules, and equipment options change frequently and can be
            inaccurate or out of date. Confirm specifics with a licensed professional, your utility,
            or the relevant program administrator before making a financial decision.
          </PolicyItem>

          <PolicyItem icon={<Ban className="h-4 w-4 text-primary" />} title="Acceptable use">
            Don't use Clean Start to submit unlawful, abusive, or harmful content, to attempt to
            disrupt or reverse-engineer the service, or to misrepresent yourself. We may suspend or
            terminate access for accounts that violate these terms.
          </PolicyItem>

          <PolicyItem
            icon={<Shield className="h-4 w-4 text-primary" />}
            title="Accounts and security"
          >
            You're responsible for keeping your login credentials secure and for activity that
            happens under your account. Tell us right away if you suspect unauthorized access.
          </PolicyItem>

          <PolicyItem
            icon={<Scale className="h-4 w-4 text-primary" />}
            title="No warranty, limitation of liability"
          >
            Clean Start is provided "as is," without warranties of any kind. We aren't liable for
            decisions made based on information from the app, including purchases, installations, or
            contracts entered into with third parties. We don't represent or endorse any installer,
            utility, or manufacturer.
          </PolicyItem>

          <PolicyItem
            icon={<RefreshCw className="h-4 w-4 text-primary" />}
            title="Changes to the service or terms"
          >
            We may update Clean Start's features or these terms over time. Continuing to use the app
            after changes take effect means you accept the updated terms.
          </PolicyItem>

          <PolicyItem icon={<Mail className="h-4 w-4 text-primary" />} title="Contact">
            Questions about these terms:{" "}
            <a href="mailto:hello@cleanstart.app" className="underline underline-offset-4">
              hello@cleanstart.app
            </a>
            .
          </PolicyItem>
        </div>
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
