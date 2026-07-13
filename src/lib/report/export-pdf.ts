/**
 * PDF projection of a ReportDocument (WP3.9, design §7.2).
 *
 * A thin jsPDF walker over the shared `projectReportDocument` block list, so
 * the PDF stays in lockstep with the other export formats. It carries the
 * Clean Start visual language (green header banner, blue section headings,
 * slate body text, page footer) ported from the legacy report export.
 *
 * `renderReportPdf` returns the jsPDF instance rather than saving it, so the
 * UI edge can `.save()` in the browser while tests/tools can `.output()`
 * headlessly. jsPDF is dynamically imported so its weight stays out of the
 * main bundle.
 */

import type { jsPDF } from "jspdf";
import type { ReportDocument } from "@/lib/report/document";
import { projectReportDocument, plainText } from "@/lib/report/export";

type RGB = [number, number, number];

// Brand palette, ported from the legacy report PDF export so the new
// document-based export carries the same visual language.
const BRAND_GREEN: RGB = [22, 101, 52];
const ACCENT_GREEN: RGB = [34, 197, 94];
const SECTION_BLUE: RGB = [30, 64, 175];
const DIVIDER: RGB = [209, 250, 229];
const BODY_TEXT: RGB = [30, 41, 59];
const MUTED_TEXT: RGB = [100, 116, 139];
const WHITE: RGB = [255, 255, 255];
const FOOTER_BG: RGB = [248, 250, 252];

/** Build (but don't save) the PDF for a report document. */
export async function renderReportPdf(doc: ReportDocument): Promise<jsPDF> {
  const { jsPDF: JsPDF } = await import("jspdf");
  const pdf = new JsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const setColor = (c: RGB) => pdf.setTextColor(c[0], c[1], c[2]);
  const setFill = (c: RGB) => pdf.setFillColor(c[0], c[1], c[2]);
  const setDraw = (c: RGB) => pdf.setDrawColor(c[0], c[1], c[2]);

  const ensureSpace = (h: number) => {
    // Keep clear of the footer band (24pt) at the bottom of every page.
    if (y + h > pageHeight - margin) {
      pdf.addPage();
      // Slim brand bar across the top of continuation pages.
      setFill(BRAND_GREEN);
      pdf.rect(0, 0, pageWidth, 6, "F");
      y = margin;
    }
  };

  const write = (
    text: string,
    size: number,
    opts: { bold?: boolean; italic?: boolean; color?: RGB; x?: number; width?: number } = {},
  ) => {
    if (!text) return;
    pdf.setFont("helvetica", opts.italic ? "italic" : opts.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    setColor(opts.color ?? BODY_TEXT);
    const x = opts.x ?? margin;
    const w = opts.width ?? maxWidth - (x - margin);
    const lines = pdf.splitTextToSize(text, w) as string[];
    const lineHeight = size * 1.35;
    for (const line of lines) {
      ensureSpace(lineHeight);
      pdf.text(line, x, y);
      y += lineHeight;
    }
  };
  const gap = (h = 6) => {
    y += h;
  };

  const rule = (color: RGB = DIVIDER, thickness = 0.5) => {
    ensureSpace(thickness + 4);
    setDraw(color);
    pdf.setLineWidth(thickness);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 4;
  };

  // Section heading: left accent bar + uppercase blue title + divider rule.
  const sectionHeading = (title: string) => {
    ensureSpace(28);
    setFill(ACCENT_GREEN);
    pdf.rect(margin, y - 10, 3, 14, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    setColor(SECTION_BLUE);
    pdf.text(title.toUpperCase(), margin + 10, y);
    y += 6;
    rule(DIVIDER, 0.5);
    gap(4);
  };

  // ── Header banner (page 1) ──────────────────────────────────────────────
  setFill(BRAND_GREEN);
  pdf.rect(0, 0, pageWidth, 80, "F");
  // Subtle diagonal stripes for texture.
  setDraw([16, 80, 40]);
  pdf.setLineWidth(12);
  for (let x = -20; x < pageWidth + 80; x += 40) {
    pdf.line(x, 0, x + 80, 80);
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  setColor(WHITE);
  pdf.text("Clean Start", margin, 38);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  setColor([187, 247, 208]);
  pdf.text("Your Personalized Clean Energy Research Summary", margin, 56);
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  pdf.setFontSize(9);
  setColor([134, 239, 172]);
  pdf.text(dateStr, pageWidth - margin, 56, { align: "right" });
  y = 104;

  // ── Body: walk the shared projected blocks ──────────────────────────────
  for (const b of projectReportDocument(doc)) {
    switch (b.kind) {
      case "h1":
        // The document's own title, rendered prominently under the banner.
        write(b.text, 20, { bold: true, color: BRAND_GREEN });
        gap(6);
        break;
      case "h2":
        gap(6);
        sectionHeading(b.text);
        break;
      case "h3":
        gap(4);
        write(b.text, 12, { bold: true });
        gap(1);
        break;
      case "p":
        write(plainText(b), 11);
        gap(4);
        break;
      case "muted":
        write(b.text, 10, { color: MUTED_TEXT });
        gap(2);
        break;
      case "bullet":
        ensureSpace(16);
        setFill(ACCENT_GREEN);
        pdf.circle(margin + 4, y - 4, 2.5, "F");
        write(b.text, 11, { x: margin + 14 });
        break;
      case "kv":
        write(`${b.label}: ${b.value}`, 11, { bold: true });
        break;
      case "source":
        write(b.label, 11, { bold: true, color: SECTION_BLUE });
        write(b.detail, 10, { color: MUTED_TEXT });
        write(b.url, 9, { color: MUTED_TEXT });
        gap(4);
        break;
    }
  }

  // ── Footer on every page ────────────────────────────────────────────────
  const totalPages =
    (pdf.internal as { getNumberOfPages?: () => number }).getNumberOfPages?.() ?? 1;
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    setFill(FOOTER_BG);
    pdf.rect(0, pageHeight - 24, pageWidth, 24, "F");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    setColor(MUTED_TEXT);
    pdf.text("Generated by Clean Start • cleanstart.app", margin, pageHeight - 9);
    pdf.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 9, {
      align: "right",
    });
  }

  return pdf;
}
