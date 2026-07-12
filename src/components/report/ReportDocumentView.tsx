/**
 * Web renderer for a ReportDocument (WP3.5, design §7.1–§7.2).
 *
 * The document is the canonical artifact; this is the *living* web view of
 * it (exports are separate frozen projections, WP3.9). It renders the
 * six sections in the order and emphasis the lane playbook dictates
 * (`documentSections`): in `learning` the `background` explainers *are*
 * the report and the action plan collapses; in action-first lanes the
 * reverse.
 *
 * Two boundaries are enforced here, at the render edge rather than trusted
 * from the model:
 * - `about_you` is the profile sidebar, verbatim and read-only — the same
 *   component the chat shows, so the two can never disagree (§7.1).
 * - authored items (D20 hybrid mode) render with an explicit
 *   "not yet from our reviewed library" tag; library items carry citations.
 *
 * Static disclosure (seam 1): only `revealed` action items render; the
 * rest are summarised as a teaser. WP4.1 makes this live.
 */

import { useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Compass,
  ExternalLink,
  HelpCircle,
  Leaf,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { ProfileSidebarContent } from "@/components/ProfileSidebar";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  documentSections,
  type ActionItem,
  type BackgroundEntry,
  type ReportDocument,
  type SourceCitation,
} from "@/lib/report/document";
import type { ReportSectionId } from "@/lib/lanes/playbooks";
import { cn } from "@/lib/utils";

/** D20's resolved label for authored (not-yet-reviewed) items. */
const AUTHORED_LABEL = "General guidance — not yet from our reviewed library";

const EFFORT_LABELS: Record<string, string> = {
  trivial: "Quick",
  weekend: "A weekend",
  project: "A project",
  major: "Major",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function AuthoredTag() {
  return (
    <Badge
      variant="outline"
      className="border-amber-400/60 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
    >
      {AUTHORED_LABEL}
    </Badge>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sections

function AboutYouSection({ doc }: { doc: ReportDocument }) {
  return (
    <Section icon={<ShieldCheck className="h-4 w-4" />} title="What we based this on">
      <div className="rounded-2xl border border-border bg-card p-5">
        <ProfileSidebarContent
          profile={doc.about_you}
          readOnly
          heading="Your situation, as we understood it"
        />
      </div>
    </Section>
  );
}

function GoalsSection({ doc }: { doc: ReportDocument }) {
  return (
    <div className="mb-10">
      <h2 className="text-2xl font-semibold tracking-tight">{doc.your_goals.headline}</h2>
      <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
        <MessageResponse>{doc.your_goals.intro}</MessageResponse>
      </div>
    </div>
  );
}

function BackgroundCard({ entry }: { entry: BackgroundEntry }) {
  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{entry.title}</h3>
        {entry.origin === "authored" && <AuthoredTag />}
      </div>
      <div className="text-sm leading-relaxed text-muted-foreground">
        <MessageResponse>{entry.body_md}</MessageResponse>
      </div>
    </article>
  );
}

function BackgroundSection({
  entries,
  emphasis,
}: {
  entries: BackgroundEntry[];
  emphasis: "full" | "standard" | "collapsed";
}) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  const body = (
    <div className="grid gap-3">
      {entries.map((entry, i) => (
        <BackgroundCard key={entry.component_slug ?? `authored-${i}`} entry={entry} />
      ))}
    </div>
  );

  // Action-first lanes collapse the explainer block behind a disclosure so
  // it never competes with the plan; `learning`/`standard` show it open.
  if (emphasis === "collapsed") {
    return (
      <Section icon={<BookOpen className="h-4 w-4" />} title="Background">
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
            {open ? "Hide" : "Show"} the background ({entries.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">{body}</CollapsibleContent>
        </Collapsible>
      </Section>
    );
  }

  return (
    <Section
      icon={<BookOpen className="h-4 w-4" />}
      title={emphasis === "full" ? "Understanding the space" : "Background"}
    >
      {body}
    </Section>
  );
}

function ActionCard({ item, index }: { item: ActionItem; index: number }) {
  return (
    <li className="flex gap-3 rounded-xl border border-border bg-card p-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-light text-sm font-medium text-primary-dark">
        {index + 1}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.title}</span>
          {item.effort && EFFORT_LABELS[item.effort] && (
            <Badge variant="secondary">{EFFORT_LABELS[item.effort]}</Badge>
          )}
          {item.origin === "authored" && <AuthoredTag />}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{item.personalization}</p>
      </div>
    </li>
  );
}

function ActionPlanSection({ items }: { items: ActionItem[] }) {
  const revealed = items.filter((i) => i.revealed);
  const heldBack = items.length - revealed.length;
  if (revealed.length === 0) return null;

  return (
    <Section icon={<CheckCircle2 className="h-4 w-4" />} title="Your action plan">
      <ol className="space-y-3">
        {revealed.map((item, i) => (
          <ActionCard key={item.component_slug ?? `authored-${i}`} item={item} index={i} />
        ))}
      </ol>
      {heldBack > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          <span>
            {heldBack} more {heldBack === 1 ? "step" : "steps"} in your plan — revealed as you make
            progress.
          </span>
        </div>
      )}
    </Section>
  );
}

function OpenQuestionsSection({ questions }: { questions: string[] }) {
  if (questions.length === 0) return null;
  return (
    <Section icon={<HelpCircle className="h-4 w-4" />} title="Open questions">
      <ul className="space-y-2 rounded-xl border border-border bg-card p-5">
        {questions.map((q, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>{q}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SourcesSection({ sources }: { sources: SourceCitation[] }) {
  if (sources.length === 0) return null;
  return (
    <Section icon={<ExternalLink className="h-4 w-4" />} title={`Sources (${sources.length})`}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sources.map((s) => (
          <li key={s.slug}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 text-xs transition-colors hover:bg-accent"
            >
              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="font-medium text-foreground">{s.label}</span>
                <span className="block text-muted-foreground">
                  {s.publisher} · verified {s.last_verified}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// The document

const SECTION_RENDERERS: Record<
  ReportSectionId,
  (doc: ReportDocument, emphasis: "full" | "standard" | "collapsed") => React.ReactNode
> = {
  about_you: (doc) => <AboutYouSection doc={doc} />,
  your_goals: (doc) => <GoalsSection doc={doc} />,
  background: (doc, emphasis) => <BackgroundSection entries={doc.background} emphasis={emphasis} />,
  action_plan: (doc) => <ActionPlanSection items={doc.action_plan} />,
  open_questions: (doc) => <OpenQuestionsSection questions={doc.open_questions} />,
  sources: (doc) => <SourcesSection sources={doc.sources} />,
};

export function ReportDocumentView({
  document: doc,
  isExample,
}: {
  document: ReportDocument;
  isExample?: boolean;
}) {
  const sections = documentSections(doc);
  const generatedAt = formatDate(doc.meta.generated_at);
  const score = doc.meta.readiness.score;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 rounded-2xl border border-border bg-gradient-to-br from-primary-light/60 to-card p-6">
        <div className="flex items-center gap-2">
          <Leaf className="h-5 w-5 text-primary-dark" />
          <span className="text-sm font-medium text-primary-dark">Clean Start</span>
          {isExample && (
            <Badge variant="secondary" className="ml-2">
              Example
            </Badge>
          )}
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Your research summary</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          A calm overview of what we discussed, what fits your situation, and small steps you can
          take next.
          {generatedAt && <span className="block opacity-80">Generated {generatedAt}.</span>}
        </p>
        <div className="mt-5">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Readiness</span>
            <span className="font-medium text-foreground">{score}/100</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${score}%` }}
            />
          </div>
        </div>
      </header>

      {sections.map((spec) => (
        <div key={spec.id}>{SECTION_RENDERERS[spec.id](doc, spec.emphasis)}</div>
      ))}

      <p className="mt-10 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Compass className="h-3.5 w-3.5" />
        Generated for guidance — always verify details with qualified local pros before committing
        to a project.
      </p>
    </div>
  );
}
