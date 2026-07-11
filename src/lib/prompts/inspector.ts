/**
 * Wire format for the dev prompt inspector.
 *
 * When enabled (an env flag, off in production), both chat endpoints stream
 * the assembled system prompt — broken into its labeled sections (see
 * `buildContextSections`) plus a little derived metadata — as a transient
 * data part, reusing the same stream-part mechanism as profile patches
 * (WP1.5). The client renders it in a collapsible, color-coded inspector so
 * a developer can see exactly what the model was told for the last turn.
 *
 * It is purely diagnostic: transient (never persisted), gated server-side so
 * it never reaches a production client, and carries nothing the profile
 * doesn't already hold.
 */

import type { ContextSection, ContextSectionId } from "@/lib/prompts/context";

/** The data-part name; the emitted/received part `type` is `data-${NAME}`. */
export const CONTEXT_DEBUG_DATA_NAME = "context-debug" as const;

/** The part/chunk `type` string the server writes and the client matches. */
export const CONTEXT_DEBUG_PART_TYPE = `data-${CONTEXT_DEBUG_DATA_NAME}` as const;

/** Compact derived header for the inspector — the at-a-glance state. */
export interface ContextDebugMeta {
  /** argmax lane. */
  lanePrimary: string;
  /** The narrative framing (a lane, or "mixed"). */
  laneFraming: string;
  laneMixed: boolean;
  /** discovery / deepening / synthesis. */
  stage: string;
}

/** Payload carried by a `data-context-debug` part. */
export interface ContextDebugData {
  meta: ContextDebugMeta;
  sections: ContextSection[];
}

/**
 * Whether to expose the prompt inspector. Off unless `EXPOSE_PROMPT_INSPECTOR`
 * is explicitly truthy — so it lights up on dev/staging (where the env var is
 * set) and is inert in production. Reads a plain env bag so it stays pure and
 * testable.
 */
export function promptInspectorEnabled(env: Record<string, string | undefined>): boolean {
  const v = env.EXPOSE_PROMPT_INSPECTOR;
  return v === "1" || v === "true";
}

const SECTION_IDS = new Set<ContextSectionId>([
  "base",
  "profile",
  "framing",
  "stage",
  "grounding",
  "still_to_learn",
  "brevity",
]);

/**
 * Read a `ContextDebugData` back out of an untyped stream payload. Tolerant
 * by design — a malformed or foreign payload yields `null` rather than
 * throwing into the client's stream handler.
 */
export function readContextDebugData(data: unknown): ContextDebugData | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { meta?: unknown; sections?: unknown };
  if (typeof d.meta !== "object" || d.meta === null || !Array.isArray(d.sections)) return null;

  const sections: ContextSection[] = [];
  for (const raw of d.sections) {
    if (typeof raw !== "object" || raw === null) continue;
    const s = raw as { id?: unknown; label?: unknown; text?: unknown };
    if (
      typeof s.id === "string" &&
      SECTION_IDS.has(s.id as ContextSectionId) &&
      typeof s.label === "string" &&
      typeof s.text === "string"
    ) {
      sections.push({ id: s.id as ContextSectionId, label: s.label, text: s.text });
    }
  }
  if (sections.length === 0) return null;

  const m = d.meta as Record<string, unknown>;
  return {
    meta: {
      lanePrimary: typeof m.lanePrimary === "string" ? m.lanePrimary : "",
      laneFraming: typeof m.laneFraming === "string" ? m.laneFraming : "",
      laneMixed: Boolean(m.laneMixed),
      stage: typeof m.stage === "string" ? m.stage : "",
    },
    sections,
  };
}
