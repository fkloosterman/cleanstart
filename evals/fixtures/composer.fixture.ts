/**
 * Composer eval fixtures (WP3.6, design §6.5).
 *
 * Each fixture is a synthetic content library plus a household profile; the
 * runner selects candidates, calls the real composition model, runs the
 * validation pipeline, assembles the `ReportDocument`, and asserts on it. The
 * four "done when" properties are checked directly:
 *  - slug validity — every library item is a real candidate;
 *  - interest coverage — an interested technology is represented;
 *  - ruled-out suppression — a declined technology never appears;
 *  - reveal count — progressive disclosure holds.
 *
 * The library is deliberately tiny and hand-built so the expected behavior is
 * obvious; it is not the production corpus.
 */

import { emptyProfile } from "@/lib/profile/normalize";
import { applyPatches, type ProfilePatch } from "@/lib/profile/patches";
import type { SessionProfile } from "@/lib/profile/registry";
import type { ContentComponent, ContentSource } from "@/lib/content/schema";
import { REVEALED_ITEM_COUNT } from "@/lib/report/composer";
import type { ComposerFixture } from "../types";

function profileFrom(patches: ProfilePatch[]): SessionProfile {
  return applyPatches(emptyProfile(), patches, "2026-07-12T00:00:00.000Z").profile;
}

type Impact = ContentComponent["impact"];

function comp(
  slug: string,
  kind: ContentComponent["kind"],
  effort: ContentComponent["effort"],
  technologies: string[],
  impact: Impact,
  extra: Partial<ContentComponent> = {},
): ContentComponent {
  return {
    slug,
    kind,
    title: slug.replace(/-/g, " "),
    summary: `A vetted overview of ${slug.replace(/-/g, " ")}.`,
    body_md: `## ${slug}\n\nPlain-language explainer body for ${slug}.`,
    technologies,
    lanes: [],
    tenures: [],
    housing_types: [],
    regions: [],
    prerequisites: [],
    effort,
    impact,
    sources: ["doe-energy-saver"],
    last_verified: "2026-06-01",
    status: "published",
    version: 1,
    media: [],
    ...extra,
  };
}

const SOURCES: ContentSource[] = [
  {
    slug: "doe-energy-saver",
    label: "Energy Saver",
    url: "https://www.energy.gov/energysaver",
    publisher: "U.S. Department of Energy",
    last_verified: "2026-06-01",
  },
];

// A cost-motivated Virginia homeowner who prioritizes heat pumps and has ruled
// out EVs. The heat-pump component should surface; the EV one must not.
const lowerBillsOwner = profileFrom([
  { op: "set", slot: "tenure", value: "owner", provenance: "stated" },
  { op: "set", slot: "region", value: { state: "VA", city: "Arlington" }, provenance: "stated" },
  {
    op: "set",
    slot: "motivation_weights",
    value: { cost: 0.7, carbon: 0.15, comfort: 0.1, resilience: 0.03, learning: 0.02 },
    provenance: "inferred",
  },
  {
    op: "append",
    slot: "goals",
    value: { text: "Cut my winter heating bills" },
    provenance: "stated",
  },
  {
    op: "append",
    slot: "preferences",
    value: { entity: "tech:heat-pump", stance: "priority", provenance: "stated" },
    provenance: "stated",
  },
  {
    op: "append",
    slot: "preferences",
    value: { entity: "tech:ev", stance: "ruled_out", provenance: "stated" },
    provenance: "stated",
  },
  { op: "append", slot: "topics_discussed", value: "heat-pump", provenance: "inferred" },
]);

const LIBRARY: ContentComponent[] = [
  comp("weatherization-basics", "explainer", "weekend", ["weatherization"], {
    cost: 2,
    carbon: 1,
    comfort: 2,
    resilience: 0,
  }),
  comp("home-energy-audit", "action", "trivial", [], {
    cost: 1,
    carbon: 1,
    comfort: 1,
    resilience: 0,
  }),
  comp("cold-climate-heat-pump", "action", "project", ["heat-pump"], {
    cost: 2,
    carbon: 2,
    comfort: 3,
    resilience: 1,
  }),
  comp("rooftop-solar-basics", "explainer", "major", ["solar"], {
    cost: 2,
    carbon: 3,
    comfort: 0,
    resilience: 1,
  }),
  // Ruled-out: the user declined EVs, so this must be filtered out entirely.
  comp("home-ev-charging", "action", "weekend", ["ev"], {
    cost: 1,
    carbon: 2,
    comfort: 0,
    resilience: 0,
  }),
];

const fixture: ComposerFixture = {
  type: "composer",
  name: "composer: lower-bills owner, heat-pump priority, EV ruled out",
  profile: lowerBillsOwner,
  components: LIBRARY,
  sources: SOURCES,
  digest:
    "- Owns a home in Arlington, VA\n- Wants to cut winter heating bills\n- Keen on heat pumps; not interested in an EV",
  expect: [
    { kind: "slugs-valid" },
    { kind: "reveal-max", max: REVEALED_ITEM_COUNT },
    { kind: "min-items", count: 2 },
    { kind: "covers-tech", tech: "heat-pump" },
    { kind: "suppresses-tech", tech: "ev" },
  ],
};

export default fixture;
