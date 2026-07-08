import type { ModelPurpose } from "@/lib/model-map";

/**
 * One eval assertion against the model's text output. Extend this union as
 * fixture sets grow (WP1.4 extraction, WP3.6 composer) — the runner switches
 * exhaustively, so a new kind fails compilation until it's handled.
 */
export type EvalAssertion =
  | { kind: "contains"; value: string; caseSensitive?: boolean }
  | { kind: "matches"; pattern: string; flags?: string }
  | { kind: "json-parses" };

export interface EvalFixture {
  /** Shown in the report; defaults are per-file, so keep it unique per file. */
  name: string;
  /** Which model-map purpose this call uses (chat / extraction / composition). */
  purpose: ModelPurpose;
  system?: string;
  prompt: string;
  assertions: EvalAssertion[];
}

/** A fixture file default-exports one fixture or an array of them. */
export type EvalFixtureModule = EvalFixture | EvalFixture[];
