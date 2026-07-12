import { describe, expect, it } from "vitest";
import { parseMessageContent } from "@/lib/chat/message-content";

describe("parseMessageContent — citations", () => {
  it("strips a citation marker and reports the slug", () => {
    const { segments, citedSlugs } = parseMessageContent(
      "Heat pumps move heat [cite:heat-pump-basics] rather than make it.",
    );
    expect(citedSlugs).toEqual(["heat-pump-basics"]);
    expect(segments).toEqual([{ type: "text", text: "Heat pumps move heat rather than make it." }]);
  });

  it("collapses spaces around a mid-sentence marker and trims a trailing one", () => {
    expect(parseMessageContent("A [cite:x] B").segments[0]).toEqual({ type: "text", text: "A B" });
    expect(parseMessageContent("Done [cite:x]").segments[0]).toEqual({
      type: "text",
      text: "Done",
    });
    expect(parseMessageContent("End.[cite:x]").segments[0]).toEqual({ type: "text", text: "End." });
  });

  it("de-duplicates repeated citations, first-seen order", () => {
    const { citedSlugs } = parseMessageContent("One [cite:a] two [cite:b] three [cite:a].");
    expect(citedSlugs).toEqual(["a", "b"]);
  });

  it("returns no citations for plain prose", () => {
    const { segments, citedSlugs } = parseMessageContent("Just a normal answer.");
    expect(citedSlugs).toEqual([]);
    expect(segments).toEqual([{ type: "text", text: "Just a normal answer." }]);
  });
});

describe("parseMessageContent — figures", () => {
  it("splits a block figure out of the surrounding prose", () => {
    const { segments } = parseMessageContent(
      "Here is the cycle:\n[figure:heat-pump-cycle-diagram]\nNotice the reversing valve.",
    );
    expect(segments).toEqual([
      { type: "text", text: "Here is the cycle:" },
      { type: "figure", slug: "heat-pump-cycle-diagram" },
      { type: "text", text: "Notice the reversing valve." },
    ]);
  });

  it("handles a figure with no surrounding text", () => {
    expect(parseMessageContent("[figure:diagram-one]").segments).toEqual([
      { type: "figure", slug: "diagram-one" },
    ]);
  });

  it("keeps citations and figures together in order", () => {
    const { segments, citedSlugs } = parseMessageContent(
      "Intro [cite:a].\n[figure:fig-a]\nMore [cite:b].",
    );
    expect(citedSlugs).toEqual(["a", "b"]);
    expect(segments).toEqual([
      { type: "text", text: "Intro." },
      { type: "figure", slug: "fig-a" },
      { type: "text", text: "More." },
    ]);
  });
});

describe("parseMessageContent — streaming safety", () => {
  it("hides a citation marker that is still being typed at the end", () => {
    expect(parseMessageContent("Heat pumps [cite:heat-pu").segments).toEqual([
      { type: "text", text: "Heat pumps" },
    ]);
    expect(parseMessageContent("Heat pumps [cite").segments).toEqual([
      { type: "text", text: "Heat pumps" },
    ]);
  });

  it("hides an incomplete trailing figure marker", () => {
    expect(parseMessageContent("See:\n[figure:hea").segments).toEqual([
      { type: "text", text: "See:" },
    ]);
  });

  it("does not treat a completed marker as dangling", () => {
    const { citedSlugs } = parseMessageContent("Fact [cite:x] and then more prose");
    expect(citedSlugs).toEqual(["x"]);
  });

  it("leaves a stray earlier bracket as ordinary prose", () => {
    const { segments } = parseMessageContent("An array like a[0] is fine.");
    expect(segments).toEqual([{ type: "text", text: "An array like a[0] is fine." }]);
  });
});
