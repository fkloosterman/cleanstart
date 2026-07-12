import { describe, expect, it } from "vitest";
import {
  buildSyncRows,
  mediaContentType,
  syncContent,
  uploadMediaAssets,
  MEDIA_BUCKET,
} from "@/lib/content/sync";
import type { ValidatedContent } from "@/lib/content/validate";
import type { ContentMedia } from "@/lib/content/schema";

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

describe("mediaContentType", () => {
  it("maps known image extensions and falls back to octet-stream", () => {
    expect(mediaContentType("media/x.svg")).toBe("image/svg+xml");
    expect(mediaContentType("media/x.PNG")).toBe("image/png"); // case-insensitive
    expect(mediaContentType("media/x.jpg")).toBe("image/jpeg");
    expect(mediaContentType("media/x.jpeg")).toBe("image/jpeg");
    expect(mediaContentType("media/x.webp")).toBe("image/webp");
    expect(mediaContentType("media/x.bin")).toBe("application/octet-stream");
  });
});

describe("uploadMediaAssets", () => {
  const media: ContentMedia[] = [
    {
      slug: "b",
      kind: "diagram",
      storage_path: "media/b.svg",
      alt: "b",
      caption: "",
      credit: { source: "N", license: "CC0" },
      technologies: [],
      regions: [],
    },
    {
      slug: "a",
      kind: "photo",
      storage_path: "media/a.png",
      alt: "a",
      caption: "",
      credit: { source: "N", license: "CC0" },
      technologies: [],
      regions: [],
    },
  ];

  function fakeStorage(failOn?: string) {
    const calls: { bucket: string; path: string; contentType?: string; upsert?: boolean }[] = [];
    const client = {
      storage: {
        from(bucket: string) {
          return {
            upload(
              path: string,
              _bytes: Uint8Array,
              opts: { contentType?: string; upsert?: boolean },
            ) {
              calls.push({ bucket, path, contentType: opts.contentType, upsert: opts.upsert });
              return Promise.resolve({ error: failOn === path ? { message: "no bucket" } : null });
            },
          };
        },
      },
    };
    return { client, calls };
  }

  it("uploads every asset by slug order, to the bucket, with content-type and upsert", async () => {
    const { client, calls } = fakeStorage();
    const read = () => new Uint8Array([1, 2, 3]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await uploadMediaAssets(client as any, media, read);
    expect(result).toEqual({ uploaded: 2, missing: [], errors: [] });
    expect(calls.map((c) => c.path)).toEqual(["media/a.png", "media/b.svg"]); // sorted by slug
    expect(calls.every((c) => c.bucket === MEDIA_BUCKET && c.upsert === true)).toBe(true);
    expect(calls.find((c) => c.path === "media/a.png")?.contentType).toBe("image/png");
  });

  it("reports a missing local asset instead of uploading it", async () => {
    const { client, calls } = fakeStorage();
    const read = (p: string) => (p === "media/a.png" ? null : new Uint8Array([1]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await uploadMediaAssets(client as any, media, read);
    expect(result.uploaded).toBe(1);
    expect(result.missing).toEqual(["media/a.png"]);
    expect(calls.map((c) => c.path)).toEqual(["media/b.svg"]);
  });

  it("collects per-asset upload errors without throwing", async () => {
    const { client } = fakeStorage("media/b.svg");
    const read = () => new Uint8Array([1]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await uploadMediaAssets(client as any, media, read);
    expect(result.uploaded).toBe(1);
    expect(result.errors).toEqual(["media/b.svg: no bucket"]);
  });
});
