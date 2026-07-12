import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { PrivacyBanner } from "@/components/PrivacyBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Compass,
  Download,
  FileText,
  Leaf,
  Lightbulb,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { generateReport, getReport } from "@/lib/report.functions";
import { generateGuestReport } from "@/lib/guest-report.functions";
import { ReportDocumentView } from "@/components/report/ReportDocumentView";
import { parseReportDocument } from "@/lib/report/document";
import { REPORT_DOCUMENT_FIXTURES, type ReportFixtureKey } from "@/lib/report/fixtures";

const searchSchema = z.object({
  sessionId: z.string().uuid().optional(),
  example: z.coerce.boolean().optional(),
  guest: z.coerce.boolean().optional(),
  /** Preview a hand-written ReportDocument fixture (WP3.5); dev/demo only. */
  doc: z.string().optional(),
});

export const Route = createFileRoute("/report")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Your Research Summary — Clean Start" },
      { name: "description", content: "Your personalized clean energy research summary." },
    ],
  }),
  component: ReportPage,
});

type ReportRow = {
  id: string;
  session_id: string;
  persona: string | null;
  readiness_score: number | null;
  top_options: unknown;
  key_insights: unknown;
  next_steps: unknown;
  resources: unknown;
  created_at: string;
  /** The structured ReportDocument (WP3.5+); null for legacy reports (D5). */
  document?: unknown;
};

type Option = { title: string; why: string; good_fit_when: string[]; tradeoffs: string };
type Step = { step: string; detail: string };
type Resource = { label: string; description: string };

const EXAMPLE: ReportRow = {
  id: "example",
  session_id: "example",
  persona: "homeowner",
  readiness_score: 62,
  created_at: new Date().toISOString(),
  top_options: [
    {
      title: "Heat pump for heating and cooling",
      why: "Your gas furnace is 14 years old and you already have ductwork — a great moment to consider electrifying.",
      good_fit_when: [
        "Existing ducts in decent shape",
        "You want AC plus heat in one system",
        "You'd like lower long-term operating costs",
      ],
      tradeoffs: "Upfront cost is higher than swapping in another gas furnace; sizing matters.",
    },
    {
      title: "Rooftop solar",
      why: "South-facing roof, low shading, and an electrifying home make solar a strong long-term fit.",
      good_fit_when: [
        "You plan to stay 5+ years",
        "Roof has 10+ years of life left",
        "You want to offset rising electric use",
      ],
      tradeoffs: "Payback depends on local rates and incentives — worth getting 2–3 quotes.",
    },
  ],
  key_insights: [
    "Electrifying one big appliance at a time keeps things manageable.",
    "Heat pumps work in cold climates with proper sizing.",
    "Insulation and air sealing make every other upgrade work better and cost less.",
  ],
  next_steps: [
    {
      step: "Get a home energy assessment",
      detail: "Many utilities offer free or low-cost audits that flag the biggest wins.",
    },
    {
      step: "Ask three HVAC contractors about cold-climate heat pumps",
      detail: "Compare sizing and Manual J calculations, not just price.",
    },
    {
      step: "Check current federal and state incentives",
      detail: "They change yearly and stack with utility rebates.",
    },
  ],
  resources: [
    {
      label: "DOE Energy Saver",
      description: "Plain-language guides on heating, cooling, and weatherization.",
    },
    {
      label: "Rewiring America",
      description: "Calculators and step-by-step electrification guides.",
    },
    { label: "EPA Energy Star", description: "Product ratings to compare efficient appliances." },
  ],
};

/**
 * Pick the renderer for a report row: the structured document renderer
 * (WP3.5) when `document` is present, otherwise the legacy renderer (D5 —
 * old rows render exactly as before, never regenerated).
 */
function ReportSurface({
  report,
  isExample,
  onRegenerate,
  regenerating,
}: {
  report: ReportRow;
  isExample?: boolean;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  const document = parseReportDocument(report.document);
  if (document) {
    return (
      <>
        <PrivacyBanner />
        <ReportDocumentView document={document} isExample={isExample} />
      </>
    );
  }
  return (
    <ReportView
      report={report}
      isExample={isExample}
      onRegenerate={onRegenerate}
      regenerating={regenerating}
    />
  );
}

function ReportPage() {
  const { sessionId, example, guest, doc } = Route.useSearch();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const fetchReport = useServerFn(getReport);
  const buildReport = useServerFn(generateReport);
  const buildGuestReport = useServerFn(generateGuestReport);

  const [report, setReport] = useState<ReportRow | null>(example ? EXAMPLE : null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (example || !sessionId || !user) return;
    setLoading(true);
    fetchReport({ data: { sessionId } })
      .then((r) => setReport((r as ReportRow | null) ?? null))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load report"))
      .finally(() => setLoading(false));
  }, [sessionId, user, example, fetchReport]);

  // Guest flow: read transcript from sessionStorage and generate without auth
  useEffect(() => {
    if (!guest || example || report || generating) return;
    if (typeof window === "undefined") return;
    let payload: {
      tenure: "homeowner" | "renter" | "curious" | null;
      profile?: unknown;
      messages: { role: "user" | "assistant" | "system"; content: string }[];
    } | null = null;
    try {
      const raw = window.sessionStorage.getItem("cleanstart.guest-report.v1");
      if (raw) payload = JSON.parse(raw);
    } catch {
      // ignore
    }
    if (!payload || !payload.messages?.length) {
      setError("No conversation found. Start a chat first.");
      return;
    }
    setGenerating(true);
    setError(null);
    buildGuestReport({ data: payload })
      .then((r) => setReport(r as unknown as ReportRow))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Couldn't generate report";
        setError(msg);
        toast.error(msg);
      })
      .finally(() => setGenerating(false));
  }, [guest, example, report, generating, buildGuestReport]);

  const handleGenerate = async () => {
    if (!sessionId) return;
    setGenerating(true);
    setError(null);
    try {
      const r = await buildReport({ data: { sessionId } });
      setReport(r as ReportRow);
      toast.success("Your report is ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't generate report";
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  // Preview a hand-written ReportDocument fixture (WP3.5) — the composer
  // doesn't exist yet, so this is how the new renderer is exercised.
  if (doc && doc in REPORT_DOCUMENT_FIXTURES) {
    return (
      <>
        <PrivacyBanner />
        <ReportDocumentView
          document={REPORT_DOCUMENT_FIXTURES[doc as ReportFixtureKey]}
          isExample
        />
      </>
    );
  }

  if (example) {
    return <ReportSurface report={EXAMPLE} isExample />;
  }

  if (guest) {
    if (generating || (!report && !error)) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <Loader2 className="mx-auto mb-4 h-6 w-6 animate-spin text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Generating your report…</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Reading your conversation and putting together a calm, personalized summary.
          </p>
        </div>
      );
    }
    if (error && !report) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Couldn't generate report</h1>
          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
          <div className="mt-6">
            <Button asChild>
              <Link to="/chat">Back to chat</Link>
            </Button>
          </div>
        </div>
      );
    }
    if (report) return <ReportSurface report={report} />;
  }

  if (!sessionId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <Leaf className="mx-auto mb-4 h-8 w-8 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Your research summary</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Have a conversation first, then come back here to generate a personalized report.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild>
            <Link to="/chat">Start a conversation</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/report" search={{ example: true }}>
              See an example
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to view your report</h1>
        <Button className="mt-6" asChild>
          <Link to="/chat">Go to chat</Link>
        </Button>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <PrivacyBanner />
        <Sparkles className="mx-auto mb-4 h-8 w-8 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Generate your report</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          We'll read your conversation and put together a calm, personalized summary you can save.
        </p>
        <Button className="mt-6" onClick={handleGenerate} disabled={generating}>
          {generating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <FileText className="mr-2 h-4 w-4" /> Generate report
            </>
          )}
        </Button>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        <div className="mt-8">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/chat/$sessionId" params={{ sessionId }}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to conversation
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return <ReportSurface report={report} onRegenerate={handleGenerate} regenerating={generating} />;
}

function ReportView({
  report,
  isExample,
  onRegenerate,
  regenerating,
}: {
  report: ReportRow;
  isExample?: boolean;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  const topOptions = (report.top_options as Option[]) ?? [];
  const insights = (report.key_insights as string[]) ?? [];
  const steps = (report.next_steps as Step[]) ?? [];
  const resources = (report.resources as Resource[]) ?? [];

  const filenameBase = "clean-start-report";

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadMarkdown = () => {
    const md = reportToMarkdown(report, { topOptions, insights, steps, resources });
    triggerDownload(new Blob([md], { type: "text/markdown" }), `${filenameBase}.md`);
  };

  const downloadText = () => {
    const md = reportToMarkdown(report, { topOptions, insights, steps, resources });
    triggerDownload(new Blob([md], { type: "text/plain" }), `${filenameBase}.txt`);
  };

  const downloadHtml = () => {
    const html = reportToHtml(report, { topOptions, insights, steps, resources });
    triggerDownload(new Blob([html], { type: "text/html" }), `${filenameBase}.html`);
  };

  const downloadJson = () => {
    triggerDownload(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      `${filenameBase}.json`,
    );
  };

  const downloadPdf = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const margin = 48;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const maxWidth = pageWidth - margin * 2;
      let y = margin;

      const ensureSpace = (h: number) => {
        if (y + h > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
      };
      const writeLines = (text: string, size: number, bold = false) => {
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(size);
        const lines = doc.splitTextToSize(text, maxWidth) as string[];
        const lineHeight = size * 1.3;
        for (const line of lines) {
          ensureSpace(lineHeight);
          doc.text(line, margin, y);
          y += lineHeight;
        }
      };
      const gap = (h = 8) => {
        y += h;
      };

      writeLines("Clean Start — Your Research Summary", 20, true);
      gap(6);
      if (report.readiness_score !== null) {
        writeLines(`Readiness: ${report.readiness_score}/100`, 11);
        gap(4);
      }

      writeLines("Top options", 14, true);
      gap(2);
      topOptions.forEach((o) => {
        writeLines(o.title, 12, true);
        writeLines(o.why, 11);
        if (o.good_fit_when?.length) {
          writeLines("Good fit when:", 11, true);
          o.good_fit_when.forEach((g) => writeLines(`• ${g}`, 11));
        }
        if (o.tradeoffs) writeLines(`Tradeoff: ${o.tradeoffs}`, 11);
        gap(6);
      });

      writeLines("Key takeaways", 14, true);
      gap(2);
      insights.forEach((k) => writeLines(`• ${k}`, 11));
      gap(6);

      writeLines("Suggested next steps", 14, true);
      gap(2);
      steps.forEach((s, i) => {
        writeLines(`${i + 1}. ${s.step}`, 12, true);
        writeLines(s.detail, 11);
        gap(4);
      });

      writeLines("Resources to explore", 14, true);
      gap(2);
      resources.forEach((r) => {
        writeLines(r.label, 12, true);
        writeLines(r.description, 11);
        gap(4);
      });

      doc.save(`${filenameBase}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create PDF");
    }
  };

  const downloadDocx = async () => {
    try {
      const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");
      const children: InstanceType<typeof Paragraph>[] = [];
      children.push(
        new Paragraph({
          heading: HeadingLevel.TITLE,
          children: [new TextRun("Clean Start — Your Research Summary")],
        }),
      );
      if (report.readiness_score !== null) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `Readiness: ${report.readiness_score}/100`, bold: true }),
            ],
          }),
        );
      }
      children.push(
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Top options")] }),
      );
      topOptions.forEach((o) => {
        children.push(
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(o.title)] }),
        );
        children.push(new Paragraph({ children: [new TextRun(o.why)] }));
        if (o.good_fit_when?.length) {
          children.push(
            new Paragraph({ children: [new TextRun({ text: "Good fit when:", bold: true })] }),
          );
          o.good_fit_when.forEach((g) =>
            children.push(new Paragraph({ children: [new TextRun(`• ${g}`)] })),
          );
        }
        if (o.tradeoffs)
          children.push(
            new Paragraph({
              children: [new TextRun({ text: "Tradeoff: ", bold: true }), new TextRun(o.tradeoffs)],
            }),
          );
      });
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun("Key takeaways")],
        }),
      );
      insights.forEach((k) => children.push(new Paragraph({ children: [new TextRun(`• ${k}`)] })));
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun("Suggested next steps")],
        }),
      );
      steps.forEach((s, i) => {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun(`${i + 1}. ${s.step}`)],
          }),
        );
        children.push(new Paragraph({ children: [new TextRun(s.detail)] }));
      });
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun("Resources to explore")],
        }),
      );
      resources.forEach((r) => {
        children.push(
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(r.label)] }),
        );
        children.push(new Paragraph({ children: [new TextRun(r.description)] }));
      });

      const doc = new Document({ sections: [{ children }] });
      const blob = await Packer.toBlob(doc);
      triggerDownload(blob, `${filenameBase}.docx`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create Word doc");
    }
  };

  return (
    <>
      <PrivacyBanner />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/chat">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            {!isExample && onRegenerate && (
              <Button variant="outline" size="sm" onClick={onRegenerate} disabled={regenerating}>
                {regenerating ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-4 w-4" />
                )}
                Regenerate
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Download className="mr-1 h-4 w-4" /> Download
                  <ChevronDown className="ml-1 h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={downloadPdf}>PDF (.pdf)</DropdownMenuItem>
                <DropdownMenuItem onClick={downloadDocx}>Word (.docx)</DropdownMenuItem>
                <DropdownMenuItem onClick={downloadMarkdown}>Markdown (.md)</DropdownMenuItem>
                <DropdownMenuItem onClick={downloadHtml}>HTML (.html)</DropdownMenuItem>
                <DropdownMenuItem onClick={downloadText}>Plain text (.txt)</DropdownMenuItem>
                <DropdownMenuItem onClick={downloadJson}>JSON (.json)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

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
          </p>
          {report.readiness_score !== null && (
            <div className="mt-5">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Readiness</span>
                <span className="font-medium text-foreground">{report.readiness_score}/100</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${report.readiness_score}%` }}
                />
              </div>
            </div>
          )}
        </header>

        <Section icon={<Compass className="h-4 w-4" />} title="Top options for you">
          <div className="grid gap-3">
            {topOptions.map((o, i) => (
              <article key={i} className="rounded-xl border border-border bg-card p-5">
                <h3 className="font-semibold">{o.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{o.why}</p>
                {o.good_fit_when?.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {o.good_fit_when.map((g, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>{g}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {o.tradeoffs && (
                  <p className="mt-3 rounded-md bg-secondary/60 p-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Tradeoff:</span> {o.tradeoffs}
                  </p>
                )}
              </article>
            ))}
          </div>
        </Section>

        <Section icon={<Lightbulb className="h-4 w-4" />} title="Key takeaways">
          <ul className="space-y-2 rounded-xl border border-border bg-card p-5">
            {insights.map((k, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{k}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={<CheckCircle2 className="h-4 w-4" />} title="Suggested next steps">
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3 rounded-xl border border-border bg-card p-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-light text-sm font-medium text-primary-dark">
                  {i + 1}
                </span>
                <div>
                  <div className="font-medium">{s.step}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section icon={<FileText className="h-4 w-4" />} title="Resources to explore">
          <ul className="grid gap-2 sm:grid-cols-2">
            {resources.map((r, i) => (
              <li key={i} className="rounded-xl border border-border bg-card p-4">
                <div className="font-medium">{r.label}</div>
                <div className="mt-1 text-sm text-muted-foreground">{r.description}</div>
              </li>
            ))}
          </ul>
        </Section>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          Generated for guidance — always verify details with qualified local pros before committing
          to a project.
        </p>
      </div>
    </>
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

function reportToMarkdown(
  report: ReportRow,
  parsed: { topOptions: Option[]; insights: string[]; steps: Step[]; resources: Resource[] },
) {
  const { topOptions, insights, steps, resources } = parsed;
  const lines: string[] = [];
  lines.push("# Clean Start — Your Research Summary", "");
  if (report.readiness_score !== null)
    lines.push(`**Readiness:** ${report.readiness_score}/100`, "");
  lines.push("## Top options");
  topOptions.forEach((o) => {
    lines.push(`### ${o.title}`, "", o.why, "");
    if (o.good_fit_when?.length) {
      lines.push("**Good fit when:**");
      o.good_fit_when.forEach((g) => lines.push(`- ${g}`));
      lines.push("");
    }
    if (o.tradeoffs) lines.push(`*Tradeoff:* ${o.tradeoffs}`, "");
  });
  lines.push("## Key takeaways");
  insights.forEach((k) => lines.push(`- ${k}`));
  lines.push("", "## Next steps");
  steps.forEach((s, i) => lines.push(`${i + 1}. **${s.step}** — ${s.detail}`));
  lines.push("", "## Resources");
  resources.forEach((r) => lines.push(`- **${r.label}** — ${r.description}`));
  return lines.join("\n");
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reportToHtml(
  report: ReportRow,
  parsed: { topOptions: Option[]; insights: string[]; steps: Step[]; resources: Resource[] },
) {
  const { topOptions, insights, steps, resources } = parsed;
  const e = escapeHtml;
  const parts: string[] = [];
  parts.push(
    `<!doctype html><html><head><meta charset="utf-8"><title>Clean Start — Your Research Summary</title>`,
    `<style>body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.5}h1{font-size:1.8rem}h2{margin-top:2rem;border-bottom:1px solid #e5e5e5;padding-bottom:.25rem}h3{margin-bottom:.25rem}.muted{color:#666}.tradeoff{background:#f4f4f5;padding:.5rem .75rem;border-radius:.5rem;font-size:.9rem}</style>`,
    `</head><body>`,
    `<h1>Clean Start — Your Research Summary</h1>`,
  );
  if (report.readiness_score !== null)
    parts.push(`<p><strong>Readiness:</strong> ${report.readiness_score}/100</p>`);
  parts.push(`<h2>Top options</h2>`);
  topOptions.forEach((o) => {
    parts.push(`<h3>${e(o.title)}</h3><p>${e(o.why)}</p>`);
    if (o.good_fit_when?.length) {
      parts.push(`<p><strong>Good fit when:</strong></p><ul>`);
      o.good_fit_when.forEach((g) => parts.push(`<li>${e(g)}</li>`));
      parts.push(`</ul>`);
    }
    if (o.tradeoffs)
      parts.push(`<p class="tradeoff"><strong>Tradeoff:</strong> ${e(o.tradeoffs)}</p>`);
  });
  parts.push(`<h2>Key takeaways</h2><ul>`);
  insights.forEach((k) => parts.push(`<li>${e(k)}</li>`));
  parts.push(`</ul><h2>Suggested next steps</h2><ol>`);
  steps.forEach((s) => parts.push(`<li><strong>${e(s.step)}</strong> — ${e(s.detail)}</li>`));
  parts.push(`</ol><h2>Resources to explore</h2><ul>`);
  resources.forEach((r) =>
    parts.push(`<li><strong>${e(r.label)}</strong> — ${e(r.description)}</li>`),
  );
  parts.push(`</ul></body></html>`);
  return parts.join("");
}
