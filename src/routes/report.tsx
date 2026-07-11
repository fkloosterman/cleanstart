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

const searchSchema = z.object({
  sessionId: z.string().uuid().optional(),
  example: z.coerce.boolean().optional(),
  guest: z.coerce.boolean().optional(),
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
      good_fit_when: ["Existing ducts in decent shape", "You want AC plus heat in one system", "You'd like lower long-term operating costs"],
      tradeoffs: "Upfront cost is higher than swapping in another gas furnace; sizing matters.",
    },
    {
      title: "Rooftop solar",
      why: "South-facing roof, low shading, and an electrifying home make solar a strong long-term fit.",
      good_fit_when: ["You plan to stay 5+ years", "Roof has 10+ years of life left", "You want to offset rising electric use"],
      tradeoffs: "Payback depends on local rates and incentives — worth getting 2–3 quotes.",
    },
  ],
  key_insights: [
    "Electrifying one big appliance at a time keeps things manageable.",
    "Heat pumps work in cold climates with proper sizing.",
    "Insulation and air sealing make every other upgrade work better and cost less.",
  ],
  next_steps: [
    { step: "Get a home energy assessment", detail: "Many utilities offer free or low-cost audits that flag the biggest wins." },
    { step: "Ask three HVAC contractors about cold-climate heat pumps", detail: "Compare sizing and Manual J calculations, not just price." },
    { step: "Check current federal and state incentives", detail: "They change yearly and stack with utility rebates." },
  ],
  resources: [
    { label: "DOE Energy Saver", description: "Plain-language guides on heating, cooling, and weatherization." },
    { label: "Rewiring America", description: "Calculators and step-by-step electrification guides." },
    { label: "EPA Energy Star", description: "Product ratings to compare efficient appliances." },
  ],
};

function ReportPage() {
  const { sessionId, example, guest } = Route.useSearch();
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
    let payload: { tenure: "homeowner" | "renter" | "curious" | null; messages: { role: "user" | "assistant" | "system"; content: string }[] } | null = null;
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

  if (example) {
    return <ReportView report={EXAMPLE} isExample />;
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
    if (report) return <ReportView report={report} />;
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
            <Link to="/report" search={{ example: true }}>See an example</Link>
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

  return <ReportView report={report} onRegenerate={handleGenerate} regenerating={generating} />;
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
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 52;
      const contentWidth = pageWidth - margin * 2;
      let y = 0;

      // ── Color palette ──────────────────────────────────────────────────────
      const BRAND_GREEN: [number, number, number] = [22, 101, 52];   // deep green
      const ACCENT_GREEN: [number, number, number] = [34, 197, 94];  // bright green
      const SECTION_BLUE: [number, number, number] = [30, 64, 175];  // indigo-blue
      const CARD_BG: [number, number, number] = [240, 253, 244];     // very light green
      const DIVIDER: [number, number, number] = [209, 250, 229];     // light green divider
      const BODY_TEXT: [number, number, number] = [30, 41, 59];      // slate-800
      const MUTED_TEXT: [number, number, number] = [100, 116, 139];  // slate-500
      const WHITE: [number, number, number] = [255, 255, 255];

      // ── Helpers ────────────────────────────────────────────────────────────
      const setColor = (rgb: [number, number, number]) =>
        doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      const setFill = (rgb: [number, number, number]) =>
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      const setDraw = (rgb: [number, number, number]) =>
        doc.setDrawColor(rgb[0], rgb[1], rgb[2]);

      const ensureSpace = (h: number) => {
        if (y + h > pageHeight - margin) {
          doc.addPage();
          // Repeat a slim top bar on continuation pages
          setFill(BRAND_GREEN);
          doc.rect(0, 0, pageWidth, 6, "F");
          y = margin;
        }
      };

      /** Render text that wraps within `contentWidth`. Returns the total height consumed. */
      const writeText = (
        text: string,
        size: number,
        style: "normal" | "bold" | "italic" = "normal",
        color: [number, number, number] = BODY_TEXT,
        xOverride?: number,
        widthOverride?: number,
      ): number => {
        doc.setFont("helvetica", style);
        doc.setFontSize(size);
        setColor(color);
        const w = widthOverride ?? contentWidth;
        const x = xOverride ?? margin;
        const lines = doc.splitTextToSize(text, w) as string[];
        const lh = size * 1.35;
        for (const line of lines) {
          ensureSpace(lh);
          doc.text(line, x, y);
          y += lh;
        }
        return lines.length * lh;
      };

      const gap = (h = 10) => { y += h; };

      /** Draw a full-width horizontal rule */
      const rule = (color: [number, number, number] = DIVIDER, thickness = 0.5) => {
        ensureSpace(thickness + 4);
        setDraw(color);
        doc.setLineWidth(thickness);
        doc.line(margin, y, pageWidth - margin, y);
        y += 4;
      };

      /** Section heading with left accent bar */
      const sectionHeading = (title: string) => {
        ensureSpace(28);
        // Left accent bar
        setFill(ACCENT_GREEN);
        doc.rect(margin, y - 13, 3, 16, "F");
        // Title text
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        setColor(SECTION_BLUE);
        doc.text(title.toUpperCase(), margin + 10, y);
        y += 8;
        rule(DIVIDER, 0.5);
        gap(4);
      };

      // ══════════════════════════════════════════════════════════════════════
      // HEADER BANNER
      // ══════════════════════════════════════════════════════════════════════
      setFill(BRAND_GREEN);
      doc.rect(0, 0, pageWidth, 80, "F");

      // Subtle diagonal stripe for texture
      setDraw([16, 80, 40]);
      doc.setLineWidth(12);
      for (let x = -20; x < pageWidth + 80; x += 40) {
        doc.line(x, 0, x + 80, 80);
      }

      // App name / tagline
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      setColor(WHITE);
      doc.text("Clean Start", margin, 38);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      setColor([187, 247, 208]);
      doc.text("Your Personalized Clean Energy Research Summary", margin, 56);

      // Date
      const dateStr = new Date().toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      });
      doc.setFontSize(9);
      setColor([134, 239, 172]);
      doc.text(dateStr, pageWidth - margin, 56, { align: "right" });

      y = 96;

      // ── Readiness score badge ──────────────────────────────────────────────
      if (report.readiness_score !== null) {
        ensureSpace(48);
        const score = report.readiness_score;
        // Badge background
        setFill(CARD_BG);
        setDraw(DIVIDER);
        doc.setLineWidth(1);
        doc.roundedRect(margin, y, contentWidth, 42, 6, 6, "FD");
        // Score number
        doc.setFont("helvetica", "bold");
        doc.setFontSize(26);
        setColor(BRAND_GREEN);
        doc.text(`${score}`, margin + 16, y + 28);
        // Divider
        setDraw([187, 247, 208]);
        doc.setLineWidth(1);
        doc.line(margin + 54, y + 8, margin + 54, y + 34);
        // Label
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        setColor(BODY_TEXT);
        doc.text("Readiness Score", margin + 64, y + 18);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        setColor(MUTED_TEXT);
        doc.text("out of 100 — based on your answers", margin + 64, y + 31);
        y += 54;
      }

      gap(6);

      // ══════════════════════════════════════════════════════════════════════
      // TOP OPTIONS
      // ══════════════════════════════════════════════════════════════════════
      if (topOptions.length) {
        sectionHeading("Top Options");
        topOptions.forEach((o, idx) => {
          ensureSpace(60);
          // Card background
          setFill(CARD_BG);
          setDraw(DIVIDER);
          doc.setLineWidth(1);
          // Estimate height (rough) — we'll draw text then close
          const cardTop = y;
          // Left colour strip
          setFill(ACCENT_GREEN);
          doc.rect(margin, cardTop, 4, 8, "F"); // placeholder, updated after

          y += 14;

          // Option number + title
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          setColor(BRAND_GREEN);
          doc.text(`${idx + 1}.`, margin + 10, y);

          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          setColor(BODY_TEXT);
          const titleLines = doc.splitTextToSize(o.title, contentWidth - 28) as string[];
          titleLines.forEach((line) => {
            doc.text(line, margin + 24, y);
            y += 15;
          });

          gap(2);

          // Why
          writeText(o.why, 10, "normal", BODY_TEXT, margin + 12, contentWidth - 20);
          gap(4);

          // Good fit when
          if (o.good_fit_when?.length) {
            writeText("Good fit when:", 9, "bold", MUTED_TEXT, margin + 12, contentWidth - 20);
            o.good_fit_when.forEach((g) => {
              // draw a tiny filled square as a tick mark (avoids Unicode encoding issues)
              setFill([21, 128, 61]);
              doc.rect(margin + 18, y - 6, 4, 4, "F");
              writeText(g, 9, "normal", [21, 128, 61], margin + 26, contentWidth - 34);
            });
            gap(3);
          }

          // Tradeoffs
          if (o.tradeoffs) {
            writeText(`Tradeoff: ${o.tradeoffs}`, 9, "italic", [161, 98, 7], margin + 12, contentWidth - 20);
          }

          // Draw the card box retroactively
          const cardHeight = y - cardTop + 10;
          setFill(CARD_BG);
          setDraw(DIVIDER);
          doc.roundedRect(margin, cardTop, contentWidth, cardHeight, 4, 4, "FD");

          // Re-draw left accent strip on top
          setFill(ACCENT_GREEN);
          doc.rect(margin, cardTop, 4, cardHeight, "F");

          // Re-draw text (cards drawn after text — text gets covered; re-render)
          y = cardTop + 14;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          setColor(BRAND_GREEN);
          doc.text(`${idx + 1}.`, margin + 10, y);
          doc.setFontSize(12);
          setColor(BODY_TEXT);
          titleLines.forEach((line) => { doc.text(line, margin + 24, y); y += 15; });
          gap(2);
          writeText(o.why, 10, "normal", BODY_TEXT, margin + 12, contentWidth - 20);
          gap(4);
          if (o.good_fit_when?.length) {
            writeText("Good fit when:", 9, "bold", MUTED_TEXT, margin + 12, contentWidth - 20);
            o.good_fit_when.forEach((g) => {
              setFill([21, 128, 61]);
              doc.rect(margin + 18, y - 6, 4, 4, "F");
              writeText(g, 9, "normal", [21, 128, 61], margin + 26, contentWidth - 34);
            });
            gap(3);
          }
          if (o.tradeoffs) writeText(`Tradeoff: ${o.tradeoffs}`, 9, "italic", [161, 98, 7], margin + 12, contentWidth - 20);

          y = cardTop + cardHeight + 10;
          gap(6);
        });
      }

      // ══════════════════════════════════════════════════════════════════════
      // KEY TAKEAWAYS
      // ══════════════════════════════════════════════════════════════════════
      if (insights.length) {
        sectionHeading("Key Takeaways");
        insights.forEach((k) => {
          ensureSpace(20);
          // Bullet dot
          setFill(ACCENT_GREEN);
          doc.circle(margin + 5, y - 4, 3, "F");
          writeText(k, 10, "normal", BODY_TEXT, margin + 16, contentWidth - 16);
          gap(3);
        });
        gap(8);
      }

      // ══════════════════════════════════════════════════════════════════════
      // NEXT STEPS
      // ══════════════════════════════════════════════════════════════════════
      if (steps.length) {
        sectionHeading("Suggested Next Steps");
        steps.forEach((s, i) => {
          ensureSpace(36);
          // Step number circle
          setFill(BRAND_GREEN);
          doc.circle(margin + 10, y - 5, 9, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          setColor(WHITE);
          doc.text(`${i + 1}`, margin + 10, y - 2, { align: "center" });

          // Step title + detail
          const xOff = margin + 26;
          const wOff = contentWidth - 26;
          writeText(s.step, 11, "bold", BODY_TEXT, xOff, wOff);
          writeText(s.detail, 10, "normal", MUTED_TEXT, xOff, wOff);
          gap(8);
        });
        gap(4);
      }

      // ══════════════════════════════════════════════════════════════════════
      // RESOURCES
      // ══════════════════════════════════════════════════════════════════════
      if (resources.length) {
        sectionHeading("Resources to Explore");
        resources.forEach((r) => {
          ensureSpace(24);
          // draw a small coloured square as a resource icon (no Unicode needed)
          setFill(SECTION_BLUE);
          doc.rect(margin + 4, y - 8, 5, 5, "F");
          writeText(r.label, 10, "bold", SECTION_BLUE, margin + 14, contentWidth - 18);
          writeText(r.description, 10, "normal", MUTED_TEXT, margin + 14, contentWidth - 18);
          gap(6);
        });
      }

      // ── Footer on every page ───────────────────────────────────────────────
      const totalPages = (doc.internal as { getNumberOfPages?: () => number }).getNumberOfPages?.() ?? 1;
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        setFill([248, 250, 252]);
        doc.rect(0, pageHeight - 28, pageWidth, 28, "F");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        setColor(MUTED_TEXT);
        doc.text("Generated by Clean Start • cleanstart.app", margin, pageHeight - 10);
        doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 10, { align: "right" });
      }

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
            children: [new TextRun({ text: `Readiness: ${report.readiness_score}/100`, bold: true })],
          }),
        );
      }
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Top options")] }));
      topOptions.forEach((o) => {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(o.title)] }));
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
              children: [
                new TextRun({ text: "Tradeoff: ", bold: true }),
                new TextRun(o.tradeoffs),
              ],
            }),
          );
      });
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Key takeaways")] }));
      insights.forEach((k) => children.push(new Paragraph({ children: [new TextRun(`• ${k}`)] })));
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Suggested next steps")] }));
      steps.forEach((s, i) => {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun(`${i + 1}. ${s.step}`)],
          }),
        );
        children.push(new Paragraph({ children: [new TextRun(s.detail)] }));
      });
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Resources to explore")] }));
      resources.forEach((r) => {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(r.label)] }));
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
                {regenerating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
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
            {isExample && <Badge variant="secondary" className="ml-2">Example</Badge>}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Your research summary</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            A calm overview of what we discussed, what fits your situation, and small steps you can take next.
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
          Generated for guidance — always verify details with qualified local pros before committing to a project.
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
  if (report.readiness_score !== null) lines.push(`**Readiness:** ${report.readiness_score}/100`, "");
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
    if (o.tradeoffs) parts.push(`<p class="tradeoff"><strong>Tradeoff:</strong> ${e(o.tradeoffs)}</p>`);
  });
  parts.push(`<h2>Key takeaways</h2><ul>`);
  insights.forEach((k) => parts.push(`<li>${e(k)}</li>`));
  parts.push(`</ul><h2>Suggested next steps</h2><ol>`);
  steps.forEach((s) => parts.push(`<li><strong>${e(s.step)}</strong> — ${e(s.detail)}</li>`));
  parts.push(`</ol><h2>Resources to explore</h2><ul>`);
  resources.forEach((r) => parts.push(`<li><strong>${e(r.label)}</strong> — ${e(r.description)}</li>`));
  parts.push(`</ul></body></html>`);
  return parts.join("");
}
