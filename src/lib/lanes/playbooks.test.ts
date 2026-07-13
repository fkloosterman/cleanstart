import { describe, expect, it } from "vitest";
import {
  DIMENSION_BY_LANE,
  LANE_BY_DIMENSION,
  LANE_IDS,
  LANE_PLAYBOOKS,
  type FramingId,
  type ReportSectionId,
} from "@/lib/lanes/playbooks";
import { MOTIVATION_DIMENSIONS, SLOT_NAMES } from "@/lib/profile/registry";

const REPORT_SECTION_IDS: ReportSectionId[] = [
  "about_you",
  "your_goals",
  "background",
  "action_plan",
  "open_questions",
  "sources",
];

describe("LANE_PLAYBOOKS (§5.2)", () => {
  it("declares the five lanes plus the mixed fallback", () => {
    expect(Object.keys(LANE_PLAYBOOKS).sort()).toEqual(
      ["lower_bills", "climate_impact", "comfort_health", "resilience", "learning", "mixed"].sort(),
    );
    expect(LANE_IDS).not.toContain("mixed" as FramingId); // mixed is framing-only
  });

  it("keys each playbook by its own id", () => {
    for (const [key, playbook] of Object.entries(LANE_PLAYBOOKS)) {
      expect(playbook.id).toBe(key);
    }
  });

  it("references only real slots in requirements and priority questions", () => {
    for (const playbook of Object.values(LANE_PLAYBOOKS)) {
      for (const slot of [...playbook.required_slots, ...playbook.priority_questions]) {
        expect(SLOT_NAMES, `${playbook.id}: ${slot}`).toContain(slot);
      }
      expect(playbook.required_slots).toContain("motivation_weights");
    }
  });

  it("gives every playbook a full impact-weight vector", () => {
    for (const playbook of Object.values(LANE_PLAYBOOKS)) {
      for (const dim of MOTIVATION_DIMENSIONS) {
        expect(typeof playbook.impact_weights[dim], `${playbook.id}.${dim}`).toBe("number");
      }
    }
  });

  it("orders every report section exactly once per playbook", () => {
    for (const playbook of Object.values(LANE_PLAYBOOKS)) {
      const ids = playbook.report_sections.map((s) => s.id);
      expect(ids.sort(), playbook.id).toEqual([...REPORT_SECTION_IDS].sort());
    }
  });

  it("relaxes the learning gate and makes background its centerpiece (§5.2)", () => {
    const learning = LANE_PLAYBOOKS.learning;
    expect(learning.required_slots).toEqual(["motivation_weights"]);
    const background = learning.report_sections.find((s) => s.id === "background");
    expect(background?.emphasis).toBe("full");
  });
});

describe("lane ↔ dimension mapping", () => {
  it("covers every motivation dimension with a lane", () => {
    for (const dim of MOTIVATION_DIMENSIONS) {
      expect(LANE_BY_DIMENSION[dim]).toBeDefined();
    }
  });

  it("is a bijection: LANE_BY_DIMENSION and DIMENSION_BY_LANE invert each other", () => {
    for (const dim of MOTIVATION_DIMENSIONS) {
      expect(DIMENSION_BY_LANE[LANE_BY_DIMENSION[dim]]).toBe(dim);
    }
    for (const lane of LANE_IDS) {
      expect(LANE_BY_DIMENSION[DIMENSION_BY_LANE[lane]]).toBe(lane);
    }
  });
});
