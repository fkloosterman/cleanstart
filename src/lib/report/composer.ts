/**
 * The report composer (WP3.6, design §6). Pure module: it owns the composer
 * *contract* — the prompt the model sees, the shape it must return, the
 * validation pipeline that makes a weak model's output safe, the deterministic
 * fallback, and the assembly of the validated selection into a `ReportDocument`
 * (§7.1). The server wiring (`composer.server.ts`) only supplies the model call
 * and the content library; everything decidable without a network or a database
 * lives here so it is unit-tested exhaustively.
 *
 * The seam where profile, lanes, and library meet is also where free-model
 * reliability risk concentrates, so the rules are strict on both sides
 * (design §6):
 *
 *   Before the model runs, code has already filtered and scored the library
 *   (WP3.3) — the model receives a small, pre-vetted shortlist and *cannot*
 *   recommend outside it. A bad model day yields a mediocre ordering, never a
 *   wrong fact.
 *
 *   After the model runs, the validation pipeline (§6.3) parses the output,
 *   drops any item whose slug isn't a candidate, drops authored items outside
 *   the sanctioned topics, lints personalization for invented numbers/URLs,
 *   and — when too little survives — retries once (server) then falls back to a
 *   deterministic top-scored selection. Report generation never hard-fails.
 *
 * Unlike the extractor (WP1.4), which re-runs every turn and so needs no retry,
 * the composer is a one-shot generation: a skipped report doesn't self-heal, so
 * retry→fallback is the reliability story here.
 *
 * Hybrid mode (D20, §6.6) is one extension, not a second path: an item with
 * `component_slug: null` is *authored*, permitted only for topics whose
 * candidate pool is thin — decided by `authoringAllowedTopics` in code, not by
 * the model — capped per report, and rendered with the "not yet reviewed" tag.
 * The end state is zero authored items, at which point the mode is deleted.
 */

import { z } from "zod";
import type { ContentComponent, ContentSource } from "@/lib/content/schema";
import type { ScoredCandidate, CandidateContext } from "@/lib/content/candidates";
import { laneReadinessRequirements, type LaneDerivation } from "@/lib/lanes/derive";
import { LANE_PLAYBOOKS, type FramingId } from "@/lib/lanes/playbooks";
import { readiness } from "@/lib/profile/readiness";
import { slotValue } from "@/lib/profile/normalize";
import type { SessionProfile } from "@/lib/profile/registry";
import {
  DOC_VERSION,
  type ActionItem,
  type BackgroundEntry,
  type ContentOrigin,
  type ReportDocument,
  type SourceCitation,
} from "@/lib/report/document";

// ---------------------------------------------------------------------------
// Tuning constants (placeholder-quality, like the scoring knobs in WP3.3)

/** How many action items render up front; the rest are held back (§6.2, seam 1). */
export const REVEALED_ITEM_COUNT = 3;

/**
 * The most authored (component_slug: null) items a single report may carry
 * (§6.6). A cap, not a target — the whole point of hybrid mode is that this
 * number trends to zero as the corpus fills. Authored items beyond the cap are
 * dropped in validation, lowest-ranked first.
 */
export const AUTHORED_ITEM_CAP = 2;

/**
 * A technology the user is interested in whose eligible candidate pool is at or
 * below this size is "thin" — authoring is sanctioned for it (§6.6). Placeholder
 * until D9's thresholds are set from the WP3.3b coverage tool.
 */
export const THIN_TOPIC_THRESHOLD = 1;

/**
 * The action-plan size a healthy report aims for. When the model returns fewer
 * *viable* items than `min(this, candidates available)`, it has dropped items it
 * shouldn't have, so the server retries; a genuinely thin corpus simply yields
 * fewer and does not loop. (§6.3 step 5.)
 */
export const MIN_VIABLE_ITEMS = 3;

/** How many explainer components the `background` section freezes, by emphasis (§7.1). */
const BACKGROUND_CAP: Record<"full" | "standard" | "collapsed", number> = {
  full: 4,
  standard: 2,
  collapsed: 1,
};

/** Explainer kinds are what the background section is built from; the rest are actions. */
const EXPLAINER_KINDS = new Set<ContentComponent["kind"]>(["explainer"]);

// ---------------------------------------------------------------------------
// Composer input (assembled by code, design §6.1)

/**
 * The trimmed, model-facing view of a candidate: slug + title + summary +
 * ranking signals only, never the full body (§6.1). The body is spent later, in
 * the frozen document and follow-up sessions — not in the selection prompt.
 */
export interface ComposerCandidate {
  slug: string;
  title: string;
  summary: string;
  kind: ContentComponent["kind"];
  effort: ContentComponent["effort"];
  technologies: string[];
}

/** Project a scored candidate down to the model-facing view. */
export function toComposerCandidate({ component }: ScoredCandidate): ComposerCandidate {
  return {
    slug: component.slug,
    title: component.title,
    summary: component.summary,
    kind: component.kind,
    effort: component.effort,
    technologies: component.technologies,
  };
}

export interface ComposerInput {
  profile: SessionProfile;
  /** Derived lane/framing (WP2.1) — sets the narrative and the readiness gate. */
  derivation: LaneDerivation;
  /** The pre-vetted shortlist the model must select from (§6.1). */
  candidates: ComposerCandidate[];
  /** 5–10 bullets distilled from the conversation, not the raw transcript (§6.1). */
  conversationDigest: string;
  /**
   * Technology tags whose candidate pool is thin for this profile — the only
   * topics the model may author outside the library (§6.6). Empty means
   * library-only.
   */
  authoringAllowedFor: string[];
}

// ---------------------------------------------------------------------------
// Model output schema (design §6.2)
//
// Permissive on purpose (like WP1.4's patch shape): a weak model's near-misses
// should reach the validation pipeline, which drops precisely what's wrong,
// rather than being rejected wholesale by a strict Zod parse. `origin` is NOT a
// model field — it is derived from whether `component_slug` is null, so the
// model can't mislabel an item's provenance.

export const composerItemSchema = z.object({
  /** A candidate slug, or null for an authored item (§6.6). */
  component_slug: z.string().nullable().optional(),
  /** Title for authored items; ignored for library items (resolved from the component). */
  title: z.string().optional(),
  /** For authored items: the technology tag it addresses, checked against the sanction. */
  topic: z.string().optional(),
  rank: z.number().optional(),
  reveal: z.boolean().optional(),
  personalization: z.string().optional(),
});

export const composerOutputSchema = z.object({
  headline: z.string(),
  intro: z.string(),
  items: z.array(composerItemSchema).default([]),
  profile_gaps: z.array(z.string()).default([]),
  readiness_note: z.string().default(""),
});

export type ComposerRawOutput = z.infer<typeof composerOutputSchema>;

// ---------------------------------------------------------------------------
// Prompt construction (pure)

const RULES = `RULES:
- Recommend ONLY items from the CANDIDATES list, by their exact slug. You may not invent a slug.
- personalization explains why THIS household should care — 1–2 sentences. It must add NO new facts: no dollar amounts, no percentages, no URLs, no vendor names, no tax figures. The facts live in the library; you only connect them to this user.
- No vendor names, no specific prices, no tax advice, anywhere in the output.
- Order items best-first with "rank" (1 = best). Set "reveal": true on the top few; the rest are held back and revealed later.
- headline + intro are 2–3 warm, plain-language sentences naming what this household is trying to do. Honest about tradeoffs, never pushy.
- profile_gaps: the few things still worth learning to sharpen the plan (each a short question).
- readiness_note: one honest sentence on where this household is (just exploring → ready to act).`;

function authoringRules(input: ComposerInput): string {
  if (input.authoringAllowedFor.length === 0) {
    return `AUTHORING: Not permitted for this report — every item MUST reference a candidate slug. Set "component_slug" on every item.`;
  }
  return `AUTHORING (limited): The library is thin on these topics: ${input.authoringAllowedFor.join(", ")}. For THOSE topics only, you MAY add up to ${AUTHORED_ITEM_CAP} authored item(s) with "component_slug": null, a "title", and a "topic" set to one of those tags. Authored items obey every rule above (no prices, no vendors, no invented numbers). For any other topic you MUST use a candidate slug.`;
}

/** The composer system prompt — the fixed contract and voice (§6). */
export function buildComposerSystem(): string {
  return `You are Clean Start's report composer. You turn a household's profile and a vetted shortlist of clean-energy content into a calm, personalized action plan. You SELECT and personalize; you do not author facts.

${RULES}

Return ONLY a JSON object (no markdown, no commentary) of this shape:
{
  "headline": string,
  "intro": string,
  "items": [
    { "component_slug": string | null, "title"?: string, "topic"?: string, "rank": number, "reveal": boolean, "personalization": string }
  ],
  "profile_gaps": [string],
  "readiness_note": string
}`;
}

/** A compact, model-facing view of what's known about the household. */
function profileDigest(profile: SessionProfile): string {
  const lines: string[] = [];
  const tenure = slotValue(profile, "tenure");
  if (tenure) lines.push(`- tenure: ${tenure}`);
  const region = slotValue(profile, "region");
  if (region) {
    const parts = [region.city, region.state].filter(Boolean).join(", ");
    if (parts) lines.push(`- region: ${parts}`);
  }
  const goals = slotValue(profile, "goals");
  if (goals?.length) lines.push(`- goals: ${goals.map((g) => g.text).join("; ")}`);
  const constraints = slotValue(profile, "constraints");
  if (constraints?.length)
    lines.push(`- constraints: ${constraints.map((c) => c.text).join("; ")}`);
  const topics = slotValue(profile, "topics_discussed");
  if (topics?.length) lines.push(`- topics discussed: ${topics.join(", ")}`);
  return lines.length > 0 ? lines.join("\n") : "(little known yet)";
}

/** Render a candidate for the prompt: slug, kind, effort, techs, summary. */
function candidateLine(c: ComposerCandidate): string {
  const techs = c.technologies.length ? ` [${c.technologies.join(", ")}]` : "";
  return `- ${c.slug} (${c.kind}, ${c.effort})${techs}: ${c.title} — ${c.summary}`;
}

/** The composer user prompt: framing + profile + digest + candidates + authoring scope. */
export function buildComposerPrompt(input: ComposerInput): string {
  const { derivation } = input;
  const playbook = LANE_PLAYBOOKS[derivation.framing];
  const framingLine = derivation.mixed
    ? `FRAMING: mixed — name both ${derivation.primary} and ${derivation.secondary ?? "the runner-up"}; organize around technologies, not one goal. ${playbook.tone}`
    : `FRAMING: ${derivation.framing}. ${playbook.tone}`;

  const candidates =
    input.candidates.length > 0
      ? input.candidates.map(candidateLine).join("\n")
      : "(none — the library has nothing eligible for this household yet)";

  return [
    framingLine,
    "",
    "HOUSEHOLD PROFILE:",
    profileDigest(input.profile),
    "",
    "CONVERSATION HIGHLIGHTS:",
    input.conversationDigest || "(none)",
    "",
    "CANDIDATES (select and rank from these; use the exact slug):",
    candidates,
    "",
    authoringRules(input),
    "",
    "Compose the report now as JSON.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Output parsing (pure, tolerant)

/**
 * Pull the JSON object out of a model response, tolerating code fences and
 * surrounding prose. Returns null when nothing parseable is found — a parse
 * failure must never throw into the report path; the caller falls back.
 */
export function parseComposerJson(text: string): unknown {
  if (typeof text !== "string") return null;
  let body = text.trim();

  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) body = fence[1].trim();

  if (!body.startsWith("{")) {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    body = body.slice(start, end + 1);
  }

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Personalization lint (design §6.3 step 4)

/**
 * Personalization strings connect library facts to the user; they must not
 * introduce *new* facts. This is a cheap regex proxy for that rule: reject a
 * dollar amount, a percentage, or a URL. It's intentionally blunt — a false
 * positive costs one item its personalization (the item is dropped, creating
 * retry pressure), never a wrong number reaching the user.
 */
const DOLLAR = /\$\s?\d/;
const PERCENT = /\d\s?%|\bpercent\b/i;
const URL = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|org|gov|net|io)\b/i;

export function personalizationClean(text: string): boolean {
  return !DOLLAR.test(text) && !PERCENT.test(text) && !URL.test(text);
}

// ---------------------------------------------------------------------------
// Validation pipeline (design §6.3)

/** A validated, safe-to-render item: library slug resolved, or authored. */
export interface ValidatedItem {
  component_slug: string | null;
  origin: ContentOrigin;
  /** Set for authored items (model title); null for library items (resolved at assembly). */
  authoredTitle: string | null;
  personalization: string;
  revealed: boolean;
}

export interface ValidatedComposition {
  headline: string;
  intro: string;
  items: ValidatedItem[];
  openQuestions: string[];
  readinessNote: string;
  /** Human-readable reasons items were dropped — appended to a retry and logged. */
  errors: string[];
}

function itemRank(item: z.infer<typeof composerItemSchema>, index: number): number {
  return typeof item.rank === "number" && Number.isFinite(item.rank) ? item.rank : index;
}

/**
 * Run the validation pipeline over a parsed model output (§6.3):
 *  1. slug whitelist — a non-candidate library slug is dropped (logged);
 *  2. authoring sanction — an authored item without a sanctioned topic is
 *     dropped; authored items are capped;
 *  3. personalization lint — an item with an invented number/URL is dropped;
 *  4. dedupe by slug, order by rank, and set `revealed` on the top few.
 *
 * Figure params (§6.3 step 3) are not validated here: figure templates land in
 * WP3.8, so no template registry exists yet and any figure is simply ignored.
 *
 * Returns the survivors plus the drop reasons; the server decides on retry vs
 * fallback from `items.length`.
 */
export function validateComposerOutput(
  raw: ComposerRawOutput,
  input: ComposerInput,
): ValidatedComposition {
  const candidateSlugs = new Set(input.candidates.map((c) => c.slug));
  const sanctioned = new Set(input.authoringAllowedFor);
  const errors: string[] = [];

  const ordered = [...raw.items].sort((a, b) => itemRank(a, 0) - itemRank(b, 0));

  const seen = new Set<string>();
  const survivors: ValidatedItem[] = [];
  let authoredCount = 0;

  for (const item of ordered) {
    const slug = item.component_slug ?? null;
    const personalization = (item.personalization ?? "").trim();

    if (slug !== null) {
      // Library item: the slug must be a candidate.
      if (!candidateSlugs.has(slug)) {
        errors.push(`dropped non-candidate slug "${slug}"`);
        continue;
      }
      if (seen.has(slug)) continue; // duplicate — keep the higher-ranked one
      if (!personalizationClean(personalization)) {
        errors.push(`dropped "${slug}": personalization introduced a number or URL`);
        continue;
      }
      seen.add(slug);
      survivors.push({
        component_slug: slug,
        origin: "library",
        authoredTitle: null,
        personalization,
        revealed: false,
      });
    } else {
      // Authored item (§6.6): only for a sanctioned topic, capped, with a title.
      const topic = item.topic?.trim();
      const title = item.title?.trim();
      if (!topic || !sanctioned.has(topic)) {
        errors.push(`dropped authored item (topic "${topic ?? "?"}" not sanctioned)`);
        continue;
      }
      if (!title) {
        errors.push(`dropped authored item on "${topic}": missing title`);
        continue;
      }
      if (authoredCount >= AUTHORED_ITEM_CAP) {
        errors.push(`dropped authored item on "${topic}": over the per-report cap`);
        continue;
      }
      if (!personalizationClean(personalization)) {
        errors.push(
          `dropped authored item on "${topic}": personalization introduced a number or URL`,
        );
        continue;
      }
      authoredCount++;
      survivors.push({
        component_slug: null,
        origin: "authored",
        authoredTitle: title,
        personalization,
        revealed: false,
      });
    }
  }

  // Progressive disclosure is a code decision, not the model's: reveal the top
  // few in final rank order, hold the rest back (§6.2, seam 1).
  survivors.forEach((item, i) => {
    item.revealed = i < REVEALED_ITEM_COUNT;
  });

  return {
    headline: raw.headline.trim(),
    intro: raw.intro.trim(),
    items: survivors,
    openQuestions: raw.profile_gaps.map((q) => q.trim()).filter(Boolean),
    readinessNote: raw.readiness_note.trim(),
    errors,
  };
}

// ---------------------------------------------------------------------------
// Authoring sanction (design §6.6) — code, not the model, decides where authoring is allowed

/**
 * The technology tags the model may author outside the library for this
 * profile: a technology the user is interested in (curious/interested/priority)
 * whose eligible candidate pool is at or below `THIN_TOPIC_THRESHOLD`. Ruled-out
 * technologies are never sanctioned (they were suppressed upstream). This is the
 * "code decides where authoring is permitted" rule (§6.6): the model fills
 * sanctioned gaps only; it can never choose to bypass curated content.
 */
export function authoringAllowedTopics(
  candidates: ComposerCandidate[],
  ctx: CandidateContext,
  threshold: number = THIN_TOPIC_THRESHOLD,
): string[] {
  const poolByTech = new Map<string, number>();
  for (const c of candidates) {
    for (const tech of c.technologies) {
      poolByTech.set(tech, (poolByTech.get(tech) ?? 0) + 1);
    }
  }
  const allowed: string[] = [];
  for (const [tech] of ctx.interests) {
    if (ctx.ruledOutTechs.has(tech)) continue;
    if ((poolByTech.get(tech) ?? 0) <= threshold) allowed.push(tech);
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// Conversation digest (pure) — "5–10 bullets, not the raw transcript" (§6.1)

const DIGEST_MAX_BULLETS = 10;
const DIGEST_MAX_CHARS = 240;

/**
 * A lightweight, deterministic digest: the household's own words carry the
 * signal, so we bullet the most recent user turns, trimmed. Deliberately not an
 * LLM summary — the distilled *state* is already the profile; this is
 * supplementary color, and a second model call isn't worth the latency or the
 * new failure mode. When richer summarization is wanted it slots in here without
 * touching the contract.
 */
export function buildConversationDigest(messages: { role: string; content: string }[]): string {
  const userTurns = messages
    .filter((m) => m.role === "user" && m.content.trim())
    .slice(-DIGEST_MAX_BULLETS);
  return userTurns
    .map((m) => {
      const text = m.content.trim().replace(/\s+/g, " ");
      const clipped = text.length > DIGEST_MAX_CHARS ? `${text.slice(0, DIGEST_MAX_CHARS)}…` : text;
      return `- ${clipped}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Deterministic fallback (design §6.3 step 6)

/**
 * The blander-but-correct report when the model fails twice: the top-scored
 * candidates in score order, each with its own vetted summary as the "why"
 * (trusted library text, so it needn't pass the invented-number lint that
 * guards *model* prose). This retires the old `extractJson` regex-repair path —
 * report generation degrades to a real, grounded selection instead of throwing.
 */
export function deterministicFallback(input: ComposerInput): ValidatedComposition {
  const items: ValidatedItem[] = input.candidates.slice(0, REVEALED_ITEM_COUNT * 2).map((c, i) => ({
    component_slug: c.slug,
    origin: "library" as const,
    authoredTitle: null,
    personalization: c.summary,
    revealed: i < REVEALED_ITEM_COUNT,
  }));

  const framing = LANE_PLAYBOOKS[input.derivation.framing];
  return {
    headline: "Your clean-energy starting points",
    intro:
      "Here's a calm, ordered starting point based on what you've shared so far. Come back to the conversation any time to sharpen it.",
    items,
    openQuestions: [],
    readinessNote: framing.tone,
    errors: ["deterministic fallback used"],
  };
}

// ---------------------------------------------------------------------------
// Document assembly (design §7.1) — deterministic sections + validated selection

/** The library records assembly needs (full components with body_md, and sources). */
export interface AssemblyLibrary {
  components: ContentComponent[];
  sources: ContentSource[];
}

function backgroundEmphasis(framing: FramingId): "full" | "standard" | "collapsed" {
  const spec = LANE_PLAYBOOKS[framing].report_sections.find((s) => s.id === "background");
  return spec?.emphasis ?? "standard";
}

/**
 * Assemble a full `ReportDocument` from the validated composition and the
 * content library (§7.1). Mixed provenance is resolved here, once:
 *  - `meta`, `about_you`, `sources` are deterministic (profile + cited sources);
 *  - `your_goals`, `action_plan`, `open_questions` are the composer's output;
 *  - `background` is a *code* choice — the top explainer candidates, frozen with
 *    their body, capped by the lane's emphasis — never a model choice (§7.1).
 * Library item titles/effort/sources are resolved from the component record, so
 * the model can't rename or re-cite curated content.
 */
export function assembleReportDocument(
  composition: ValidatedComposition,
  input: ComposerInput,
  library: AssemblyLibrary,
  generatedAt: string,
): ReportDocument {
  const componentBySlug = new Map(library.components.map((c) => [c.slug, c]));
  const sourceBySlug = new Map(library.sources.map((s) => [s.slug, s]));
  const framing = input.derivation.framing;

  // Track cited source slugs (from every rendered item + background) so the
  // sources section is exactly their union, deduped, in first-seen order.
  const citedSourceSlugs: string[] = [];
  const noteSources = (slugs: string[]) => {
    for (const slug of slugs) if (!citedSourceSlugs.includes(slug)) citedSourceSlugs.push(slug);
  };

  // action_plan — validated items, library titles/effort/sources resolved.
  const usedSlugs = new Set<string>();
  const actionPlan: ActionItem[] = composition.items.map((item) => {
    if (item.component_slug) {
      const component = componentBySlug.get(item.component_slug);
      usedSlugs.add(item.component_slug);
      if (item.revealed) noteSources(component?.sources ?? []);
      return {
        component_slug: item.component_slug,
        title: component?.title ?? item.component_slug,
        personalization: item.personalization,
        effort: component?.effort,
        origin: "library",
        revealed: item.revealed,
        sources: component?.sources ?? [],
      };
    }
    return {
      component_slug: null,
      title: item.authoredTitle ?? "Something to look into",
      personalization: item.personalization,
      origin: "authored",
      revealed: item.revealed,
      sources: [],
    };
  });

  // background — top explainer candidates not already used as an action item,
  // frozen with their full body, capped by the lane emphasis (§7.1).
  const cap = BACKGROUND_CAP[backgroundEmphasis(framing)];
  const background: BackgroundEntry[] = [];
  for (const candidate of input.candidates) {
    if (background.length >= cap) break;
    const component = componentBySlug.get(candidate.slug);
    if (!component || !EXPLAINER_KINDS.has(component.kind)) continue;
    if (usedSlugs.has(component.slug)) continue;
    background.push({
      component_slug: component.slug,
      title: component.title,
      body_md: component.body_md,
      origin: "library",
      sources: component.sources,
    });
    noteSources(component.sources);
  }

  // sources — the deterministic union, resolved to full citation records so the
  // frozen document renders without a live lookup (§7.1). Unknown slugs drop.
  const sources: SourceCitation[] = citedSourceSlugs
    .map((slug) => sourceBySlug.get(slug))
    .filter((s): s is ContentSource => s !== undefined);

  const { score, ready } = readiness(input.profile, laneReadinessRequirements(framing));

  return {
    meta: {
      doc_version: DOC_VERSION,
      generated_at: generatedAt,
      lane_framing: framing,
      readiness: { score, ready },
    },
    about_you: input.profile,
    your_goals: { headline: composition.headline, intro: composition.intro },
    background,
    action_plan: actionPlan,
    open_questions: composition.openQuestions,
    sources,
  };
}
