/**
 * Slot registry — the single source of truth for the session profile
 * (WP1.1, design §4.1–§4.3, §4.8, §11).
 *
 * Slots are declared once here; everything else derives from the
 * declaration: the profile type, the tolerant normalizer, the extractor
 * prompt (WP1.4), the sidebar renderer (WP1.6), and the
 * durable-propagation whitelist (WP1.10). Adding a slot = adding an
 * entry here, nothing else. Never rename or repurpose a key, and never
 * narrow an enum — stored profiles (DB and guest localStorage) are
 * long-lived and are normalized on read, not migrated.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// The slot envelope (§4.1)

export type Provenance = "stated" | "inferred" | "edited" | "propagated";
export type Confidence = "high" | "low";

export const PROVENANCE_VALUES = ["stated", "inferred", "edited", "propagated"] as const;
export const CONFIDENCE_VALUES = ["high", "low"] as const;

/**
 * Every slot is a value plus metadata; provenance and confidence drive
 * both the readiness function and the sidebar. `updated_at` is absent
 * only on a slot that has never been written.
 */
export type Slot<T> = {
  value: T | null;
  provenance: Provenance | null;
  confidence: Confidence;
  /** Set when the agent asked about this slot — prevents re-asking (§4.1, D3). */
  asked_at?: string;
  updated_at?: string;
};

// ---------------------------------------------------------------------------
// Preferences (§4.3)

/**
 * Entity namespace vocabulary. Adding a namespace is adding a line;
 * never reuse a namespace with a new meaning (§11).
 */
export const PREFERENCE_ENTITY_NAMESPACES = ["tech", "approach", "financing"] as const;

export const preferenceEntitySchema = z
  .string()
  .regex(
    new RegExp(`^(${PREFERENCE_ENTITY_NAMESPACES.join("|")}):[a-z0-9][a-z0-9-]*$`),
    "entity must be '<namespace>:<slug>' with a known namespace",
  );

export const preferenceSchema = z.looseObject({
  entity: preferenceEntitySchema, // "tech:solar", "approach:diy", "financing:loan"
  stance: z.enum(["curious", "interested", "priority", "ruled_out"]),
  note: z.string().optional(), // "roof too shaded"
  provenance: z.enum(["stated", "inferred", "edited"]),
});

export type Preference = z.infer<typeof preferenceSchema>;

// ---------------------------------------------------------------------------
// Slot value schemas

const tenureSchema = z.enum(["owner", "renter", "other"]);

const housingTypeSchema = z.enum(["single-family", "apartment", "condo", "mobile"]);

// Coarse by design: state/province level, never an address. The zip is
// kept only for utility- and program-level content matching and is
// displayed only as city/state (§4.8).
const regionSchema = z.looseObject({
  state: z.string().min(2),
  city: z.string().optional(),
  zip: z.string().optional(),
});

const householdSchema = z.looseObject({
  size: z.number().int().positive().optional(),
  decision_authority: z.enum(["sole", "shared", "landlord", "hoa"]).optional(),
});

const existingSystemsSchema = z.looseObject({
  heating: z.string().optional(),
  cooling: z.string().optional(),
  has_solar: z.boolean().optional(),
  has_ev: z.boolean().optional(),
});

/**
 * The motivation dimensions — the axes of the `motivation_weights` vector
 * and the anchors the five lanes derive from (§5.1, WP2.1). Declared once
 * so the slot schema, the lane registry, and the sidebar all agree; adding
 * a dimension is a "weight dimension + impact backfill" content project
 * (§11), never a silent edit.
 */
export const MOTIVATION_DIMENSIONS = [
  "cost",
  "carbon",
  "comfort",
  "resilience",
  "learning",
] as const;
export type MotivationDimension = (typeof MOTIVATION_DIMENSIONS)[number];

/** A plain reading of the vector: one non-negative weight per dimension. */
export type MotivationWeights = Record<MotivationDimension, number>;

// The vector is primary; the lane is derived (§5.1). Weights are
// relative, non-negative; downstream derivation normalizes. The shape is
// spelled out (not built from MOTIVATION_DIMENSIONS) so the inferred type
// stays precise; a registry test guards the two against drift.
const motivationWeightsSchema = z.looseObject({
  cost: z.number().min(0),
  carbon: z.number().min(0),
  comfort: z.number().min(0),
  resilience: z.number().min(0),
  learning: z.number().min(0),
});

const timelineSchema = z.enum(["ready-now", "this-year", "exploring"]);

const budgetPostureSchema = z.enum(["minimal", "moderate", "willing-to-invest"]);

const goalSchema = z.looseObject({
  text: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

const constraintSchema = z.looseObject({
  text: z.string().min(1),
  tags: z.array(z.string()).optional(),
  /**
   * Extractor's hint that the constraint describes the home rather than
   * the moment ("100-amp panel" vs "no money until spring") — feeds the
   * §4.6 promotion rule at session end (WP1.10).
   */
  durable: z.boolean().optional(),
});

const topicSchema = z.string().min(1); // technology tags touched

// ---------------------------------------------------------------------------
// Registry

export type SidebarGroup = "context" | "intent" | "lists";

/** How a slot's value is collected (§4.2, §4.8). */
export type Elicitation = "upfront" | "conversational" | "either";

interface SlotDefBase {
  /** One line the extractor prompt derives from (WP1.4). */
  extractor_hint: string;
  sidebar: { label: string; group: SidebarGroup };
  /** Eligible for the durable profile (§4.6). */
  durable: boolean;
  elicitation: Elicitation;
}

export interface ScalarSlotDef<S extends z.ZodType = z.ZodType> extends SlotDefBase {
  kind: "scalar";
  /** Schema for the slot's value (when non-null). */
  schema: S;
}

export interface ListSlotDef<S extends z.ZodType = z.ZodType> extends SlotDefBase {
  kind: "list";
  /** Schema for a single list entry; the slot value is an array of these. */
  schema: S;
}

export type SlotDef = ScalarSlotDef | ListSlotDef;

export const SLOT_REGISTRY = {
  tenure: {
    kind: "scalar",
    schema: tenureSchema,
    extractor_hint: "Whether the user owns or rents their home",
    sidebar: { label: "Own or rent", group: "context" },
    durable: true,
    elicitation: "upfront",
  },
  housing_type: {
    kind: "scalar",
    schema: housingTypeSchema,
    extractor_hint: "The kind of home: single-family, apartment, condo, or mobile",
    sidebar: { label: "Home type", group: "context" },
    durable: true,
    elicitation: "conversational",
  },
  region: {
    kind: "scalar",
    schema: regionSchema,
    extractor_hint: "Where the home is, no finer than city/state plus zip; never a street address",
    sidebar: { label: "Location", group: "context" },
    durable: true,
    elicitation: "upfront",
  },
  household: {
    kind: "scalar",
    schema: householdSchema,
    extractor_hint: "Household size and who decides on home changes (sole, shared, landlord, HOA)",
    sidebar: { label: "Household", group: "context" },
    durable: true,
    elicitation: "conversational",
  },
  existing_systems: {
    kind: "scalar",
    schema: existingSystemsSchema,
    extractor_hint: "What the home already has: heating and cooling type, solar panels, an EV",
    sidebar: { label: "Current systems", group: "context" },
    durable: true,
    elicitation: "conversational",
  },
  motivation_weights: {
    kind: "scalar",
    schema: motivationWeightsSchema,
    extractor_hint:
      "How much the user cares about each of: cost savings, carbon impact, comfort/health, resilience, and learning (relative weights, 0 to 1)",
    sidebar: { label: "What matters to you", group: "intent" },
    // §4.6: only the primary motivation propagates — that nuance is
    // enforced at propagation time (WP1.10), not here.
    durable: true,
    elicitation: "conversational",
  },
  timeline: {
    kind: "scalar",
    schema: timelineSchema,
    extractor_hint: "How soon the user wants to act: ready now, this year, or just exploring",
    sidebar: { label: "Timeline", group: "intent" },
    durable: false,
    elicitation: "conversational",
  },
  budget_posture: {
    kind: "scalar",
    schema: budgetPostureSchema,
    extractor_hint:
      "Spending posture, never dollar amounts: minimal, moderate, or willing to invest",
    sidebar: { label: "Budget posture", group: "intent" },
    durable: false,
    elicitation: "conversational",
  },
  goals: {
    kind: "list",
    schema: goalSchema,
    extractor_hint: "What the user wants to achieve, in their own words (append-only)",
    sidebar: { label: "Goals", group: "lists" },
    durable: false,
    elicitation: "conversational",
  },
  constraints: {
    kind: "list",
    schema: constraintSchema,
    extractor_hint:
      "Limits on what's possible: physical (shaded roof, old panel), legal (HOA, lease), or situational (mark home-describing constraints durable)",
    sidebar: { label: "Constraints", group: "lists" },
    // Session-scoped by default; individual entries promote under the
    // §4.6 promotion rule via their `durable` hint (WP1.10).
    durable: false,
    elicitation: "conversational",
  },
  preferences: {
    kind: "list",
    schema: preferenceSchema,
    extractor_hint:
      "Stances toward options the user can accept or decline (technologies, approaches, financing). Never infer ruled_out from silence",
    sidebar: { label: "Preferences", group: "lists" },
    // Propagation is per-entry under the §4.6 preference rule (WP1.10).
    durable: false,
    elicitation: "conversational",
  },
  topics_discussed: {
    kind: "list",
    schema: topicSchema,
    extractor_hint: "Technology tags the conversation has touched (e.g. solar, heat-pump, ev)",
    sidebar: { label: "Topics discussed", group: "lists" },
    durable: false,
    elicitation: "conversational",
  },
} as const satisfies Record<string, SlotDef>;

export type SlotName = keyof typeof SLOT_REGISTRY;

export const SLOT_NAMES = Object.keys(SLOT_REGISTRY) as SlotName[];

/** The value a slot holds when non-null (lists hold arrays of entries). */
export type SlotValue<K extends SlotName> = (typeof SLOT_REGISTRY)[K] extends { kind: "list" }
  ? z.infer<(typeof SLOT_REGISTRY)[K]["schema"]>[]
  : z.infer<(typeof SLOT_REGISTRY)[K]["schema"]>;

/**
 * The session profile: one enveloped slot per registry entry. At runtime
 * a profile may also carry unknown extra keys (written by a newer bundle
 * — §11 passthrough); code must preserve them but never interpret them.
 */
export type SessionProfile = { [K in SlotName]: Slot<SlotValue<K>> };

export function isListSlot(name: SlotName): boolean {
  return SLOT_REGISTRY[name].kind === "list";
}

/** Zod schema for a slot's full (non-null) value: entry schema for scalars, array for lists. */
export function slotValueSchema(name: SlotName): z.ZodType {
  const def = SLOT_REGISTRY[name];
  return def.kind === "list" ? z.array(def.schema) : def.schema;
}
