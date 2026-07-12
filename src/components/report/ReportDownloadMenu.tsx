/**
 * Download menu for a structured ReportDocument (WP3.9, design §7.2).
 *
 * Every format is a frozen *projection* of the document, never a snapshot
 * of the page: the shared `projectReportDocument` block list drives them
 * all, so PDF, Word, Markdown and plain text stay in lockstep. The pure
 * projection and text renderers live in `@/lib/report/export` (unit-tested);
 * only the binary walkers (jsPDF, docx) live here, at the UI edge, and are
 * lazy-imported so their weight never lands in the main bundle.
 *
 * The same component serves guest and signed-in reports — export is fully
 * client-side, so guest parity (§9) is automatic.
 */

import { ChevronDown, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ReportDocument } from "@/lib/report/document";
import {
  projectReportDocument,
  reportToMarkdown,
  reportToPlainText,
  stripMarkdown,
  REPORT_EXPORT_FILENAME_BASE,
  type ExportBlock,
} from "@/lib/report/export";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Flatten a block's prose to plain text, stripping Markdown when present. */
function blockText(b: Extract<ExportBlock, { kind: "p" }>): string {
  return b.markdown ? stripMarkdown(b.text) : b.text;
}

async function downloadPdf(doc: ReportDocument) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (h: number) => {
    if (y + h > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
  };
  const write = (text: string, size: number, opts: { bold?: boolean; gray?: boolean } = {}) => {
    pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(opts.gray ? 110 : 20);
    const lines = pdf.splitTextToSize(text, maxWidth) as string[];
    const lineHeight = size * 1.35;
    for (const line of lines) {
      ensureSpace(lineHeight);
      pdf.text(line, margin, y);
      y += lineHeight;
    }
  };
  const gap = (h = 6) => {
    y += h;
  };

  for (const b of projectReportDocument(doc)) {
    switch (b.kind) {
      case "h1":
        write(b.text, 20, { bold: true });
        gap(4);
        break;
      case "h2":
        gap(10);
        write(b.text, 14, { bold: true });
        gap(2);
        break;
      case "h3":
        gap(4);
        write(b.text, 12, { bold: true });
        break;
      case "p":
        write(blockText(b), 11);
        gap(4);
        break;
      case "muted":
        write(b.text, 10, { gray: true });
        gap(2);
        break;
      case "bullet":
        write(`•  ${b.text}`, 11);
        break;
      case "kv":
        write(`${b.label}: ${b.value}`, 11);
        break;
      case "source":
        write(b.label, 11, { bold: true });
        write(b.detail, 10, { gray: true });
        write(b.url, 9, { gray: true });
        gap(4);
        break;
    }
  }

  pdf.save(`${REPORT_EXPORT_FILENAME_BASE}.pdf`);
}

async function downloadDocx(doc: ReportDocument) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");
  const children: InstanceType<typeof Paragraph>[] = [];

  for (const b of projectReportDocument(doc)) {
    switch (b.kind) {
      case "h1":
        children.push(
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(b.text)] }),
        );
        break;
      case "h2":
        children.push(
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(b.text)] }),
        );
        break;
      case "h3":
        children.push(
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(b.text)] }),
        );
        break;
      case "p":
        children.push(new Paragraph({ children: [new TextRun(blockText(b))] }));
        break;
      case "muted":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: b.text, italics: true, color: "6B7280" })],
          }),
        );
        break;
      case "bullet":
        children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b.text)] }));
        break;
      case "kv":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `${b.label}: `, bold: true }), new TextRun(b.value)],
          }),
        );
        break;
      case "source":
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: b.label, bold: true }),
              new TextRun({ text: `  ${b.detail}`, color: "6B7280" }),
            ],
          }),
        );
        children.push(new Paragraph({ children: [new TextRun({ text: b.url, color: "6B7280" })] }));
        break;
    }
  }

  const document = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(document);
  triggerDownload(blob, `${REPORT_EXPORT_FILENAME_BASE}.docx`);
}

export function ReportDownloadMenu({ document: doc }: { document: ReportDocument }) {
  const guard = (fn: () => void | Promise<void>) => async () => {
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the download");
    }
  };

  const downloadMarkdown = () =>
    triggerDownload(
      new Blob([reportToMarkdown(doc)], { type: "text/markdown" }),
      `${REPORT_EXPORT_FILENAME_BASE}.md`,
    );
  const downloadText = () =>
    triggerDownload(
      new Blob([reportToPlainText(doc)], { type: "text/plain" }),
      `${REPORT_EXPORT_FILENAME_BASE}.txt`,
    );
  const downloadJson = () =>
    triggerDownload(
      new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
      `${REPORT_EXPORT_FILENAME_BASE}.json`,
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Download className="mr-1 h-4 w-4" /> Download
          <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={guard(() => downloadPdf(doc))}>PDF (.pdf)</DropdownMenuItem>
        <DropdownMenuItem onClick={guard(() => downloadDocx(doc))}>Word (.docx)</DropdownMenuItem>
        <DropdownMenuItem onClick={guard(downloadMarkdown)}>Markdown (.md)</DropdownMenuItem>
        <DropdownMenuItem onClick={guard(downloadText)}>Plain text (.txt)</DropdownMenuItem>
        <DropdownMenuItem onClick={guard(downloadJson)}>JSON (.json)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
