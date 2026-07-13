/**
 * Download menu for a structured ReportDocument (WP3.9, design §7.2).
 *
 * Every format is a frozen *projection* of the document, never a snapshot
 * of the page: the shared `projectReportDocument` block list drives them
 * all, so PDF, Word, Markdown and plain text stay in lockstep. The pure
 * projection and text renderers live in `@/lib/report/export` (unit-tested);
 * the PDF walker lives in `@/lib/report/export-pdf`; only the docx walker
 * lives here, at the UI edge. Both binary libraries are lazy-imported so
 * their weight never lands in the main bundle.
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
  plainText,
  REPORT_EXPORT_FILENAME_BASE,
} from "@/lib/report/export";
import { renderReportPdf } from "@/lib/report/export-pdf";

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

async function downloadPdf(doc: ReportDocument) {
  const pdf = await renderReportPdf(doc);
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
        children.push(new Paragraph({ children: [new TextRun(plainText(b))] }));
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
