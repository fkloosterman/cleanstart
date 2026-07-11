import type { EvalFixtureModule } from "../types";

/**
 * Motivation & stance fixtures (WP2.3, §5.1, §4.3): transcript → expected
 * profile, focused on the slots the extractor was tuned to maintain in this
 * WP — the `motivation_weights` vector and technology `preferences`.
 *
 * The load-bearing assertions (the WP2.3 done-when): weights MOVE on a
 * genuine motivation statement and do NOT move on silence, ruled-out is
 * captured only on an explicit decline, and a stance is never invented from
 * silence. Run against the production-designated extraction model before
 * prompt-touching merges (D16).
 */
const fixtures: EvalFixtureModule = [
  {
    type: "extraction",
    name: "motivation: a savings statement moves weights toward the cost lane",
    exchange: {
      assistant: "What's most on your mind about your home's energy?",
      user: "Honestly, I just want to bring my electricity bill down as much as I can.",
    },
    expect: [{ kind: "motivation-lane", lane: "lower_bills" }],
  },
  {
    type: "extraction",
    name: "motivation: an outage concern moves weights toward the resilience lane",
    exchange: {
      assistant: "What's prompting you to look into this now?",
      user: "After the ice storm knocked our power out for three days, I want to keep the lights on when the grid goes down.",
    },
    expect: [{ kind: "motivation-lane", lane: "resilience" }],
  },
  {
    type: "extraction",
    name: "motivation: a bare 'how does it work' question invents no motivation (silence rule)",
    exchange: {
      assistant: "Happy to help you get oriented.",
      user: "How do heat pumps actually work?",
    },
    // Naming a technology is curiosity about a topic, not a comfort/carbon
    // motivation — the vector must stay empty.
    expect: [{ kind: "slot-empty", slot: "motivation_weights" }],
  },
  {
    type: "extraction",
    name: "motivation: a neutral reply leaves an existing vector unchanged",
    base: {
      motivation_weights: {
        value: { cost: 1, carbon: 0.2, comfort: 0, resilience: 0, learning: 0 },
        provenance: "inferred",
      },
    },
    exchange: {
      assistant: "Those upgrades can add up, but some pay back quickly.",
      user: "Got it, thanks!",
    },
    expect: [{ kind: "slot-unchanged", slot: "motivation_weights" }],
  },
  {
    type: "extraction",
    name: "stance: an explicit decline records ruled_out",
    base: {
      tenure: { value: "owner", provenance: "stated", confidence: "high" },
      region: { value: { state: "MA", city: "Boston" }, provenance: "stated" },
    },
    exchange: {
      assistant: "Have you thought about rooftop solar?",
      user: "Solar's off the table for us — our roof is way too shaded.",
    },
    expect: [{ kind: "preference-stance", entity: "tech:solar", stance: "ruled_out" }],
  },
  {
    type: "extraction",
    name: "stance: silence about EVs records no stance (never infer ruled_out)",
    base: {
      tenure: { value: "owner", provenance: "stated", confidence: "high" },
    },
    exchange: {
      assistant: "There's a lot you could look at — solar, heat pumps, weatherization.",
      user: "I'm mainly focused on cutting my heating costs this winter.",
    },
    expect: [
      { kind: "preference-absent", entity: "tech:ev" },
      { kind: "motivation-lane", lane: "lower_bills" },
    ],
  },
  {
    type: "extraction",
    name: "stance: curiosity about an option is captured as interest, not ruled_out",
    base: {
      tenure: { value: "renter", provenance: "stated", confidence: "high" },
    },
    exchange: {
      assistant: "Renters have more options than people expect.",
      user: "I've been really curious whether a heat pump would even work in my apartment.",
    },
    expect: [{ kind: "preference-stance", entity: "tech:heat-pump", stance: "curious" }],
  },
];

export default fixtures;
