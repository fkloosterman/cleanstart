/**
 * Candidate filtering + scoring (WP3.3, design §6.1). Pure functions: given the
 * content library and a profile, decide which components are *eligible* and
 * rank them, so the composer (WP3.6) and chat grounding (WP3.4) receive a small,
 * pre-vetted, ordered shortlist. "Quality is won before the model runs" — a bad
 * model day produces a mediocre ordering, never a wrong fact.
 *
 * The pipeline, in order:
 *   1. Eligibility — hard filters: status, tenure, housing, region prefix,
 *      ruled-out suppression, and prerequisite holdback (§3.1, §6.1).
 *   2. Score — `weights · impact + interest boost − effort penalty` (§6.1).
 *   3. Rank — score desc (slug tie-break for stability), take the top N.
 *
 * The scoring constants are tuning knobs (like WP2.1's placeholder lane copy):
 * clearly-marked defaults on a shared scale, to be calibrated by the composer
 * evals (WP3.6). Changing them is a data edit, not a logic change.
 */

import type { ContentComponent } from "@/lib/content/schema";
import type { MotivationWeights, SessionProfile } from "@/lib/profile/registry";
import { slotValue } from "@/lib/profile/normalize";
import { blendImpactWeights, deriveLane } from "@/lib/lanes/derive";

// ---------------------------------------------------------------------------
// Tuning constants (placeholder-quality; calibrated in WP3.6)

/**
 * The impact vector's dimensions — a subset of the motivation dimensions (it
 * has no `learning` axis). The dot product runs over these four; a user's
 * `learning` weight therefore doesn't move impact ranking, which is by design:
 * the learning lane is a study guide ordered by interest, not project impact.
 */
export const IMPACT_DIMENSIONS = ["cost", "carbon", "comfort", "resilience"] as const;

/** Effort subtracts from score — costlier actions rank below equal-impact cheap ones. */
export const EFFORT_PENALTY: Record<ContentComponent["effort"], number> = {
  trivial: 0,
  weekend: 0.1,
  project: 0.25,
  major: 0.5,
};

type InterestStance = "curious" | "interested" | "priority";

/** A stance toward a technology adds to the score of components about it. */
export const INTEREST_BOOST: Record<InterestStance, number> = {
  curious: 0.1,
  interested: 0.25,
  priority: 0.5,
};

/** Default shortlist size handed to the composer (§6.1: "top ~15"). */
export const DEFAULT_CANDIDATE_LIMIT = 15;

// ---------------------------------------------------------------------------
// Candidate context — the clean inputs the pure filter/scorer need, extracted
// from the profile so the US-only region assumption and the slot-envelope
// reads live in one adapter, not scattered through the scoring math.

export interface CandidateContext {
  /** owner / renter, or null (tenure "other"/unknown matches only untargeted content). */
  tenure: "owner" | "renter" | null;
  housingType: string | null;
  /** The user's region and all its prefixes, e.g. {"US","US-VA"} (§3.5 prefix match). */
  regionPrefixes: ReadonlySet<string>;
  /** tech slug → stance, for the interest boost (only "interested"/"priority"/"curious"). */
  interests: ReadonlyMap<string, InterestStance>;
  /** tech slugs the user ruled out — components about them are suppressed. */
  ruledOutTechs: ReadonlySet<string>;
  /** Component slugs already satisfied (done). Empty until item tracking (WP4). */
  satisfied: ReadonlySet<string>;
  /** Blended motivation weights for the impact dot product (WP2.1). */
  weights: MotivationWeights;
}

/**
 * The user's region prefix set. The app is US-only for launch (DMV pilot), so
 * country "US" is always present; a known state adds "US-<STATE>". This is the
 * one place that assumption lives.
 */
export function regionPrefixes(profile: SessionProfile): Set<string> {
  const set = new Set<string>(["US"]);
  const region = slotValue(profile, "region");
  const state = region?.state?.trim().toUpperCase();
  if (state) set.add(`US-${state}`);
  return set;
}

/** Extract the clean candidate context from a profile (derives lane/weights). */
export function buildCandidateContext(
  profile: SessionProfile,
  satisfied: ReadonlySet<string> = new Set(),
): CandidateContext {
  const rawTenure = slotValue(profile, "tenure");
  const tenure = rawTenure === "owner" || rawTenure === "renter" ? rawTenure : null;

  const interests = new Map<string, InterestStance>();
  const ruledOutTechs = new Set<string>();
  for (const pref of slotValue(profile, "preferences") ?? []) {
    if (!pref.entity.startsWith("tech:")) continue; // only tech stances map to components
    const tech = pref.entity.slice("tech:".length);
    if (pref.stance === "ruled_out") ruledOutTechs.add(tech);
    else interests.set(tech, pref.stance);
  }

  const { framing } = deriveLane(slotValue(profile, "motivation_weights"));
  const weights = blendImpactWeights(slotValue(profile, "motivation_weights"), framing);

  return {
    tenure,
    housingType: slotValue(profile, "housing_type"),
    regionPrefixes: regionPrefixes(profile),
    interests,
    ruledOutTechs,
    satisfied,
    weights,
  };
}

// ---------------------------------------------------------------------------
// Eligibility (hard filters)

/** Empty targeting array = applies to all; otherwise the user's value must be in it. */
function targetingMatches(componentValues: string[], userValue: string | null): boolean {
  if (componentValues.length === 0) return true;
  return userValue !== null && componentValues.includes(userValue);
}

function regionMatches(componentRegions: string[], userPrefixes: ReadonlySet<string>): boolean {
  if (componentRegions.length === 0) return true;
  return componentRegions.some((r) => userPrefixes.has(r));
}

/** Every hard filter except prerequisites (which need the surviving pool). */
function passesTargeting(c: ContentComponent, ctx: CandidateContext): boolean {
  if (c.status !== "published") return false;
  if (!targetingMatches(c.tenures, ctx.tenure)) return false;
  if (!targetingMatches(c.housing_types, ctx.housingType)) return false;
  if (!regionMatches(c.regions, ctx.regionPrefixes)) return false;
  // Ruled-out suppression: a component about any ruled-out technology is hidden.
  if (c.technologies.some((t) => ctx.ruledOutTechs.has(t))) return false;
  return true;
}

/**
 * Hold back components whose prerequisites aren't met. "Met" = the prerequisite
 * is already satisfied (done) OR is itself in the surviving pool (trivially
 * bundled — shown alongside, §3.1). Iterated to a fixpoint so a broken link
 * anywhere in a chain holds back everything downstream of it.
 */
function filterPrerequisites(
  components: ContentComponent[],
  satisfied: ReadonlySet<string>,
): ContentComponent[] {
  let surviving = components;
  for (;;) {
    const present = new Set(surviving.map((c) => c.slug));
    const next = surviving.filter((c) =>
      c.prerequisites.every((p) => satisfied.has(p) || present.has(p)),
    );
    if (next.length === surviving.length) return next;
    surviving = next;
  }
}

/** All eligible components (unranked): targeting filters, then prerequisite holdback. */
export function filterEligible(
  components: ContentComponent[],
  ctx: CandidateContext,
): ContentComponent[] {
  const targeted = components.filter((c) => passesTargeting(c, ctx));
  return filterPrerequisites(targeted, ctx.satisfied);
}

// ---------------------------------------------------------------------------
// Scoring

export interface ScoreBreakdown {
  impact: number;
  interest: number;
  effort: number;
}

export interface ScoredCandidate {
  component: ContentComponent;
  score: number;
  breakdown: ScoreBreakdown;
}

/** `weights · impact + interest boost − effort penalty` (§6.1). */
export function scoreComponent(c: ContentComponent, ctx: CandidateContext): ScoredCandidate {
  const impact = IMPACT_DIMENSIONS.reduce((sum, dim) => sum + ctx.weights[dim] * c.impact[dim], 0);

  let interest = 0;
  for (const tech of c.technologies) {
    const stance = ctx.interests.get(tech);
    if (stance) interest += INTEREST_BOOST[stance];
  }

  const effort = EFFORT_PENALTY[c.effort];
  return {
    component: c,
    score: impact + interest - effort,
    breakdown: { impact, interest, effort },
  };
}

/**
 * The full pipeline: eligible components, scored and ranked (score desc, slug
 * tie-break for stable ordering), capped at `limit`. This is the candidate
 * shortlist the composer and chat grounding consume.
 */
export function rankCandidates(
  components: ContentComponent[],
  ctx: CandidateContext,
  limit: number = DEFAULT_CANDIDATE_LIMIT,
): ScoredCandidate[] {
  return filterEligible(components, ctx)
    .map((c) => scoreComponent(c, ctx))
    .sort((a, b) => b.score - a.score || a.component.slug.localeCompare(b.component.slug))
    .slice(0, limit);
}

/** Convenience: build the context from a profile and rank in one call. */
export function selectCandidates(
  components: ContentComponent[],
  profile: SessionProfile,
  options: { satisfied?: ReadonlySet<string>; limit?: number } = {},
): ScoredCandidate[] {
  const ctx = buildCandidateContext(profile, options.satisfied);
  return rankCandidates(components, ctx, options.limit);
}
