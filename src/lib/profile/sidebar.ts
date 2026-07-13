/**
 * Sidebar render model — registry-driven (WP1.6, design §4.7).
 *
 * The sidebar is derived from `SLOT_REGISTRY`, never a hand-maintained
 * list: this module turns a `SessionProfile` into a grouped, formatted
 * view — filled slots with a display value + provenance, preference
 * stances, and the *unknowns* (registry slots not yet filled) so the
 * user can see what's still blank. The React component (ProfileSidebar)
 * only lays this out and wires edits; all the grouping/formatting/unknown
 * logic lives here so it can be unit-tested without a DOM.
 *
 * Editing is expressed the same way everything else writes a profile —
 * as patches through `applyPatches` with `provenance: "edited"` — so a
 * correction outranks later extraction (edited-wins). `slotEditor` maps
 * each slot to the editor kind its schema implies (enum options, region
 * free text, a text list, preference stances, or read-only), again
 * derived from the registry rather than enumerated by hand.
 */

import type { z } from "zod";
import { slotFilled } from "@/lib/profile/normalize";
import {
  SLOT_NAMES,
  SLOT_REGISTRY,
  type Confidence,
  type Preference,
  type Provenance,
  type SessionProfile,
  type SidebarGroup,
  type SlotName,
} from "@/lib/profile/registry";

// ---------------------------------------------------------------------------
// Group + value labels

/** Group order and headings (registry declaration order already matches). */
export const GROUP_ORDER: SidebarGroup[] = ["context", "intent", "lists"];

export const GROUP_LABELS: Record<SidebarGroup, string> = {
  context: "Your home",
  intent: "What you're after",
  lists: "Notes",
};

const TENURE_LABELS: Record<string, string> = {
  owner: "Own",
  renter: "Rent",
  other: "Other",
};

const HOUSING_LABELS: Record<string, string> = {
  "single-family": "Single-family home",
  townhouse: "Townhouse",
  apartment: "Apartment",
  condo: "Condo",
  mobile: "Mobile home",
};

const TIMELINE_LABELS: Record<string, string> = {
  "ready-now": "Ready now",
  "this-year": "This year",
  exploring: "Just exploring",
};

const BUDGET_LABELS: Record<string, string> = {
  minimal: "Keep it minimal",
  moderate: "Moderate",
  "willing-to-invest": "Willing to invest",
};

const AUTHORITY_LABELS: Record<string, string> = {
  sole: "you decide",
  shared: "shared decision",
  landlord: "landlord decides",
  hoa: "HOA",
};

const MOTIVATION_LABELS: Record<string, string> = {
  cost: "Saving money",
  carbon: "Climate impact",
  comfort: "Comfort & health",
  resilience: "Resilience",
  learning: "Learning",
};

export const STANCE_ORDER: Preference["stance"][] = [
  "priority",
  "interested",
  "curious",
  "ruled_out",
];

export const STANCE_LABELS: Record<Preference["stance"], string> = {
  priority: "Priority",
  interested: "Interested in",
  curious: "Curious about",
  ruled_out: "Ruled out",
};

/** Per-slot enum label map, so display and the edit buttons read alike. */
const ENUM_LABELS: Partial<Record<SlotName, Record<string, string>>> = {
  tenure: TENURE_LABELS,
  housing_type: HOUSING_LABELS,
  timeline: TIMELINE_LABELS,
  budget_posture: BUDGET_LABELS,
};

function humanize(slug: string): string {
  const cleaned = slug.replace(/[-_]/g, " ").trim();
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : slug;
}

/** Human label for an enum option, used for both display and edit buttons. */
export function enumOptionLabel(name: SlotName, option: string): string {
  return ENUM_LABELS[name]?.[option] ?? humanize(option);
}

/** "tech:solar" → "Solar"; the namespace is dropped, the slug humanized. */
export function humanizeEntity(entity: string): string {
  const slug = entity.includes(":") ? entity.slice(entity.indexOf(":") + 1) : entity;
  return humanize(slug);
}

// ---------------------------------------------------------------------------
// The render model

export interface SidebarStanceEntry {
  entity: string;
  label: string;
  note?: string;
}

export interface SidebarStanceGroup {
  stance: Preference["stance"];
  label: string;
  entries: SidebarStanceEntry[];
}

/** The formatted value of a filled slot; shape depends on the slot kind. */
export type SidebarValue =
  | { type: "scalar"; text: string }
  | { type: "list"; items: string[] }
  | { type: "stances"; groups: SidebarStanceGroup[] };

export interface SidebarField {
  slot: SlotName;
  label: string;
  group: SidebarGroup;
  kind: "scalar" | "list";
  filled: boolean;
  /** Asked about but deliberately left blank (D3's "not sure yet"). */
  askedUnknown: boolean;
  provenance: Provenance | null;
  confidence: Confidence;
  /** The formatted value when filled; `null` for unknowns. */
  value: SidebarValue | null;
}

export interface SidebarGroupModel {
  group: SidebarGroup;
  label: string;
  fields: SidebarField[];
}

export type SidebarModel = SidebarGroupModel[];

function formatRegion(value: unknown): string {
  const r = value as { state?: string; city?: string };
  // Zip is stored for content matching but never shown (§4.8).
  if (r.city && r.state) return `${r.city}, ${r.state}`;
  return r.state ?? r.city ?? "";
}

function formatHousehold(value: unknown): string {
  const h = value as { size?: number; decision_authority?: string };
  const parts: string[] = [];
  if (typeof h.size === "number") parts.push(`${h.size} ${h.size === 1 ? "person" : "people"}`);
  if (h.decision_authority)
    parts.push(AUTHORITY_LABELS[h.decision_authority] ?? h.decision_authority);
  return parts.join(" · ");
}

function formatExistingSystems(value: unknown): string {
  const s = value as {
    heating?: string;
    cooling?: string;
    has_solar?: boolean;
    has_ev?: boolean;
  };
  const parts: string[] = [];
  if (s.heating) parts.push(`${s.heating} heating`);
  if (s.cooling) parts.push(`${s.cooling} cooling`);
  if (s.has_solar) parts.push("Has solar");
  if (s.has_ev) parts.push("Has EV");
  return parts.join(" · ");
}

function formatMotivation(value: unknown): string {
  const w = value as Record<string, number>;
  const ranked = Object.entries(w)
    .filter(([, weight]) => typeof weight === "number" && weight > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => MOTIVATION_LABELS[key] ?? humanize(key));
  return ranked.slice(0, 3).join(", ");
}

/** Format a filled non-preference list slot (goals/constraints/topics) as chips. */
function formatListItems(name: SlotName, value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  if (name === "topics_discussed") return value.map((v) => humanize(String(v)));
  // goals / constraints entries are { text, tags? }.
  return value.map((v) => (v as { text?: string }).text ?? String(v)).filter(Boolean);
}

function formatPreferences(value: unknown): SidebarStanceGroup[] {
  if (!Array.isArray(value)) return [];
  const prefs = value as Preference[];
  const groups: SidebarStanceGroup[] = [];
  for (const stance of STANCE_ORDER) {
    const entries = prefs
      .filter((p) => p.stance === stance)
      .map((p) => ({ entity: p.entity, label: humanizeEntity(p.entity), note: p.note }));
    if (entries.length > 0) {
      groups.push({ stance, label: STANCE_LABELS[stance], entries });
    }
  }
  return groups;
}

function formatScalar(name: SlotName, value: unknown): string {
  switch (name) {
    case "region":
      return formatRegion(value);
    case "household":
      return formatHousehold(value);
    case "existing_systems":
      return formatExistingSystems(value);
    case "motivation_weights":
      return formatMotivation(value);
    default:
      return enumOptionLabel(name, String(value));
  }
}

function formatValue(name: SlotName, value: unknown): SidebarValue | null {
  if (name === "preferences") {
    const groups = formatPreferences(value);
    return groups.length > 0 ? { type: "stances", groups } : null;
  }
  if (SLOT_REGISTRY[name].kind === "list") {
    const items = formatListItems(name, value);
    return items.length > 0 ? { type: "list", items } : null;
  }
  const text = formatScalar(name, value);
  return text ? { type: "scalar", text } : null;
}

/**
 * Build the grouped sidebar model for a profile. Every registry slot is
 * present — filled slots carry a formatted `value`, unknowns carry
 * `null` so the UI can show what's still blank.
 */
export function buildSidebarModel(profile: SessionProfile): SidebarModel {
  const byGroup: Record<SidebarGroup, SidebarField[]> = {
    context: [],
    intent: [],
    lists: [],
  };

  for (const name of SLOT_NAMES) {
    const def = SLOT_REGISTRY[name];
    const slot = profile[name];
    const filled = slotFilled(slot);
    byGroup[def.sidebar.group].push({
      slot: name,
      label: def.sidebar.label,
      group: def.sidebar.group,
      kind: def.kind,
      filled,
      askedUnknown: !filled && Boolean(slot.asked_at),
      provenance: slot.provenance,
      confidence: slot.confidence,
      value: filled ? formatValue(name, slot.value) : null,
    });
  }

  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    fields: byGroup[group],
  }));
}

// ---------------------------------------------------------------------------
// Edit affordances (derived from the registry)

export type SlotEditor =
  | { kind: "enum"; options: string[] }
  | { kind: "region" }
  | { kind: "text-list" }
  | { kind: "preferences" }
  | { kind: "readonly" };

/** The enum members of a scalar enum schema, or null for any other schema. */
function enumOptions(schema: z.ZodType): string[] | null {
  const options = (schema as unknown as { options?: unknown }).options;
  return Array.isArray(options) && options.every((o) => typeof o === "string")
    ? (options as string[])
    : null;
}

/**
 * How a slot is edited, inferred from its registry declaration:
 * scalar enums pick from options, `region` is free text, preference and
 * other lists have their own editors, and structured object scalars
 * (motivation vector, household, existing systems) are read-only for now.
 */
export function slotEditor(name: SlotName): SlotEditor {
  const def = SLOT_REGISTRY[name];
  if (def.kind === "list") {
    return name === "preferences" ? { kind: "preferences" } : { kind: "text-list" };
  }
  const options = enumOptions(def.schema);
  if (options) return { kind: "enum", options };
  if (name === "region") return { kind: "region" };
  return { kind: "readonly" };
}
