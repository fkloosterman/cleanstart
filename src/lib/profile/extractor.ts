/**
 * Profile extractor (WP1.4, design §4.4, §6.5).
 *
 * After a chat turn, a cheap model call receives the current profile and
 * the last exchange and returns patch operations — not a full profile.
 * This module owns the prompt (derived from SLOT_REGISTRY, so new slots
 * are learned automatically), tolerant response parsing, and a strict
 * failure policy:
 *
 *   Extraction failure logs and skips — it never blocks or delays the
 *   chat reply, and a malformed model response can never corrupt a
 *   profile. Every returned patch still flows through `applyPatches`
 *   (WP1.1), which enforces edited-wins and schema validation; this
 *   module additionally refuses to emit `edited`/`propagated`
 *   provenance, which only the user and the propagation flow may set.
 *
 * Parsing is tolerant per-object (see `parsePatchArray`): one corrupt
 * element from a weak model no longer discards a whole turn's patches.
 * There is deliberately **no retry** — extraction runs every turn against
 * the current profile, so a fully-skipped turn self-heals on the next
 * message; a retry would only add latency to the on-stream extraction
 * (contrast the composer, WP3.6, whose one-shot report generation does
 * warrant retry→fallback).
 *
 * The model call is injectable (`GenerateFn`) so the orchestration is
 * unit-testable without a network, and the eval harness can drive the
 * real model through the same entry point.
 */

import { slotFilled } from "@/lib/profile/normalize";
import type { ProfilePatch } from "@/lib/profile/patches";
import {
  MOTIVATION_DIMENSIONS,
  PREFERENCE_ENTITY_NAMESPACES,
  SLOT_NAMES,
  SLOT_REGISTRY,
  type SessionProfile,
  type SlotName,
} from "@/lib/profile/registry";

/** The last conversational turn the extractor reads. */
export interface Exchange {
  /** The user's message (required — extraction is keyed to what they said). */
  user: string;
  /** The assistant's reply, when available — gives the user's words context. */
  assistant?: string;
}

/** Injected model call; returns the model's raw text. */
export type GenerateFn = (args: { system: string; prompt: string }) => Promise<string>;

// ---------------------------------------------------------------------------
// Prompt construction (pure)

function slotLine(name: SlotName): string {
  const def = SLOT_REGISTRY[name];
  const shape = def.kind === "list" ? "list (append entries)" : "single value";
  // z.enum exposes its options; surface them so a weak model stays in-vocabulary.
  const options = (def.schema as { options?: readonly string[] }).options;
  const optionsText = options ? ` — one of: ${options.join(", ")}` : "";
  return `- ${name} (${shape}${def.durable ? ", durable" : ""}): ${def.extractor_hint}${optionsText}`;
}

/** The extractor system prompt, derived from the registry (§4.2). */
export function buildExtractionSystem(): string {
  const slotDocs = SLOT_NAMES.map(slotLine).join("\n");
  return `You maintain a structured profile of a household exploring clean-energy options. Read the latest exchange and output ONLY the profile changes it justifies, as JSON patch operations.

SLOTS you may write:
${slotDocs}

PATCH OPERATIONS — output a JSON array (possibly empty). Each item:
- { "op": "set", "slot": <name>, "value": <value>, "provenance": "stated" | "inferred" }
    Sets a single-value slot, or replaces a whole list. For motivation_weights,
    value is an object with numeric cost/carbon/comfort/resilience/learning (relative, 0-1).
- { "op": "append", "slot": <name>, "value": <entry>, "provenance": "stated" | "inferred" }
    Adds one entry to a list slot. goals/constraints entries are { "text": string }.
    topics_discussed entries are a plain string tag.
    preferences entries are { "entity": "<namespace>:<slug>", "stance": "curious" | "interested" | "priority" | "ruled_out", "provenance": "stated" | "inferred", "note"?: string }.
    preference namespaces: ${PREFERENCE_ENTITY_NAMESPACES.join(", ")} (e.g. tech:solar, approach:diy, financing:loan).
- { "op": "clear", "slot": <name>, "provenance": "stated" }  — only when the user retracts something.

MOTIVATION (motivation_weights) — the vector that drives everything downstream:
- The five weights are ${MOTIVATION_DIMENSIONS.join(", ")}. They are RELATIVE (0-1); "set" the WHOLE vector, giving the strongest driver the highest weight and the rest smaller or zero.
- Move the weights ONLY when the user signals what actually drives them — in words or an unmistakable implication (a stated goal, a preset). A raised weight needs a reason in THIS exchange.
- Map the signal to the right dimension:
    cost = bills, saving money, payback, affordability;
    carbon = footprint, emissions, climate, "doing my part";
    comfort = drafty/stuffy/too hot or cold, air quality, health;
    resilience = outages, blackouts, storms, backup power, staying powered when the grid fails;
    learning = wanting to understand the space, no project in mind.
  (So "keep the lights on when the grid goes down" is a strong resilience signal; "lower my bill" is cost.)
- NEVER invent motivation from silence, from a polite reply, or from merely naming a technology — "how do heat pumps work?" is curiosity about a topic, not a comfort/carbon motivation. When in doubt, emit nothing for this slot.
- Re-set the vector when the emphasis genuinely shifts; otherwise leave it unchanged.

STANCES (preferences) — how the user feels about an OPTION they could accept or decline:
- "interested"/"priority"/"curious" when the user is drawn to an option; "ruled_out" ONLY when they explicitly decline, reject, or say it won't work for them.
- Namespace the entity (${PREFERENCE_ENTITY_NAMESPACES.join(", ")}), e.g. tech:solar. Add a short "note" when the user gives a reason ("shaded roof", "no room").
- Use canonical hyphenated slugs for multiword entities — tech:heat-pump (NOT tech:heatpump), tech:community-solar, tech:ev, tech:solar, tech:insulation. Lowercase, hyphen-separated, no spaces.
- NEVER infer "ruled_out" from silence — a user who hasn't mentioned EVs has not declined them. Absence of a stance is the correct state; do not manufacture one.

RULES:
- Output ONLY the JSON array. No prose, no markdown, no code fences.
- Emit a patch ONLY for information NEW or CHANGED in this exchange. If nothing was learned, output [].
- "stated" = the user said it directly; "inferred" = you reasonably deduced it. Never emit "edited" or "propagated".
- NEVER infer a "ruled_out" stance from silence — only when the user actually declines or rejects something.
- NEVER change a slot marked (locked) in the current profile.
- Keep location no finer than city/state/zip; never capture a street address.
- Do not restate values already present and unchanged in the current profile.`;
}

/** Compact view of what's already known, so the model doesn't re-emit it. */
export function summarizeProfile(profile: SessionProfile): string {
  const lines: string[] = [];
  for (const name of SLOT_NAMES) {
    const slot = profile[name];
    if (!slotFilled(slot)) continue;
    const locked = slot.provenance === "edited" ? " (locked)" : "";
    lines.push(`- ${name}${locked}: ${JSON.stringify(slot.value)}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(empty)";
}

/** The user-turn prompt: current profile + the exchange to extract from. */
export function buildExtractionPrompt(profile: SessionProfile, exchange: Exchange): string {
  const parts = [`CURRENT PROFILE:\n${summarizeProfile(profile)}`, "", "LATEST EXCHANGE:"];
  if (exchange.assistant) parts.push(`Assistant: ${exchange.assistant}`);
  parts.push(`User: ${exchange.user}`, "", "Patches (JSON array only):");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Response parsing (pure, tolerant)

/**
 * Split a JSON-array body into its top-level `{…}` object spans by brace
 * depth, so each can be parsed on its own. Nested value objects (e.g. a
 * goal's `{ "text": … }`) stay inside their parent span.
 *
 * Deliberately *not* string-aware: this runs only after the array as a
 * whole has already failed to parse, and the corruption we're salvaging
 * around (a stray glitch token) frequently unbalances a quote, which would
 * desync string tracking and lose every sibling after it. A plain brace
 * scan is immune to that. The one thing it can misjudge — a literal
 * `{`/`}` inside a string value — costs at most one already-suspect object
 * its salvage, and never affects clean input (which took the fast path).
 */
function objectSpans(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        spans.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return spans;
}

/**
 * Extract the JSON patch array from a model response, tolerating code
 * fences and surrounding prose. Returns [] when no array can be found or
 * parsed — a parse failure must never throw into the chat path.
 *
 * When the array as a whole won't parse, fall back to parsing each
 * top-level object independently and keep the ones that survive. A weak or
 * quantized model routinely injects a stray glitch token (a rogue Unicode
 * char, a mangled key) that invalidates the *whole* document under a single
 * `JSON.parse`; per-object salvage shrinks that blast radius to the one bad
 * object, so a single glitch no longer discards the whole turn's patches.
 * Every survivor still passes through `sanitizeExtractedPatches` and
 * `applyPatches`, which validate it — salvage only recovers syntax, it
 * grants no trust. (Prevention — constraining the model to valid JSON — is
 * the complementary layer, tracked in the plan; this is the containment
 * layer, and it is unconditional.)
 */
export function parsePatchArray(text: string): unknown[] {
  if (typeof text !== "string") return [];
  let body = text.trim();

  // Strip a leading ```json / ``` fence and its closing fence, if present.
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) body = fence[1].trim();

  // Fall back to the outermost bracketed span if there's leading/trailing prose.
  if (!body.startsWith("[")) {
    const start = body.indexOf("[");
    const end = body.lastIndexOf("]");
    if (start === -1 || end <= start) return [];
    body = body.slice(start, end + 1);
  }

  // Fast path: a well-formed array parses whole.
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    // Fall through to per-object salvage.
  }

  // Salvage path: parse each element object on its own; a corrupt sibling
  // drops only itself.
  const salvaged: unknown[] = [];
  for (const span of objectSpans(body)) {
    try {
      salvaged.push(JSON.parse(span));
    } catch {
      // Corrupt object — skip it, keep the rest.
    }
  }
  return salvaged;
}

const EMITTABLE_PROVENANCE = new Set(["stated", "inferred"]);

/**
 * Keep only patches the extractor is allowed to emit: a known op, and a
 * provenance restricted to stated/inferred (edited/propagated are the
 * user's and the propagation flow's to set). Shape and value validation
 * happen downstream in `applyPatches`; this is the provenance gate.
 */
export function sanitizeExtractedPatches(raw: unknown[]): ProfilePatch[] {
  const patches: ProfilePatch[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (p.op !== "set" && p.op !== "append" && p.op !== "clear") continue;
    // `clear` carries no user-authored value; allow it through as inferred-safe.
    const provenance = p.op === "clear" ? "inferred" : p.provenance;
    if (typeof provenance !== "string" || !EMITTABLE_PROVENANCE.has(provenance)) continue;
    patches.push({ ...(p as object), provenance } as ProfilePatch);
  }
  return patches;
}

// ---------------------------------------------------------------------------
// Orchestration

/**
 * Run extraction for one exchange. Never throws and never blocks: any
 * failure (model error, unparseable output) logs and yields an empty
 * patch list, so the caller's chat reply is unaffected. The returned
 * patches are provenance-sanitized but still pass through `applyPatches`
 * at the call site for schema validation and the edited-wins rule.
 */
export async function extractProfilePatches(
  profile: SessionProfile,
  exchange: Exchange,
  generate: GenerateFn,
): Promise<ProfilePatch[]> {
  if (!exchange.user?.trim()) return [];
  try {
    const text = await generate({
      system: buildExtractionSystem(),
      prompt: buildExtractionPrompt(profile, exchange),
    });
    return sanitizeExtractedPatches(parsePatchArray(text));
  } catch (err) {
    console.error("[extractor] extraction failed, skipping:", err);
    return [];
  }
}
