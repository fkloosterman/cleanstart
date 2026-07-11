import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateContent } from "@/lib/content/validate";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const VOCAB = "technologies:\n  - heat-pump\n  - solar\nhousing_types:\n  - single-family\n";

const componentMd = (frontmatter: string, body = "## Body\n\nReal content here.") =>
  `---\n${frontmatter}\n---\n\n${body}\n`;

const baseComponent = `slug: heat-pump-basics
kind: explainer
title: Heat pump basics
summary: It moves heat.
technologies:
  - heat-pump
lanes:
  - lower_bills
tenures:
  - owner
housing_types:
  - single-family
regions:
  - US
effort: trivial
impact:
  cost: 1
  carbon: 2
  comfort: 3
  resilience: 0
last_verified: 2026-07-11
status: draft
version: 1`;

describe("validateContent", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "content-test-"));
    writeFileSync(join(dir, "vocabulary.yaml"), VOCAB);
    for (const sub of ["components", "media", "presets", "sources"]) {
      mkdirSync(join(dir, sub), { recursive: true });
    }
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (rel: string, contents: string) => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  };

  const run = () => validateContent(dir, join(dir, "vocabulary.yaml"));
  const messages = () => run().issues.map((i) => i.message);

  it("passes a coherent corpus", () => {
    write("components/heat-pump-basics.md", componentMd(baseComponent));
    const result = run();
    expect(result.ok).toBe(true);
    expect(result.content.components).toHaveLength(1);
  });

  it("flags an unknown technology tag", () => {
    write(
      "components/heat-pump-basics.md",
      componentMd(baseComponent.replace("- heat-pump", "- unicorn-power")),
    );
    expect(messages().some((m) => m.includes('unknown technology tag "unicorn-power"'))).toBe(true);
  });

  it("flags an unresolved prerequisite slug", () => {
    write(
      "components/heat-pump-basics.md",
      componentMd(`${baseComponent}\nprerequisites:\n  - ghost`),
    );
    expect(
      messages().some((m) => m.includes('prerequisites references unknown slug "ghost"')),
    ).toBe(true);
  });

  it("flags an unresolved source and media reference", () => {
    write(
      "components/heat-pump-basics.md",
      componentMd(`${baseComponent}\nsources:\n  - no-source\nmedia:\n  - no-media`),
    );
    const m = messages();
    expect(m.some((x) => x.includes('sources references unknown slug "no-source"'))).toBe(true);
    expect(m.some((x) => x.includes('media references unknown slug "no-media"'))).toBe(true);
  });

  it("resolves references that exist", () => {
    write(
      "components/heat-pump-basics.md",
      componentMd(`${baseComponent}\nsources:\n  - s1\nmedia:\n  - m1`),
    );
    write(
      "sources/s1.yaml",
      "slug: s1\nlabel: L\nurl: https://x.gov\npublisher: P\nlast_verified: 2026-07-11\n",
    );
    write(
      "media/m1.yaml",
      "slug: m1\nkind: diagram\nstorage_path: media/m1.svg\nalt: A\ncredit:\n  source: N\n  license: CC0\n",
    );
    expect(run().ok).toBe(true);
  });

  it("requires media alt text", () => {
    write(
      "media/m1.yaml",
      "slug: m1\nkind: diagram\nstorage_path: media/m1.svg\nalt: '  '\ncredit:\n  source: N\n  license: CC0\n",
    );
    expect(messages().some((m) => m.includes("alt text is required"))).toBe(true);
  });

  it("flags duplicate slugs", () => {
    write("components/a.md", componentMd(baseComponent));
    write("components/b.md", componentMd(baseComponent));
    expect(messages().some((m) => m.includes('duplicate component slug "heat-pump-basics"'))).toBe(
      true,
    );
  });

  it("flags a component listing itself as a prerequisite", () => {
    write(
      "components/heat-pump-basics.md",
      componentMd(`${baseComponent}\nprerequisites:\n  - heat-pump-basics`),
    );
    expect(messages().some((m) => m.includes("lists itself as a prerequisite"))).toBe(true);
  });

  it("detects a prerequisite cycle", () => {
    write(
      "components/a.md",
      componentMd(baseComponent.replace("heat-pump-basics", "a") + "\nprerequisites:\n  - b"),
    );
    write(
      "components/b.md",
      componentMd(baseComponent.replace("heat-pump-basics", "b") + "\nprerequisites:\n  - a"),
    );
    expect(messages().some((m) => m.includes("prerequisite cycle"))).toBe(true);
  });

  it("rejects an invalid preset patch via the real apply pipeline", () => {
    write(
      "presets/bad.yaml",
      "slug: bad\nlabel: L\ncategory: C\nfirst_message: hi\nprofile_patches:\n  - op: set\n    slot: not_a_slot\n    provenance: stated\n    value: 1\n",
    );
    expect(messages().some((m) => m.includes("profile_patch rejected"))).toBe(true);
  });

  it("accepts a valid preset patch", () => {
    write(
      "presets/good.yaml",
      "slug: good\nlabel: L\ncategory: C\nfirst_message: hi\nprofile_patches:\n  - op: set\n    slot: timeline\n    provenance: stated\n    value: exploring\n",
    );
    expect(run().ok).toBe(true);
  });

  it("reports a component missing its frontmatter fences", () => {
    write("components/broken.md", "# no frontmatter\n");
    expect(messages().some((m) => m.includes("missing opening '---'"))).toBe(true);
  });

  it("reports invalid YAML in a media file", () => {
    write("media/broken.yaml", ": : :\n");
    expect(run().ok).toBe(false);
  });

  it("reports unknown fields (strict schema)", () => {
    write("components/x.md", componentMd(`${baseComponent}\nbogus_field: 1`));
    expect(
      messages().some((m) => m.includes("Unrecognized key") || m.includes("bogus_field")),
    ).toBe(true);
  });
});

describe("shipped content/", () => {
  it("validates against the real vocabulary", () => {
    const contentDir = join(REPO_ROOT, "content");
    const result = validateContent(contentDir, join(contentDir, "vocabulary.yaml"));
    if (!result.ok) console.error(result.issues);
    expect(result.ok).toBe(true);
  });
});
