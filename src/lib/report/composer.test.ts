import { describe, expect, it } from "vitest";
import { emptyProfile } from "@/lib/profile/normalize";
import { applyPatches, type ProfilePatch } from "@/lib/profile/patches";
import { buildCandidateContext } from "@/lib/content/candidates";
import { deriveLane } from "@/lib/lanes/derive";
import type { ContentComponent, ContentSource } from "@/lib/content/schema";
import type { SessionProfile } from "@/lib/profile/registry";
import {
  assembleReportDocument,
  authoringAllowedTopics,
  buildConversationDigest,
  composerOutputSchema,
  deterministicFallback,
  parseComposerJson,
  personalizationClean,
  toComposerCandidate,
  validateComposerOutput,
  AUTHORED_ITEM_CAP,
  REVEALED_ITEM_COUNT,
  type ComposerCandidate,
  type ComposerInput,
  type ComposerRawOutput,
} from "@/lib/report/composer";
import { DOC_VERSION } from "@/lib/report/document";

// ---------------------------------------------------------------------------
// Helpers

function profileFrom(patches: ProfilePatch[]): SessionProfile {
  return applyPatches(emptyProfile(), patches, "2026-07-12T00:00:00.000Z").profile;
}

const ownerProfile = profileFrom([
  { op: "set", slot: "tenure", value: "owner", provenance: "stated" },
  { op: "set", slot: "region", value: { state: "VA" }, provenance: "stated" },
  {
    op: "set",
    slot: "motivation_weights",
    value: { cost: 0.7, carbon: 0.15, comfort: 0.1, resilience: 0.03, learning: 0.02 },
    provenance: "inferred",
  },
  { op: "append", slot: "goals", value: { text: "Cut heating bills" }, provenance: "stated" },
]);

function candidate(slug: string, over: Partial<ComposerCandidate> = {}): ComposerCandidate {
  return {
    slug,
    title: slug,
    summary: `Summary of ${slug}`,
    kind: "action",
    effort: "trivial",
    technologies: [],
    ...over,
  };
}

function makeInput(over: Partial<ComposerInput> = {}): ComposerInput {
  return {
    profile: ownerProfile,
    derivation: deriveLane(ownerProfile.motivation_weights.value),
    candidates: [candidate("a"), candidate("b"), candidate("c"), candidate("d")],
    conversationDigest: "",
    authoringAllowedFor: [],
    ...over,
  };
}

function rawItem(over: Partial<ComposerRawOutput["items"][number]> = {}) {
  return {
    component_slug: "a",
    rank: 1,
    reveal: true,
    personalization: "Because it fits.",
    ...over,
  };
}

function rawOutput(items: ComposerRawOutput["items"]): ComposerRawOutput {
  return {
    headline: "Head",
    intro: "Intro",
    items,
    profile_gaps: ["How old is your furnace?"],
    readiness_note: "You're getting there.",
  };
}

// ---------------------------------------------------------------------------

describe("personalizationClean", () => {
  it("passes plain prose", () => {
    expect(personalizationClean("This suits your older home well.")).toBe(true);
  });
  it("rejects dollar amounts, percentages, and URLs", () => {
    expect(personalizationClean("Save $400 a year")).toBe(false);
    expect(personalizationClean("cuts bills 30%")).toBe(false);
    expect(personalizationClean("see energy.gov for more")).toBe(false);
    expect(personalizationClean("visit https://x.io")).toBe(false);
  });
});

describe("validateComposerOutput", () => {
  it("keeps candidate slugs and drops non-candidates", () => {
    const out = validateComposerOutput(
      rawOutput([rawItem({ component_slug: "a" }), rawItem({ component_slug: "ghost", rank: 2 })]),
      makeInput(),
    );
    expect(out.items.map((i) => i.component_slug)).toEqual(["a"]);
    expect(out.errors.some((e) => e.includes("ghost"))).toBe(true);
  });

  it("orders by rank and reveals only the top few", () => {
    const items = ["a", "b", "c", "d"].map((slug, i) =>
      rawItem({ component_slug: slug, rank: 4 - i }),
    );
    const out = validateComposerOutput(rawOutput(items), makeInput());
    // rank 1 was "d" ... rank 4 was "a": ordering is by rank asc.
    expect(out.items.map((i) => i.component_slug)).toEqual(["d", "c", "b", "a"]);
    expect(out.items.filter((i) => i.revealed).length).toBe(REVEALED_ITEM_COUNT);
    expect(out.items[REVEALED_ITEM_COUNT].revealed).toBe(false);
  });

  it("dedupes repeated slugs, keeping the higher-ranked one", () => {
    const out = validateComposerOutput(
      rawOutput([
        rawItem({ component_slug: "a", rank: 1, personalization: "first" }),
        rawItem({ component_slug: "a", rank: 2, personalization: "second" }),
      ]),
      makeInput(),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].personalization).toBe("first");
  });

  it("drops items whose personalization invents a number", () => {
    const out = validateComposerOutput(
      rawOutput([rawItem({ component_slug: "a", personalization: "Save $500" })]),
      makeInput(),
    );
    expect(out.items).toHaveLength(0);
    expect(out.errors[0]).toMatch(/number or URL/);
  });

  it("drops authored items outside the sanctioned topics", () => {
    const out = validateComposerOutput(
      rawOutput([
        rawItem({ component_slug: null, topic: "solar", title: "Solar note" }),
        rawItem({ component_slug: null, topic: "ev", title: "EV note", rank: 2 }),
      ]),
      makeInput({ authoringAllowedFor: ["solar"] }),
    );
    expect(out.items.filter((i) => i.origin === "authored")).toHaveLength(1);
    expect(out.items[0].authoredTitle).toBe("Solar note");
  });

  it("caps authored items per report", () => {
    const authored = Array.from({ length: AUTHORED_ITEM_CAP + 2 }, (_, i) =>
      rawItem({ component_slug: null, topic: "solar", title: `note ${i}`, rank: i + 1 }),
    );
    const out = validateComposerOutput(
      rawOutput(authored),
      makeInput({ authoringAllowedFor: ["solar"] }),
    );
    expect(out.items.filter((i) => i.origin === "authored")).toHaveLength(AUTHORED_ITEM_CAP);
  });
});

describe("authoringAllowedTopics", () => {
  it("sanctions an interested tech with a thin pool, but not a well-covered or ruled-out one", () => {
    const profile = profileFrom([
      {
        op: "append",
        slot: "preferences",
        value: { entity: "tech:solar", stance: "interested", provenance: "stated" },
        provenance: "stated",
      },
      {
        op: "append",
        slot: "preferences",
        value: { entity: "tech:heat-pump", stance: "priority", provenance: "stated" },
        provenance: "stated",
      },
      {
        op: "append",
        slot: "preferences",
        value: { entity: "tech:ev", stance: "ruled_out", provenance: "stated" },
        provenance: "stated",
      },
    ]);
    const ctx = buildCandidateContext(profile);
    // heat-pump is well covered (2 candidates), solar is thin (0), ev is ruled out.
    const candidates = [
      candidate("hp1", { technologies: ["heat-pump"] }),
      candidate("hp2", { technologies: ["heat-pump"] }),
    ];
    const allowed = authoringAllowedTopics(candidates, ctx);
    expect(allowed).toContain("solar");
    expect(allowed).not.toContain("heat-pump");
    expect(allowed).not.toContain("ev");
  });
});

describe("buildConversationDigest", () => {
  it("bullets recent user turns only, trimming long ones", () => {
    const long = "x".repeat(400);
    const digest = buildConversationDigest([
      { role: "assistant", content: "hi there" },
      { role: "user", content: "I rent an apartment" },
      { role: "user", content: long },
    ]);
    expect(digest).toContain("- I rent an apartment");
    expect(digest).not.toContain("hi there");
    expect(digest).toContain("…");
  });
});

describe("deterministicFallback", () => {
  it("selects the top candidates with reveal capped", () => {
    const out = deterministicFallback(makeInput());
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.items.filter((i) => i.revealed).length).toBeLessThanOrEqual(REVEALED_ITEM_COUNT);
    expect(out.items.every((i) => i.origin === "library")).toBe(true);
  });
});

describe("parseComposerJson", () => {
  it("parses fenced and prose-wrapped JSON, and rejects junk", () => {
    expect(parseComposerJson('```json\n{"headline":"h"}\n```')).toEqual({ headline: "h" });
    expect(parseComposerJson('Here you go: {"a":1} — done')).toEqual({ a: 1 });
    expect(parseComposerJson("no json here")).toBeNull();
  });
  it("round-trips through the output schema", () => {
    const parsed = parseComposerJson(JSON.stringify(rawOutput([rawItem()])));
    expect(composerOutputSchema.safeParse(parsed).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Assembly

const SOURCES: ContentSource[] = [
  {
    slug: "doe",
    label: "Energy Saver",
    url: "https://energy.gov",
    publisher: "DOE",
    last_verified: "2026-06-01",
  },
];

function fullComponent(
  slug: string,
  kind: ContentComponent["kind"],
  over: Partial<ContentComponent> = {},
): ContentComponent {
  return {
    slug,
    kind,
    title: `Title ${slug}`,
    summary: `Summary ${slug}`,
    body_md: `Body ${slug}`,
    technologies: [],
    lanes: [],
    tenures: [],
    housing_types: [],
    regions: [],
    prerequisites: [],
    effort: "weekend",
    impact: { cost: 1, carbon: 1, comfort: 1, resilience: 0 },
    sources: ["doe"],
    last_verified: "2026-06-01",
    status: "published",
    version: 1,
    media: [],
    ...over,
  };
}

describe("assembleReportDocument", () => {
  const components = [
    fullComponent("audit", "action", { title: "Book an audit" }),
    fullComponent("weatherize", "explainer", { title: "Weatherize first" }),
    fullComponent("solar", "explainer", { title: "Solar basics" }),
  ];
  const input = makeInput({
    candidates: components.map((c) =>
      toComposerCandidate({
        component: c,
        score: 1,
        breakdown: { impact: 1, interest: 0, effort: 0 },
      }),
    ),
  });

  it("resolves library titles/effort/sources from components and builds background from unused explainers", () => {
    const composition = validateComposerOutput(
      rawOutput([rawItem({ component_slug: "audit", personalization: "Great first step." })]),
      input,
    );
    const doc = assembleReportDocument(
      composition,
      input,
      { components, sources: SOURCES },
      "2026-07-12T00:00:00.000Z",
    );

    expect(doc.meta.doc_version).toBe(DOC_VERSION);
    expect(doc.action_plan[0]).toMatchObject({
      component_slug: "audit",
      title: "Book an audit", // resolved from the component, not the model
      effort: "weekend",
      origin: "library",
      sources: ["doe"],
    });
    // background = explainers not used as an action item.
    expect(doc.background.map((b) => b.component_slug)).toContain("weatherize");
    expect(doc.background.every((b) => b.body_md.length > 0)).toBe(true);
    // sources are the union of cited components, resolved to full records.
    expect(doc.sources.map((s) => s.slug)).toEqual(["doe"]);
    // readiness + framing come from the profile, not the model.
    expect(doc.meta.lane_framing).toBe("lower_bills");
    expect(doc.meta.readiness.ready).toBe(true);
  });

  it("keeps authored items with the model title and no sources", () => {
    const composition = validateComposerOutput(
      rawOutput([
        rawItem({
          component_slug: null,
          topic: "solar",
          title: "Ask your landlord",
          personalization: "Worth a chat.",
        }),
      ]),
      makeInput({
        candidates: input.candidates,
        authoringAllowedFor: ["solar"],
      }),
    );
    const doc = assembleReportDocument(
      composition,
      input,
      { components, sources: SOURCES },
      "2026-07-12T00:00:00.000Z",
    );
    const authored = doc.action_plan.find((i) => i.origin === "authored");
    expect(authored?.title).toBe("Ask your landlord");
    expect(authored?.component_slug).toBeNull();
    expect(authored?.sources).toEqual([]);
  });
});
