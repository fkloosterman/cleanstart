/**
 * Context builder (WP2.2, design §5.3) — the pure assembly of the chat
 * system prompt from the session profile, the derived lane, the
 * conversation stage, and (from WP3.4) retrieved library content.
 *
 * This replaces `buildSystemPrompt` and its persona/turn-count logic. The
 * agent's understanding of the user is no longer a `persona` enum plus a
 * message counter; it is the structured profile (WP1.1) and the lane
 * derived from the user's motivation vector (WP2.1). Because it is pure, it
 * is snapshot-tested: the assembled prompt is pinned for representative
 * profiles so a wording change is a visible diff, not a silent drift.
 *
 * `retrieved` is plumbed through but empty until WP3.4 wires retrieval in;
 * when present it becomes the grounding block ("cite only these").
 */

import {
  laneReadinessRequirements,
  mergedPriorityQuestions,
  type LaneDerivation,
} from "@/lib/lanes/derive";
import { LANE_PLAYBOOKS, type FramingId } from "@/lib/lanes/playbooks";
import { slotFilled } from "@/lib/profile/normalize";
import { readiness } from "@/lib/profile/readiness";
import { SLOT_REGISTRY, type SessionProfile, type SlotName } from "@/lib/profile/registry";
import { buildSidebarModel, type SidebarField } from "@/lib/profile/sidebar";

// ---------------------------------------------------------------------------
// Base voice + fixed policy blocks

const BASE = `You are Clean Start — a calm, plain-language guide that helps households understand clean energy options (solar, heat pumps, EVs, home efficiency upgrades).

Voice:
- Warm, patient, never preachy. No jargon without explaining it.
- No vendor pitches, no "act now" pressure, no political framing.
- When the user is unsure, offer choices, not directives.
- Use short paragraphs and the occasional bulleted list. Render lightly with markdown.

Boundaries:
- You teach and orient. You do not quote prices, recommend specific contractors, or hand out tax advice.
- If asked something outside clean energy for households, gently redirect.
- Always assume the user is smart but new to the topic.`;

/**
 * The brevity policy (§5.3). Kept as a fixed block: the conversation must
 * stand on its own — the report earns the *organization* of what was said,
 * never exclusive access to the substance.
 */
const BREVITY = `How to answer:
- Answer briefly and genuinely — a few short paragraphs at most, not an essay.
- End with a fork: offer the deeper version now, or to note the thread for their report.
- When the user pushes for more, always go deep. Never say "I'll cover that in the report" as a way to withhold — that reads as stalling. The report organizes the substance; it does not gatekeep it.`;

// ---------------------------------------------------------------------------
// Lane + stage copy

/** Human names for the lanes and the mixed framing (prompt-facing). */
const LANE_LABELS: Record<FramingId, string> = {
  lower_bills: "lowering their bills",
  climate_impact: "reducing their climate footprint",
  comfort_health: "a more comfortable, healthier home",
  resilience: "resilience when the grid fails",
  learning: "understanding the space",
  mixed: "two goals at once",
};

export type ConversationStage = "discovery" | "deepening" | "synthesis";

const STAGE_NOTES: Record<ConversationStage, string> = {
  discovery:
    "Stage: the conversation is just starting. Learn a little before explaining — one or two friendly questions, and reflect back what you heard.",
  deepening:
    "Stage: you have some context. Explain the one or two most relevant options in plain language, each with a short how-it-works and an honest tradeoff.",
  synthesis:
    "Stage: enough is known to help them act. Start drawing the threads together, and when the user is ready, offer to generate their personalized report.",
};

/**
 * Derive the conversation stage from information sufficiency, not turn
 * count (the WP1.7 shift). Discovery until something is known; synthesis
 * once the report gate is reachable (or already ratcheted open, passed via
 * `reportGateOpen`); deepening in between.
 */
export function deriveStage(
  profile: SessionProfile,
  framing: FramingId,
  opts: { reportGateOpen?: boolean } = {},
): ConversationStage {
  const { score, ready } = readiness(profile, laneReadinessRequirements(framing));
  if (ready || opts.reportGateOpen) return "synthesis";
  return score === 0 ? "discovery" : "deepening";
}

// ---------------------------------------------------------------------------
// Retrieved library content (WP3.4 fills this; empty until then)

export interface RetrievedComponent {
  slug: string;
  title: string;
  /** 2–3 sentence summary injected into context (never the full body). */
  summary: string;
  sources?: { label: string; publisher: string }[];
}

// ---------------------------------------------------------------------------
// Section builders (each returns null when it has nothing to add)

/** Render a filled sidebar field's value as one line of text, or null. */
function formatFieldValue(field: SidebarField): string | null {
  if (!field.value) return null;
  switch (field.value.type) {
    case "scalar":
      return field.value.text;
    case "list":
      return field.value.items.join("; ");
    case "stances":
      return field.value.groups
        .map(
          (g) =>
            `${g.label}: ${g.entries
              .map((e) => (e.note ? `${e.label} (${e.note})` : e.label))
              .join(", ")}`,
        )
        .join("; ");
  }
}

/**
 * The "what you already know" block: filled slots, grouped as the sidebar
 * groups them, rendered with the sidebar's own value formatting so chat and
 * the profile panel never disagree. Known facts are marked established so
 * the agent does not re-ask them — the guarantee the old guest hard-facts
 * block enforced, now uniform across guest and signed-in.
 */
function profileSummary(profile: SessionProfile): string | null {
  const lines: string[] = [];
  for (const group of buildSidebarModel(profile)) {
    const groupLines: string[] = [];
    for (const field of group.fields) {
      const text = field.filled ? formatFieldValue(field) : null;
      if (text) groupLines.push(`- ${field.label}: ${text}`);
    }
    if (groupLines.length > 0) lines.push(`${group.label}:`, ...groupLines);
  }
  if (lines.length === 0) return null;
  return `What you already know about this household (established — do not ask again):\n${lines.join("\n")}`;
}

/** Name what the user cares about and steer the voice for it (§5.1, §5.3). */
function framingBlock(lane: LaneDerivation): string {
  const tone = LANE_PLAYBOOKS[lane.framing].tone;
  if (lane.mixed && lane.secondary) {
    return `What this user cares about: ${LANE_LABELS[lane.primary]} AND ${LANE_LABELS[lane.secondary]} — name both, and don't force a single frame. ${tone}`;
  }
  return `What this user cares about most: ${LANE_LABELS[lane.framing]}. ${tone}`;
}

/**
 * What to learn next (§5.3 "still need to learn"): the report-gating gaps
 * first, then the lane's probe order (merged across the top two lanes).
 * Anything already filled or already asked is skipped, so the agent never
 * nags (§4.1).
 */
function stillToLearn(profile: SessionProfile, lane: LaneDerivation): string | null {
  const { missing } = readiness(profile, laneReadinessRequirements(lane.framing));
  const gate = new Set<SlotName>(missing);

  const ordered: SlotName[] = [];
  for (const name of [...missing, ...mergedPriorityQuestions(lane)]) {
    if (ordered.includes(name)) continue;
    const slot = profile[name];
    if (slotFilled(slot) || slot.asked_at) continue;
    ordered.push(name);
  }
  if (ordered.length === 0) return null;

  const items = ordered.map((name) => {
    const label = SLOT_REGISTRY[name].sidebar.label;
    return gate.has(name) ? `- ${label} (needed before the report)` : `- ${label}`;
  });
  return `Still to learn — weave these in naturally, one at a time, never as an interrogation:\n${items.join("\n")}`;
}

/** Curated summaries the agent may cite (WP3.4); empty → omitted. */
function groundingBlock(retrieved: RetrievedComponent[]): string | null {
  if (retrieved.length === 0) return null;
  const entries = retrieved.map((c) => {
    const cites = c.sources?.length
      ? ` [sources: ${c.sources.map((s) => `${s.label} — ${s.publisher}`).join("; ")}]`
      : "";
    return `- ${c.title}: ${c.summary}${cites}`;
  });
  return `Grounding — draw factual claims only from these curated summaries, and cite them when you use them:\n${entries.join("\n")}`;
}

// ---------------------------------------------------------------------------
// The builder

export interface BuildContextInput {
  profile: SessionProfile;
  lane: LaneDerivation;
  stage: ConversationStage;
  /** Retrieved library summaries (WP3.4); empty until then. */
  retrieved?: RetrievedComponent[];
}

/** The named pieces the prompt is assembled from (drives the dev inspector). */
export type ContextSectionId =
  | "base"
  | "profile"
  | "framing"
  | "stage"
  | "grounding"
  | "still_to_learn"
  | "brevity";

export interface ContextSection {
  id: ContextSectionId;
  /** Human label for the piece (shown in the prompt inspector). */
  label: string;
  text: string;
}

const SECTION_LABELS: Record<ContextSectionId, string> = {
  base: "Voice & boundaries",
  profile: "What you already know",
  framing: "Motivation & lane",
  stage: "Stage",
  grounding: "Grounding (retrieved)",
  still_to_learn: "Still to learn",
  brevity: "How to answer",
};

/**
 * Assemble the prompt as an ordered list of labeled sections (§5.3): base
 * voice → what we know → what they care about (lane) → stage → grounding →
 * what to learn next → brevity policy. Sections with nothing to say are
 * omitted. `buildContext` joins these into the final string; the dev prompt
 * inspector renders them individually, so the two never diverge.
 */
export function buildContextSections({
  profile,
  lane,
  stage,
  retrieved = [],
}: BuildContextInput): ContextSection[] {
  const raw: [ContextSectionId, string | null][] = [
    ["base", BASE],
    ["profile", profileSummary(profile)],
    ["framing", framingBlock(lane)],
    ["stage", STAGE_NOTES[stage]],
    ["grounding", groundingBlock(retrieved)],
    ["still_to_learn", stillToLearn(profile, lane)],
    ["brevity", BREVITY],
  ];
  const sections: ContextSection[] = [];
  for (const [id, text] of raw) {
    if (text) sections.push({ id, label: SECTION_LABELS[id], text });
  }
  return sections;
}

/** The assembled chat system prompt — the joined section texts. */
export function buildContext(input: BuildContextInput): string {
  return buildContextSections(input)
    .map((s) => s.text)
    .join("\n\n");
}
