import { describe, expect, it } from "vitest";
import { FrontmatterError, splitFrontmatter } from "@/lib/content/frontmatter";

describe("splitFrontmatter", () => {
  it("splits YAML frontmatter from the markdown body", () => {
    const { data, body } = splitFrontmatter("---\ntitle: Hi\nversion: 1\n---\n\n# Body\n\ntext\n");
    expect(data).toEqual({ title: "Hi", version: 1 });
    expect(body).toBe("# Body\n\ntext");
  });

  it("tolerates a BOM and leading blank lines before the opening fence", () => {
    const { data, body } = splitFrontmatter("﻿\n\n---\nslug: a\n---\nbody\n");
    expect(data).toEqual({ slug: "a" });
    expect(body).toBe("body");
  });

  it("treats empty frontmatter as an empty mapping", () => {
    const { data, body } = splitFrontmatter("---\n---\nbody only\n");
    expect(data).toEqual({});
    expect(body).toBe("body only");
  });

  it("throws when the opening fence is missing", () => {
    expect(() => splitFrontmatter("# just markdown\n")).toThrow(FrontmatterError);
  });

  it("throws when the closing fence is missing", () => {
    expect(() => splitFrontmatter("---\ntitle: x\nno close\n")).toThrow(/closing/);
  });

  it("throws on invalid YAML", () => {
    expect(() => splitFrontmatter("---\n: : :\n---\nbody\n")).toThrow(FrontmatterError);
  });

  it("throws when frontmatter is a sequence, not a mapping", () => {
    expect(() => splitFrontmatter("---\n- a\n- b\n---\nbody\n")).toThrow(/mapping/);
  });
});
