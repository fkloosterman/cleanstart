import { describe, expect, it } from "vitest";
import { buildRetrieved } from "@/lib/content/retrieval";
import type { ContentComponent, ContentMedia, ContentSource } from "@/lib/content/schema";
import { emptyProfile } from "@/lib/profile/normalize";
import { applyPatches, type ProfilePatch } from "@/lib/profile/patches";

let n = 0;
function comp(overrides: Partial<ContentComponent> = {}): ContentComponent {
  return {
    slug: `c-${n++}`,
    kind: "explainer",
    title: "T",
    summary: "s",
    body_md: "b",
    technologies: [],
    lanes: [],
    tenures: [],
    housing_types: [],
    regions: [],
    prerequisites: [],
    effort: "trivial",
    impact: { cost: 1, carbon: 0, comfort: 0, resilience: 0 },
    sources: [],
    last_verified: "2026-07-11",
    status: "published",
    version: 1,
    media: [],
    ...overrides,
  };
}

const source = (slug: string): ContentSource => ({
  slug,
  label: `${slug} label`,
  url: `https://example.org/${slug}`,
  publisher: "Pub",
  last_verified: "2026-07-11",
});

const media = (slug: string): ContentMedia => ({
  slug,
  kind: "diagram",
  storage_path: `media/${slug}.svg`,
  alt: `${slug} alt`,
  caption: "",
  credit: { source: "s", license: "l" },
  technologies: [],
  regions: [],
});

const costProfile = () =>
  applyPatches(emptyProfile(), [
    {
      op: "set",
      slot: "motivation_weights",
      value: { cost: 1, carbon: 0, comfort: 0, resilience: 0, learning: 0 },
      provenance: "stated",
    } as ProfilePatch,
  ]).profile;

describe("buildRetrieved", () => {
  it("selects eligible components via the real pipeline and shapes them", () => {
    const library = {
      components: [comp({ slug: "shown" }), comp({ slug: "draft", status: "draft" })],
      sources: [],
      media: [],
    };
    const result = buildRetrieved(library, costProfile());
    expect(result.map((r) => r.slug)).toEqual(["shown"]); // draft excluded by the pipeline
    expect(result[0]).toMatchObject({ slug: "shown", title: "T", summary: "s" });
  });

  it("resolves source slugs to citation labels and drops unknown ones", () => {
    const library = {
      components: [comp({ slug: "a", sources: ["known", "missing"] })],
      sources: [source("known")],
      media: [],
    };
    const [entry] = buildRetrieved(library, costProfile());
    expect(entry.sources).toEqual([{ label: "known label", publisher: "Pub" }]);
  });

  it("resolves media slugs to figure references", () => {
    const library = {
      components: [comp({ slug: "a", media: ["fig"] })],
      sources: [],
      media: [media("fig")],
    };
    const [entry] = buildRetrieved(library, costProfile());
    expect(entry.figures).toEqual([{ slug: "fig", alt: "fig alt" }]);
  });

  it("omits sources/figures keys entirely when there are none", () => {
    const [entry] = buildRetrieved({ components: [comp()], sources: [], media: [] }, costProfile());
    expect(entry.sources).toBeUndefined();
    expect(entry.figures).toBeUndefined();
  });

  it("honors the limit", () => {
    const components = Array.from({ length: 10 }, (_, i) => comp({ slug: `c${i}` }));
    expect(buildRetrieved({ components, sources: [], media: [] }, costProfile(), 3)).toHaveLength(
      3,
    );
  });
});
