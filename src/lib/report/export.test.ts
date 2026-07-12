import { describe, expect, it } from "vitest";
import { REPORT_DOCUMENT_FIXTURES, REPORT_FIXTURE_KEYS } from "@/lib/report/fixtures";
import {
  projectReportDocument,
  reportToMarkdown,
  reportToPlainText,
  stripMarkdown,
} from "@/lib/report/export";
import { documentSections } from "@/lib/report/document";

describe("projectReportDocument", () => {
  it("projects a header, an 'as of' stamp, and a live-plan footer", () => {
    const blocks = projectReportDocument(REPORT_DOCUMENT_FIXTURES.lower_bills);
    expect(blocks[0]).toEqual({ kind: "h1", text: "Clean Start — Your Research Summary" });
    // Deterministic UTC date from the fixture's fixed generated_at.
    expect(blocks.some((b) => b.kind === "muted" && b.text === "As of July 11, 2026.")).toBe(true);
    const last = blocks[blocks.length - 1];
    expect(last.kind === "muted" && /live plan may have progressed/.test(last.text)).toBe(true);
  });

  it("omits held-back action items and summarises them as a count (§7.2)", () => {
    const blocks = projectReportDocument(REPORT_DOCUMENT_FIXTURES.lower_bills);
    const text = reportToMarkdown(REPORT_DOCUMENT_FIXTURES.lower_bills);
    // Revealed items are present...
    expect(text).toContain("Book a home energy assessment");
    expect(text).toContain("Get quotes for a cold-climate heat pump");
    // ...held-back ones (revealed: false) never leak into the frozen artifact.
    expect(text).not.toContain("Check whether your panel has room");
    expect(text).not.toContain("Stack the federal heat-pump tax credit");
    // ...and are summarised instead.
    expect(blocks.some((b) => b.kind === "muted" && /2 more steps in your plan/.test(b.text))).toBe(
      true,
    );
  });

  it("labels authored (D20 hybrid) items as not-yet-reviewed", () => {
    // learning has an authored background entry.
    const text = reportToMarkdown(REPORT_DOCUMENT_FIXTURES.learning);
    expect(text).toContain("not yet from our reviewed library");
  });

  it("follows the lane's section order and emphasis", () => {
    // learning: background is the report ("full" → its heading), action plan collapses to nothing.
    const learning = REPORT_DOCUMENT_FIXTURES.learning;
    const emphasis = Object.fromEntries(documentSections(learning).map((s) => [s.id, s.emphasis]));
    expect(emphasis.background).toBe("full");
    const md = reportToMarkdown(learning);
    expect(md).toContain("## Understanding the space");
    expect(md).not.toContain("## Your action plan");

    // lower_bills: action-first, background collapsed → plain "Background" heading.
    const bills = reportToMarkdown(REPORT_DOCUMENT_FIXTURES.lower_bills);
    expect(bills).toContain("## Background");
    expect(bills).toContain("## Your action plan");
  });

  it("never emits a bare heading for an empty section (minimal document)", () => {
    const md = reportToMarkdown(REPORT_DOCUMENT_FIXTURES.minimal);
    expect(md).not.toContain("## Background");
    expect(md).not.toContain("## Your action plan");
    expect(md).not.toContain("## Open questions");
    expect(md).not.toContain("## Sources");
    // The always-present sections still render.
    expect(md).toContain("What we based this on");
    expect(md).toContain("A place to start"); // the goals headline
  });

  it("carries frozen source citations with their url and verified date", () => {
    const md = reportToMarkdown(REPORT_DOCUMENT_FIXTURES.lower_bills);
    expect(md).toContain("## Sources (4)");
    expect(md).toContain("https://www.energy.gov/energysaver/weatherize");
    expect(md).toContain("verified 2026-06-01");
  });

  it("projects every fixture without throwing", () => {
    for (const key of REPORT_FIXTURE_KEYS) {
      expect(() => projectReportDocument(REPORT_DOCUMENT_FIXTURES[key])).not.toThrow();
      expect(() => reportToPlainText(REPORT_DOCUMENT_FIXTURES[key])).not.toThrow();
    }
  });
});

describe("reportToMarkdown vs reportToPlainText", () => {
  it("passes Markdown prose through in Markdown but strips it in plain text", () => {
    // lower_bills background body_md contains **air sealing and insulation**.
    const md = reportToMarkdown(REPORT_DOCUMENT_FIXTURES.lower_bills);
    expect(md).toContain("**air sealing and insulation**");

    const txt = reportToPlainText(REPORT_DOCUMENT_FIXTURES.lower_bills);
    expect(txt).toContain("air sealing and insulation");
    expect(txt).not.toContain("**air sealing and insulation**");
  });
});

describe("stripMarkdown", () => {
  it("flattens emphasis, headings, bullets and links", () => {
    expect(stripMarkdown("**bold** and *italic* and `code`")).toBe("bold and italic and code");
    expect(stripMarkdown("## Heading")).toBe("Heading");
    expect(stripMarkdown("- item")).toBe("• item");
    expect(stripMarkdown("see [the guide](https://example.com)")).toBe(
      "see the guide (https://example.com)",
    );
  });
});
