import { describe, expect, it } from "vitest";
import {
  componentSchema,
  mediaSchema,
  presetSchema,
  sourceSchema,
  slugSchema,
  isoDateSchema,
  regionSchema,
} from "@/lib/content/schema";

const validComponent = {
  slug: "heat-pump-basics",
  kind: "explainer",
  title: "How a heat pump works",
  summary: "It moves heat instead of making it.",
  body_md: "## Body\n\nSome text.",
  technologies: ["heat-pump"],
  lanes: ["lower_bills"],
  tenures: ["owner", "renter"],
  housing_types: ["single-family"],
  regions: ["US", "US-VA"],
  prerequisites: [],
  effort: "trivial",
  impact: { cost: 1, carbon: 2, comfort: 3, resilience: 0 },
  sources: ["energystar-heat-pumps"],
  last_verified: "2026-07-11",
  status: "draft",
  version: 1,
  media: ["heat-pump-cycle-diagram"],
};

describe("primitive schemas", () => {
  it("accepts kebab-case slugs and rejects others", () => {
    expect(slugSchema.safeParse("community-solar-2").success).toBe(true);
    expect(slugSchema.safeParse("Community_Solar").success).toBe(false);
    expect(slugSchema.safeParse("-leading").success).toBe(false);
  });

  it("validates ISO calendar dates", () => {
    expect(isoDateSchema.safeParse("2026-07-11").success).toBe(true);
    expect(isoDateSchema.safeParse("2026-13-01").success).toBe(false);
    expect(isoDateSchema.safeParse("July 11").success).toBe(false);
  });

  it("validates region format but not membership", () => {
    expect(regionSchema.safeParse("US").success).toBe(true);
    expect(regionSchema.safeParse("US-VA").success).toBe(true);
    expect(regionSchema.safeParse("US-ZZ-9").success).toBe(true); // open by design
    expect(regionSchema.safeParse("us").success).toBe(false);
  });
});

describe("componentSchema", () => {
  it("accepts a well-formed component", () => {
    expect(componentSchema.safeParse(validComponent).success).toBe(true);
  });

  it("defaults optional array fields", () => {
    const { technologies, lanes, prerequisites, ...rest } = validComponent;
    const parsed = componentSchema.parse(rest);
    expect(parsed.technologies).toEqual([]);
    expect(parsed.prerequisites).toEqual([]);
  });

  it("rejects unknown fields (strict — catches curator typos)", () => {
    const parsed = componentSchema.safeParse({ ...validComponent, tenure: ["owner"] });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty body_md", () => {
    expect(componentSchema.safeParse({ ...validComponent, body_md: "  " }).success).toBe(false);
  });

  it("rejects an impact level outside 0..3", () => {
    const bad = { ...validComponent, impact: { cost: 4, carbon: 0, comfort: 0, resilience: 0 } };
    expect(componentSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(componentSchema.safeParse({ ...validComponent, kind: "tip" }).success).toBe(false);
  });
});

describe("mediaSchema", () => {
  const validMedia = {
    slug: "heat-pump-cycle-diagram",
    kind: "diagram",
    storage_path: "media/x.svg",
    alt: "A diagram",
    credit: { source: "NREL", license: "CC-BY-4.0" },
    technologies: ["heat-pump"],
  };

  it("accepts valid media and defaults caption/regions", () => {
    const parsed = mediaSchema.parse(validMedia);
    expect(parsed.caption).toBe("");
    expect(parsed.regions).toEqual([]);
  });

  it("requires non-empty alt text", () => {
    expect(mediaSchema.safeParse({ ...validMedia, alt: "" }).success).toBe(false);
  });

  it("requires credit source and license", () => {
    expect(
      mediaSchema.safeParse({ ...validMedia, credit: { source: "", license: "CC0" } }).success,
    ).toBe(false);
  });
});

describe("sourceSchema", () => {
  it("requires a valid URL", () => {
    const base = {
      slug: "s",
      label: "L",
      publisher: "P",
      last_verified: "2026-07-11",
    };
    expect(sourceSchema.safeParse({ ...base, url: "https://x.gov" }).success).toBe(true);
    expect(sourceSchema.safeParse({ ...base, url: "not-a-url" }).success).toBe(false);
  });
});

describe("presetSchema", () => {
  it("accepts a preset with patch-shaped entries", () => {
    const parsed = presetSchema.safeParse({
      slug: "lower-bills",
      label: "Lower my bills",
      category: "Save money",
      first_message: "Help me save",
      profile_patches: [{ op: "set", slot: "motivation_weights", provenance: "stated", value: {} }],
      tenures: ["owner"],
    });
    expect(parsed.success).toBe(true);
  });
});
