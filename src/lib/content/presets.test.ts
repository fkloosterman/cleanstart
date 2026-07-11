import { describe, expect, it } from "vitest";
import { filterPresetsByTenure } from "@/lib/content/presets";

const rows = [
  { slug: "general-a", tenures: [] },
  { slug: "general-b", tenures: [] },
  { slug: "owner-only", tenures: ["owner"] },
  { slug: "renter-only", tenures: ["renter"] },
  { slug: "both", tenures: ["owner", "renter"] },
];

describe("filterPresetsByTenure", () => {
  it("shows a homeowner only owner-targeted presets (not the general set)", () => {
    const slugs = filterPresetsByTenure(rows, "owner").map((r) => r.slug);
    expect(slugs).toEqual(["owner-only", "both"]);
  });

  it("shows a renter only renter-targeted presets", () => {
    const slugs = filterPresetsByTenure(rows, "renter").map((r) => r.slug);
    expect(slugs).toEqual(["renter-only", "both"]);
  });

  it("shows the general (untargeted) set when tenure is unknown", () => {
    const slugs = filterPresetsByTenure(rows, null).map((r) => r.slug);
    expect(slugs).toEqual(["general-a", "general-b"]);
  });

  it("tolerates a missing tenures field", () => {
    const slugs = filterPresetsByTenure(
      [{ slug: "x" } as { slug: string; tenures: string[] }],
      null,
    );
    expect(slugs.map((r) => r.slug)).toEqual(["x"]);
  });
});
