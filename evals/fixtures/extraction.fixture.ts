import type { EvalFixtureModule } from "../types";

/**
 * Profile-extractor fixtures (WP1.4, §6.5): transcript → expected profile.
 * Each runs the real extractor over the exchange, applies the returned
 * patches, and asserts on the resulting profile. Run against the
 * production-designated extraction model before prompt-touching merges
 * (D16).
 *
 * Scope note: these cover the WP1.4 baseline — plain slot capture, "no new
 * information", and the edited-wins guarantee. Motivation weights,
 * technology-stance preferences, ruled-out capture, and the
 * never-infer-from-silence rule get their own fixtures in WP2.3, when the
 * extractor is tuned to maintain those slots.
 */
const fixtures: EvalFixtureModule = [
  {
    type: "extraction",
    name: "extraction: captures a stated goal and tenure",
    exchange: {
      assistant: "What brought you here today?",
      user: "I own my home, and I want to lower my electricity bills.",
    },
    expect: [
      { kind: "slot-value", slot: "tenure", value: "owner" },
      { kind: "list-includes", slot: "goals", text: "bill" },
    ],
  },
  {
    type: "extraction",
    name: "extraction: captures a conversational slot (housing type)",
    base: {
      tenure: { value: "owner", provenance: "stated", confidence: "high" },
    },
    exchange: {
      assistant: "Tell me a bit about your place.",
      user: "It's a single-family house in the suburbs.",
    },
    expect: [{ kind: "slot-value", slot: "housing_type", value: "single-family" }],
  },
  {
    type: "extraction",
    name: "extraction: no new information yields no changes",
    base: {
      tenure: { value: "renter", provenance: "stated", confidence: "high" },
    },
    exchange: {
      assistant: "Renters have some great options too.",
      user: "Thanks!",
    },
    expect: [
      { kind: "slot-value", slot: "tenure", value: "renter" }, // unchanged
      { kind: "slot-empty", slot: "goals" },
    ],
  },
  {
    type: "extraction",
    name: "extraction: does not overwrite a user-edited slot",
    base: {
      tenure: { value: "renter", provenance: "edited", confidence: "high" },
    },
    exchange: {
      // Even if the model tries to set owner, edited-wins must hold.
      user: "I own the place actually, it's a single-family home.",
    },
    expect: [{ kind: "slot-value", slot: "tenure", value: "renter" }],
  },
];

export default fixtures;
