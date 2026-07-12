/**
 * Hand-written report-document fixtures (WP3.5, design §7.1).
 *
 * The composer (WP3.6) doesn't exist yet, so the renderer is built and
 * verified against these instead — one per section shape and lane
 * variation, so "every section shape renders correctly" is a concrete,
 * inspectable set rather than a judgement call:
 *
 * - `lower_bills` — an action-first report: `background` collapses to one
 *   explainer, `action_plan` carries the weight (library items, an
 *   authored hybrid item, and held-back items), with open questions and
 *   frozen sources.
 * - `learning` — the study-guide shape: `background` *is* the report
 *   (full), `action_plan` collapses to nothing.
 * - `mixed` — two close motivations: both framings named, a fuller mix.
 * - `minimal` — the degenerate shape: every optional section empty, to
 *   prove the renderer never renders an empty box or crashes on a bare
 *   document.
 *
 * The `about_you` snapshots are built through the real `applyPatches`
 * pipeline from an empty profile, so a fixture profile can never drift
 * from a shape the app actually produces.
 */

import { emptyProfile } from "@/lib/profile/normalize";
import { applyPatches, type ProfilePatch } from "@/lib/profile/patches";
import type { SessionProfile } from "@/lib/profile/registry";
import { DOC_VERSION, type ReportDocument } from "@/lib/report/document";

function profileFrom(patches: ProfilePatch[]): SessionProfile {
  return applyPatches(emptyProfile(), patches, "2026-07-11T12:00:00.000Z").profile;
}

// A fixed timestamp so fixtures (and any snapshot of them) are stable.
const GENERATED_AT = "2026-07-11T12:00:00.000Z";

// ---------------------------------------------------------------------------
// lower_bills — action-first

const lowerBillsProfile = profileFrom([
  { op: "set", slot: "tenure", value: "owner", provenance: "stated" },
  {
    op: "set",
    slot: "region",
    value: { state: "VA", city: "Arlington", zip: "22201" },
    provenance: "stated",
  },
  {
    op: "set",
    slot: "existing_systems",
    value: { heating: "gas furnace", cooling: "central AC" },
    provenance: "inferred",
  },
  { op: "set", slot: "budget_posture", value: "moderate", provenance: "stated" },
  {
    op: "set",
    slot: "motivation_weights",
    value: { cost: 0.7, carbon: 0.1, comfort: 0.1, resilience: 0.05, learning: 0.05 },
    provenance: "inferred",
  },
  {
    op: "append",
    slot: "goals",
    value: { text: "Cut my winter heating bills" },
    provenance: "stated",
  },
  { op: "append", slot: "topics_discussed", value: "heat-pump", provenance: "inferred" },
  { op: "append", slot: "topics_discussed", value: "weatherization", provenance: "inferred" },
]);

const lowerBills: ReportDocument = {
  meta: {
    doc_version: DOC_VERSION,
    generated_at: GENERATED_AT,
    lane_framing: "lower_bills",
    readiness: { score: 100, ready: true },
  },
  about_you: lowerBillsProfile,
  your_goals: {
    headline: "Lower your heating bills without a full gut renovation",
    intro:
      "You own your place in Arlington and want winter bills to come down. The fastest, cheapest wins are about keeping the heat you already pay for — then, when your gas furnace is ready to retire, a heat pump is the upgrade that pays you back.",
  },
  background: [
    {
      component_slug: "weatherization-basics",
      title: "Why sealing and insulation come first",
      body_md:
        "Before any new equipment, **air sealing and insulation** make every other upgrade smaller and cheaper. A drafty house makes even an efficient furnace work overtime.\n\n- Sealing gaps around windows, doors, and the attic hatch is often a weekend's work.\n- Adding attic insulation to modern levels is the single highest-return efficiency job in most older homes.",
      origin: "library",
      sources: ["doe-energy-saver"],
      figures: [
        {
          slug: "weatherization-air-leaks-diagram",
          storage_path: "media/weatherization-air-leaks-diagram.svg",
          alt: "Cross-section of a house showing common air-leak paths at the attic, windows, doors, and rim joist",
          caption: "Most homes leak conditioned air at the attic, windows, doors, and rim joist.",
          credit: { source: "CleanStart original", license: "CC-BY-4.0" },
        },
      ],
    },
  ],
  action_plan: [
    {
      component_slug: "home-energy-audit",
      title: "Book a home energy assessment",
      personalization:
        "Your utility offers low-cost audits — a blower-door test will pinpoint exactly where your heat is leaking before you spend on equipment.",
      effort: "trivial",
      origin: "library",
      revealed: true,
      sources: ["doe-energy-saver"],
    },
    {
      component_slug: "cold-climate-heat-pump",
      title: "Get quotes for a cold-climate heat pump",
      personalization:
        "Your gas furnace and central AC share ductwork, so one heat pump can replace both — and cold-climate models hold their output through a Virginia winter.",
      effort: "project",
      origin: "library",
      revealed: true,
      sources: ["rewiring-america", "energy-star-hvac"],
    },
    {
      component_slug: null,
      title: "Check whether your panel has room for electrification",
      personalization:
        "Older homes sometimes need a panel upgrade before adding electric equipment. A quick look now avoids a surprise later.",
      effort: "trivial",
      origin: "authored",
      revealed: false,
      sources: [],
    },
    {
      component_slug: "federal-heat-pump-credit",
      title: "Stack the federal heat-pump tax credit",
      personalization:
        "The 25C credit can cover a meaningful slice of a heat-pump install — worth confirming the current amount before you sign.",
      effort: "trivial",
      origin: "library",
      revealed: false,
      sources: ["irs-25c"],
    },
  ],
  open_questions: [
    "How old is your gas furnace? That drives whether to replace now or wait.",
    "Is anyone home during the day? It changes how much a smart thermostat helps.",
  ],
  sources: [
    {
      slug: "doe-energy-saver",
      label: "Energy Saver: Weatherize",
      url: "https://www.energy.gov/energysaver/weatherize",
      publisher: "U.S. Department of Energy",
      last_verified: "2026-06-01",
    },
    {
      slug: "rewiring-america",
      label: "Electrify: Heat Pumps",
      url: "https://www.rewiringamerica.org/electrify-home-guide",
      publisher: "Rewiring America",
      last_verified: "2026-05-15",
    },
    {
      slug: "energy-star-hvac",
      label: "ENERGY STAR: Heat Pumps",
      url: "https://www.energystar.gov/products/heat_pumps",
      publisher: "ENERGY STAR",
      last_verified: "2026-05-20",
    },
    {
      slug: "irs-25c",
      label: "Energy Efficient Home Improvement Credit",
      url: "https://www.irs.gov/credits-deductions/energy-efficient-home-improvement-credit",
      publisher: "Internal Revenue Service",
      last_verified: "2026-04-30",
    },
  ],
};

// ---------------------------------------------------------------------------
// learning — the study guide (background full, action_plan collapsed/empty)

const learningProfile = profileFrom([
  { op: "set", slot: "tenure", value: "renter", provenance: "stated" },
  {
    op: "set",
    slot: "motivation_weights",
    value: { cost: 0.1, carbon: 0.15, comfort: 0.1, resilience: 0.05, learning: 0.6 },
    provenance: "inferred",
  },
  { op: "append", slot: "topics_discussed", value: "solar", provenance: "inferred" },
  { op: "append", slot: "topics_discussed", value: "community-solar", provenance: "inferred" },
  {
    op: "append",
    slot: "preferences",
    value: { entity: "tech:solar", stance: "curious", provenance: "stated" },
    provenance: "stated",
  },
]);

const learning: ReportDocument = {
  meta: {
    doc_version: DOC_VERSION,
    generated_at: GENERATED_AT,
    lane_framing: "learning",
    readiness: { score: 100, ready: true },
  },
  about_you: learningProfile,
  your_goals: {
    headline: "How home solar actually works",
    intro:
      "You're renting and mostly want to understand the space before anything else — no pressure to act. Here's the plain-language version of how solar works and what the options look like for someone who doesn't own a roof.",
  },
  background: [
    {
      component_slug: "solar-how-it-works",
      title: "How rooftop solar turns sunlight into a lower bill",
      body_md:
        "Solar panels make **direct current** from sunlight; an *inverter* converts it to the alternating current your home uses. Anything you don't use flows back to the grid.\n\nThe key idea is **net metering**: when your panels overproduce, your meter effectively runs backward, banking credit you draw on at night.",
      origin: "library",
      sources: ["nrel-solar-basics"],
      figures: [],
    },
    {
      component_slug: "community-solar-explained",
      title: "Community solar: sharing a solar farm without a roof",
      body_md:
        'You don\'t need to own a roof to benefit. **Community solar** lets you subscribe to a share of a nearby solar farm and get credits on your utility bill for its output.\n\nFor renters, this is usually the only way to "go solar" — no installation, and you can typically cancel when you move.',
      origin: "library",
      sources: ["doe-community-solar"],
      figures: [],
    },
    {
      component_slug: null,
      title: "What to ask a landlord before assuming solar is off the table",
      body_md:
        "Some landlords will consider panels if a tenant covers or shares the cost, especially on a long lease. It's rare, but worth one conversation before ruling it out.",
      origin: "authored",
      sources: [],
      figures: [],
    },
  ],
  action_plan: [],
  open_questions: [
    "Roughly how long do you expect to stay at your current place?",
    "Does your utility offer a community-solar program where you are?",
  ],
  sources: [
    {
      slug: "nrel-solar-basics",
      label: "Solar Photovoltaic Basics",
      url: "https://www.nrel.gov/research/re-photovoltaics.html",
      publisher: "National Renewable Energy Laboratory",
      last_verified: "2026-06-10",
    },
    {
      slug: "doe-community-solar",
      label: "Community Solar Basics",
      url: "https://www.energy.gov/communitysolar/community-solar-basics",
      publisher: "U.S. Department of Energy",
      last_verified: "2026-06-05",
    },
  ],
};

// ---------------------------------------------------------------------------
// mixed — two close motivations (cost + carbon)

const mixedProfile = profileFrom([
  { op: "set", slot: "tenure", value: "owner", provenance: "stated" },
  {
    op: "set",
    slot: "region",
    value: { state: "MD", city: "Silver Spring" },
    provenance: "stated",
  },
  { op: "set", slot: "housing_type", value: "single-family", provenance: "stated" },
  {
    op: "set",
    slot: "motivation_weights",
    value: { cost: 0.4, carbon: 0.38, comfort: 0.1, resilience: 0.06, learning: 0.06 },
    provenance: "inferred",
  },
  { op: "set", slot: "timeline", value: "this-year", provenance: "stated" },
  {
    op: "append",
    slot: "goals",
    value: { text: "Spend less and cut our carbon footprint" },
    provenance: "stated",
  },
  {
    op: "append",
    slot: "constraints",
    value: { text: "Roof is partly shaded in the afternoon", durable: true },
    provenance: "inferred",
  },
  { op: "append", slot: "topics_discussed", value: "solar", provenance: "inferred" },
  { op: "append", slot: "topics_discussed", value: "heat-pump", provenance: "inferred" },
]);

const mixed: ReportDocument = {
  meta: {
    doc_version: DOC_VERSION,
    generated_at: GENERATED_AT,
    lane_framing: "mixed",
    readiness: { score: 75, ready: true },
  },
  about_you: mixedProfile,
  your_goals: {
    headline: "Lower bills and lower carbon — the same two upgrades do both",
    intro:
      "You care about saving money and cutting emissions about equally, and the good news is they point at the same short list. We've ordered it so the steps that do the most on both fronts come first.",
  },
  background: [
    {
      component_slug: "electrify-one-at-a-time",
      title: "Why electrifying one appliance at a time works",
      body_md:
        "You don't have to do everything at once. Replacing whatever breaks next with its efficient electric version — furnace to heat pump, water heater to heat-pump water heater — captures most of the savings and carbon cuts without a big single bill.",
      origin: "library",
      sources: ["rewiring-america"],
      figures: [],
    },
  ],
  action_plan: [
    {
      component_slug: "heat-pump-water-heater",
      title: "Swap in a heat-pump water heater when yours is due",
      personalization:
        "It's the highest cost-and-carbon win per dollar for most single-family homes, and it doesn't depend on your shaded roof.",
      effort: "project",
      origin: "library",
      revealed: true,
      sources: ["energy-star-hpwh"],
    },
    {
      component_slug: "solar-shading-assessment",
      title: "Get a shading assessment before committing to solar",
      personalization:
        "Your afternoon shade doesn't rule solar out, but it changes the math — a quick assessment tells you whether panels still pay off here.",
      effort: "trivial",
      origin: "library",
      revealed: true,
      sources: ["nrel-solar-basics"],
    },
  ],
  open_questions: ["How old is your current water heater and furnace?"],
  sources: [
    {
      slug: "rewiring-america",
      label: "Electrify Everything at Home",
      url: "https://www.rewiringamerica.org/electrify-home-guide",
      publisher: "Rewiring America",
      last_verified: "2026-05-15",
    },
    {
      slug: "energy-star-hpwh",
      label: "ENERGY STAR: Heat Pump Water Heaters",
      url: "https://www.energystar.gov/products/water_heaters/high_efficiency_electric_storage_water_heaters",
      publisher: "ENERGY STAR",
      last_verified: "2026-05-20",
    },
    {
      slug: "nrel-solar-basics",
      label: "Solar Photovoltaic Basics",
      url: "https://www.nrel.gov/research/re-photovoltaics.html",
      publisher: "National Renewable Energy Laboratory",
      last_verified: "2026-06-10",
    },
  ],
};

// ---------------------------------------------------------------------------
// minimal — the degenerate document (every optional section empty)

const minimalProfile = profileFrom([
  {
    op: "set",
    slot: "motivation_weights",
    value: { cost: 0, carbon: 0, comfort: 0, resilience: 0, learning: 1 },
    provenance: "inferred",
  },
]);

const minimal: ReportDocument = {
  meta: {
    doc_version: DOC_VERSION,
    generated_at: GENERATED_AT,
    lane_framing: "learning",
    readiness: { score: 20, ready: false },
  },
  about_you: minimalProfile,
  your_goals: {
    headline: "A place to start",
    intro:
      "We didn't gather much yet, so this is a light starting point rather than a full plan. Come back to the conversation any time and it'll fill in.",
  },
  background: [],
  action_plan: [],
  open_questions: [],
  sources: [],
};

// ---------------------------------------------------------------------------

export const REPORT_DOCUMENT_FIXTURES = {
  lower_bills: lowerBills,
  learning,
  mixed,
  minimal,
} satisfies Record<string, ReportDocument>;

export type ReportFixtureKey = keyof typeof REPORT_DOCUMENT_FIXTURES;

export const REPORT_FIXTURE_KEYS = Object.keys(REPORT_DOCUMENT_FIXTURES) as ReportFixtureKey[];
