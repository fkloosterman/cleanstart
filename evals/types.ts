import type { ContentComponent, ContentSource } from "@/lib/content/schema";
import type { LaneId } from "@/lib/lanes/playbooks";
import type { ModelPurpose } from "@/lib/model-map";
import type { Preference, SessionProfile, SlotName } from "@/lib/profile/registry";

/**
 * One eval assertion against the model's text output. Extend this union as
 * fixture sets grow (WP1.4 extraction, WP3.6 composer) — the runner switches
 * exhaustively, so a new kind fails compilation until it's handled.
 */
export type EvalAssertion =
  | { kind: "contains"; value: string; caseSensitive?: boolean }
  | { kind: "matches"; pattern: string; flags?: string }
  | { kind: "json-parses" };

/**
 * A text fixture: send system+prompt to the purpose's model, assert on the
 * raw reply. `type` is optional for backward compatibility (absent = text).
 */
export interface TextFixture {
  type?: "text";
  /** Shown in the report; defaults are per-file, so keep it unique per file. */
  name: string;
  /** Which model-map purpose this call uses (chat / extraction / composition). */
  purpose: ModelPurpose;
  system?: string;
  prompt: string;
  assertions: EvalAssertion[];
}

/** Backward-compatible alias — the original fixture shape (WP0.5). */
export type EvalFixture = TextFixture;

/**
 * An assertion on the profile that results from running the extractor over a
 * fixture's exchange and applying the returned patches (§6.5). Transcript →
 * expected profile.
 */
export type ExtractionExpectation =
  | { kind: "slot-filled"; slot: SlotName }
  | { kind: "slot-empty"; slot: SlotName }
  | { kind: "slot-value"; slot: SlotName; value: unknown }
  | { kind: "list-includes"; slot: SlotName; text: string }
  // WP2.3 — motivation & stance expectations:
  /** The slot's value is exactly what the base profile held (extraction left it alone). */
  | { kind: "slot-unchanged"; slot: SlotName }
  /** The lane derived from motivation_weights after extraction (argmax). */
  | { kind: "motivation-lane"; lane: LaneId }
  /** A preference for `entity` exists with this stance. */
  | { kind: "preference-stance"; entity: string; stance: Preference["stance"] }
  /** No preference for `entity` exists — the never-infer-from-silence guard. */
  | { kind: "preference-absent"; entity: string };

/**
 * An extraction fixture: a starting profile plus the latest exchange; the
 * runner extracts patches, applies them, and checks the resulting profile.
 * Always uses the `extraction` purpose.
 */
export interface ExtractionFixture {
  type: "extraction";
  name: string;
  /** Raw starting profile (normalized before use). Omit for an empty profile. */
  base?: unknown;
  exchange: { user: string; assistant?: string };
  expect: ExtractionExpectation[];
}

/**
 * An assertion on the report the composer produces for a (profile, library)
 * pair (§6.5). Run against the assembled `ReportDocument`, so it exercises the
 * whole pipeline: candidate selection → model call → validation → assembly.
 */
export type ComposerExpectation =
  /** Every library action item references a real candidate slug (slug whitelist held). */
  | { kind: "slugs-valid" }
  /** No revealed *or* held-back item exceeds the progressive-disclosure reveal cap. */
  | { kind: "reveal-max"; max: number }
  /** At least `count` action items survived — the report isn't empty. */
  | { kind: "min-items"; count: number }
  /** Some action item is a component tagged with `tech` — interest coverage. */
  | { kind: "covers-tech"; tech: string }
  /** No item or background entry is a component tagged with `tech` — ruled-out suppression. */
  | { kind: "suppresses-tech"; tech: string };

/**
 * A composer fixture: a synthetic content library plus a profile; the runner
 * selects candidates, calls the composer, assembles the document, and checks it.
 * Always uses the `composition` purpose.
 */
export interface ComposerFixture {
  type: "composer";
  name: string;
  profile: SessionProfile;
  components: ContentComponent[];
  sources?: ContentSource[];
  /** Optional conversation highlights fed to the composer digest. */
  digest?: string;
  expect: ComposerExpectation[];
}

export type AnyFixture = TextFixture | ExtractionFixture | ComposerFixture;

/** A fixture file default-exports one fixture or an array of them. */
export type EvalFixtureModule = AnyFixture | AnyFixture[];
