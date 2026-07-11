import { describe, expect, it } from "vitest";
import { buildSyncRows, syncContent } from "@/lib/content/sync";
import type { ValidatedContent } from "@/lib/content/validate";

const content: ValidatedContent = {
  sources: [
    {
      slug: "s1",
      label: "Src 1",
      url: "https://x.gov",
      publisher: "Gov",
      last_verified: "2026-07-11",
    },
  ],
  media: [
    {
      slug: "m1",
      kind: "diagram",
      storage_path: "media/m1.svg",
      alt: "A diagram",
      caption: "",
      credit: { source: "N", license: "CC0" },
      technologies: ["heat-pump"],
      regions: ["US"],
    },
  ],
  components: [
    {
      slug: "b-comp",
      kind: "explainer",
      title: "B",
      summary: "b",
      body_md: "body",
      technologies: ["heat-pump"],
      lanes: ["lower_bills"],
      tenures: ["owner"],
      housing_types: [],
      regions: ["US"],
      prerequisites: [],
      effort: "trivial",
      impact: { cost: 1, carbon: 0, comfort: 0, resilience: 0 },
      sources: ["s1"],
      last_verified: "2026-07-11",
      status: "draft",
      version: 1,
      media: ["m1"],
    },
    {
      slug: "a-comp",
      kind: "action",
      title: "A",
      summary: "a",
      body_md: "body",
      technologies: [],
      lanes: [],
      tenures: [],
      housing_types: [],
      regions: [],
      prerequisites: [],
      effort: "weekend",
      impact: { cost: 0, carbon: 0, comfort: 0, resilience: 0 },
      sources: [],
      last_verified: "2026-07-11",
      status: "published",
      version: 2,
      media: [],
    },
  ],
  presets: [
    {
      slug: "p1",
      label: "P",
      category: "C",
      first_message: "hi",
      profile_patches: [],
      tenures: ["owner"],
      regions: [],
    },
  ],
};

describe("buildSyncRows", () => {
  it("is deterministic — same content yields byte-identical rows (idempotency basis)", () => {
    expect(buildSyncRows(content)).toEqual(buildSyncRows(content));
    expect(JSON.stringify(buildSyncRows(content))).toBe(JSON.stringify(buildSyncRows(content)));
  });

  it("sorts every table by slug so output order never depends on file discovery", () => {
    const rows = buildSyncRows(content);
    expect(rows.components.map((c) => c.slug)).toEqual(["a-comp", "b-comp"]);
  });

  it("maps expires to null when absent and preserves it when present", () => {
    const withExpiry = {
      ...content,
      components: [{ ...content.components[0], expires: "2027-01-01" }],
    };
    expect(buildSyncRows(content).components[0].expires).toBeNull();
    expect(buildSyncRows(withExpiry).components[0].expires).toBe("2027-01-01");
  });

  it("projects impact and credit as-is (jsonb passthrough)", () => {
    const rows = buildSyncRows(content);
    expect(rows.components.find((c) => c.slug === "b-comp")?.impact).toEqual({
      cost: 1,
      carbon: 0,
      comfort: 0,
      resilience: 0,
    });
    expect(rows.media[0].credit).toEqual({ source: "N", license: "CC0" });
  });
});

describe("syncContent", () => {
  // A minimal fake that records upsert calls and reports success — exercises
  // the executor's per-table dispatch and counts without a live database.
  function fakeClient(failOn?: string) {
    const calls: { table: string; count: number; onConflict?: string }[] = [];
    const client = {
      from(table: string) {
        return {
          upsert(payload: unknown[], opts: { onConflict?: string }) {
            calls.push({ table, count: payload.length, onConflict: opts.onConflict });
            return Promise.resolve({
              error: failOn === table ? { message: "boom" } : null,
            });
          },
        };
      },
    };
    return { client, calls };
  }

  it("upserts every non-empty table by slug and returns counts", async () => {
    const { client, calls } = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const counts = await syncContent(client as any, content);
    expect(counts).toEqual({ sources: 1, media: 1, components: 2, presets: 1 });
    expect(calls.every((c) => c.onConflict === "slug")).toBe(true);
    expect(calls.map((c) => c.table)).toEqual([
      "content_sources",
      "content_media",
      "content_components",
      "content_presets",
    ]);
  });

  it("throws with the table name when an upsert errors", async () => {
    const { client } = fakeClient("content_components");
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      syncContent(client as any, content),
    ).rejects.toThrow(/sync content_components failed: boom/);
  });

  it("skips empty tables (no upsert call)", async () => {
    const { client, calls } = fakeClient();
    const empty: ValidatedContent = { sources: [], media: [], components: [], presets: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const counts = await syncContent(client as any, empty);
    expect(counts).toEqual({ sources: 0, media: 0, components: 0, presets: 0 });
    expect(calls).toHaveLength(0);
  });
});
