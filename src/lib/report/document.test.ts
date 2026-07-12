import { describe, expect, it } from "vitest";
import { SLOT_NAMES } from "@/lib/profile/registry";
import { slotFilled } from "@/lib/profile/normalize";
import {
  DOC_VERSION,
  documentSections,
  parseReportDocument,
  reportDocumentSchema,
} from "@/lib/report/document";
import { REPORT_DOCUMENT_FIXTURES, REPORT_FIXTURE_KEYS } from "@/lib/report/fixtures";

describe("reportDocumentSchema", () => {
  it("parses every fixture (every section shape validates)", () => {
    for (const key of REPORT_FIXTURE_KEYS) {
      const result = reportDocumentSchema.safeParse(REPORT_DOCUMENT_FIXTURES[key]);
      expect(result.success, `fixture "${key}" should parse`).toBe(true);
    }
  });

  it("covers every section shape across the fixture set", () => {
    const docs = REPORT_FIXTURE_KEYS.map((k) => REPORT_DOCUMENT_FIXTURES[k]);
    // At least one fixture exercises each variable-length section, and at
    // least one leaves each empty — so the renderer is tested both ways.
    expect(docs.some((d) => d.background.length > 0)).toBe(true);
    expect(docs.some((d) => d.background.length === 0)).toBe(true);
    expect(docs.some((d) => d.action_plan.length > 0)).toBe(true);
    expect(docs.some((d) => d.action_plan.length === 0)).toBe(true);
    expect(docs.some((d) => d.open_questions.length > 0)).toBe(true);
    expect(docs.some((d) => d.open_questions.length === 0)).toBe(true);
    expect(docs.some((d) => d.sources.length > 0)).toBe(true);
    expect(docs.some((d) => d.sources.length === 0)).toBe(true);
    // Hybrid mode (D20): both origins are represented.
    const items = docs.flatMap((d) => [...d.background, ...d.action_plan]);
    expect(items.some((i) => i.origin === "library")).toBe(true);
    expect(items.some((i) => i.origin === "authored")).toBe(true);
    // Static disclosure (seam 1): revealed and held-back items both present.
    const actions = docs.flatMap((d) => d.action_plan);
    expect(actions.some((a) => a.revealed)).toBe(true);
    expect(actions.some((a) => !a.revealed)).toBe(true);
  });

  it("normalizes about_you into a full SessionProfile", () => {
    const doc = reportDocumentSchema.parse(REPORT_DOCUMENT_FIXTURES.lower_bills);
    // Every registry slot is present after normalization...
    for (const name of SLOT_NAMES) expect(doc.about_you[name]).toBeDefined();
    // ...and the stated facts survive.
    expect(slotFilled(doc.about_you.tenure)).toBe(true);
    expect(doc.about_you.tenure.value).toBe("owner");
  });

  it("rejects a malformed document (missing required item field)", () => {
    const bad = structuredClone(REPORT_DOCUMENT_FIXTURES.lower_bills) as Record<string, unknown>;
    // Drop `revealed` from an action item — the disclosure gate is required.
    delete (bad.action_plan as Record<string, unknown>[])[0].revealed;
    expect(reportDocumentSchema.safeParse(bad).success).toBe(false);
  });
});

describe("parseReportDocument", () => {
  it("returns null for a legacy report with no document", () => {
    expect(parseReportDocument(null)).toBeNull();
    expect(parseReportDocument(undefined)).toBeNull();
  });

  it("returns null for a non-document blob rather than throwing", () => {
    expect(parseReportDocument({})).toBeNull();
    expect(parseReportDocument({ top_options: [] })).toBeNull();
    expect(parseReportDocument("nope")).toBeNull();
  });

  it("parses a real document", () => {
    const doc = parseReportDocument(REPORT_DOCUMENT_FIXTURES.mixed);
    expect(doc).not.toBeNull();
    expect(doc?.meta.lane_framing).toBe("mixed");
    expect(doc?.meta.doc_version).toBe(DOC_VERSION);
  });
});

describe("documentSections", () => {
  it("collapses background and fills action_plan in an action-first lane", () => {
    const sections = documentSections(REPORT_DOCUMENT_FIXTURES.lower_bills);
    const byId = Object.fromEntries(sections.map((s) => [s.id, s.emphasis]));
    expect(byId.background).toBe("collapsed");
    expect(byId.action_plan).toBe("full");
  });

  it("makes background the report and collapses action_plan in learning", () => {
    const sections = documentSections(REPORT_DOCUMENT_FIXTURES.learning);
    const byId = Object.fromEntries(sections.map((s) => [s.id, s.emphasis]));
    expect(byId.background).toBe("full");
    expect(byId.action_plan).toBe("collapsed");
  });

  it("preserves the six sections in order for every fixture", () => {
    for (const key of REPORT_FIXTURE_KEYS) {
      const ids = documentSections(REPORT_DOCUMENT_FIXTURES[key]).map((s) => s.id);
      expect(ids).toEqual([
        "about_you",
        "your_goals",
        "background",
        "action_plan",
        "open_questions",
        "sources",
      ]);
    }
  });
});
