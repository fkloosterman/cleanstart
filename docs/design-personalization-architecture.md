# Clean Start — Personalization & Trust Architecture

**Status:** Draft for team review — no code implements this yet
**Date:** 2026-07-08
**Audience:** technical. For the plain-language version, see
[design-overview-non-technical.md](design-overview-non-technical.md).

This document consolidates the design for taking Clean Start from a
prompt-driven chat + one-shot report to a grounded, personalized,
long-term product. It covers: a structured session profile, motivation
"lanes", a curated content library (including images and figure
templates), a report composer with strict contracts, a living report
built from action items, a follow-up engine, guest support, and the
extensibility/versioning rules that keep all of it safe to evolve.

---

## 1. Motivation

The improvements we want are not independent features:

1. Ground responses in trusted, curated sources.
2. Replace the fixed "3 assistant turns" report gate with a real
   sufficiency signal.
3. Identify the user's primary motivation and order everything by it;
   avoid overwhelming checklists; introduce recommendations over time.
4. Make the report a beginning, not an end: follow-up research,
   reminders, long-term engagement.
5. Build a structured user profile per session (with opt-in carryover)
   and visualize it in a sidebar.
6. Assemble agent context dynamically from profile, sources, and
   motivation; keep chat answers brief and momentum-focused.
7. Build reports from pre-defined components to control cost and
   quality.

Most of these are facets of **one architectural move**: replacing the
implicit, throwaway conversation state with an explicit, structured
**session profile** that drives everything else.

### Current state (what this replaces)

- Understanding of the user = a `persona` enum + an assistant-turn
  counter selecting a prompt stage (`src/lib/prompts/chat.ts`).
- Report gate = `assistant messages >= 3` (UI check in the chat routes).
- Report = one `generateText` call over the raw transcript, parsed by a
  fragile regex-repair JSON extractor
  (`src/lib/report.functions.ts`).
- Profile table stores only `persona`.

---

## 2. Design overview

```
                       ┌──────────────────────┐
   chat turn ──────────►  Profile Extractor   │  cheap LLM side-call per turn
                       └──────────┬───────────┘
                                  ▼
                       ┌──────────────────────┐
                       │   Session Profile     │  slots + preferences +
                       │   (structured)        │  motivation weights
                       └───┬────┬────┬────┬───┘
                           │    │    │    │
        readiness = slot   │    │    │    └── sidebar visualization
        coverage           │    │    └── lane selection (derived)
                           │    ▼
                       ┌──────────────────────┐     ┌────────────────────┐
                       │   Context Builder     │◄────│  Content Library    │
                       │  (system prompt asm.) │     │  components, media, │
                       └──────────────────────┘     │  figure templates   │
                                                    └─────────┬──────────┘
                                                              ▼
                                                    ┌────────────────────┐
                                                    │  Report Composer    │  selects + personalizes,
                                                    │  (strict contract)  │  never authors facts
                                                    └─────────┬──────────┘
                                                              ▼
                                                    ┌────────────────────┐
                                                    │  Action Items /     │  living report,
                                                    │  Follow-up Engine   │  follow-up sessions,
                                                    └────────────────────┘  triggers
```

The session profile is the keystone. Once it exists:

- **readiness** is a pure function over it,
- **lane** is a derived field of it,
- **the sidebar** renders it,
- **the context builder** serializes it,
- **the composer** filters and ranks content by it,
- **the follow-up engine** updates it.

### The trust principle (applies everywhere)

> The model may **select** and **personalize**; the library owns the
> **facts**. Deterministic code decides what is _eligible_; the model
> decides what is _chosen_ and _why it fits_; deterministic code
> validates and renders.

This one rule governs chat grounding, image display, figure generation,
report composition, and follow-up briefs.

---

## 3. Content library

### 3.1 Components

```ts
type ContentComponent = {
  slug: string; // "community-solar-basics", stable forever
  kind: "action" | "explainer" | "incentive" | "resource" | "caveat";
  title: string;
  summary: string; // 2-3 sentences — injected into chat context
  body_md: string; // full text — only reports and deep-dives use this
  // targeting tags (empty array = applies to all)
  technologies: string[]; // "solar", "heat-pump", "ev", "insulation", "behavior"
  lanes: LaneId[];
  tenures: ("owner" | "renter")[];
  housing_types: string[]; // "single-family", "apartment", "condo", "mobile"
  regions: string[]; // "US", "US-MA", "CA-ON"; matched by prefix
  // ranking & sequencing
  prerequisites: string[]; // slugs; unmet = held back (progressive disclosure)
  effort: "trivial" | "weekend" | "project" | "major";
  impact: {
    cost: 0 | 1 | 2 | 3;
    carbon: 0 | 1 | 2 | 3;
    comfort: 0 | 1 | 2 | 3;
    resilience: 0 | 1 | 2 | 3;
  };
  // trust & lifecycle
  sources: { label: string; url: string; publisher: string }[];
  last_verified: string; // ISO date, surfaced in UI
  expires?: string; // incentives with deadlines → follow-up trigger fuel
  status: "draft" | "published" | "retired";
  version: number;
  media: string[]; // media slugs (see 3.2)
};
```

Key choices:

- **The per-dimension `impact` vector is the ranking engine.**
  Recommendation ordering by motivation becomes a dot product with the
  user's motivation weights — a sort, not a prompt.
- **`prerequisites` implements "don't overwhelm."** Only components
  whose prerequisites are met (or trivially bundled) surface; the rest
  are released over time by the follow-up engine.
- **`summary` vs `body_md` is the token-cost control.** Chat context
  gets summaries (~50 tokens each); full bodies are reserved for report
  rendering and follow-up deep-dives.

### 3.2 Media (curated images)

```ts
type ContentMedia = {
  slug: string; // "heat-pump-cycle-diagram"
  kind: "diagram" | "photo" | "illustration";
  storage_path: string; // Supabase Storage
  alt: string; // required — CI-validated
  caption: string;
  credit: { source: string; license: string }; // required — we are republishing
  technologies: string[];
  regions: string[];
};
```

In chat, the agent gets one tool — `show_figure(slug)` — whose
resolution is a library lookup. The agent can show the heat-pump
diagram but can never emit an arbitrary URL. In reports, the renderer
resolves slugs to storage URLs. The composer only ever handles slugs.

### 3.3 Figure templates (dynamic figures)

Templates are **code** — React/SVG components with a Zod parameter
schema. The model supplies parameters only, never markup.

```ts
type FigureTemplate = {
  id: string; // never deleted or reused (see §11)
  params_schema: z.ZodType; // invalid params → figure dropped, report intact
  render: (params) => JSX;
};
```

First templates (all draw parameters from data we already trust —
profile slots and component metadata, zero model-invented numbers):

- **effort-vs-impact matrix** of the user's action items,
- **action sequence timeline** (prerequisite chains),
- **readiness gauge** (from the readiness function).

Avoid quantitative-looking charts (dollar axes): charts imply
precision, and product rules forbid quoting prices. If a payback figure
is wanted, its axes are qualitative by design ("sooner ↔ later").

### 3.4 Authoring workflow: git-first

Components and media metadata live as markdown/YAML in a `content/`
directory in the repo, validated by a Zod schema in CI, and synced to
Supabase tables on deploy (idempotent upsert-by-slug). PRs give review;
git gives history; no admin UI needed. Move to a CMS only if
non-developer curators join.

Three things matter more than retrieval mechanics: the **content
pipeline** (who curates, how updates land), **freshness metadata**
(jurisdiction + last-verified on every doc, surfaced in UI), and
**citations** (grounding only builds trust if users see sources).

### 3.5 Retrieval

Tag-filtered Postgres queries — region/tenure/housing/lane/technology
are _categorical_ keys, and the corpus is small and curated. No
embeddings until the corpus outgrows tags; Supabase has pgvector built
in, so the upgrade path is zero new infrastructure.

### 3.6 Starting points (presets)

The app already offers starter chips (hardcoded per tenure in
`src/routes/chat.index.tsx`). In the new design a preset is **a
profile pre-fill plus a first message**, not just canned text:

```ts
type Preset = {
  slug: string;
  label: string; // "Lower my energy bills"
  category: string; // shown as chip grouping
  first_message: string; // sent as the user's opening message
  profile_patches: ProfilePatch[]; // e.g. motivation weight hints,
  // tech interest (stance: "curious"),
  // provenance: "stated"
  // targeting — which users see this preset
  tenures: ("owner" | "renter")[];
  regions: string[];
};
```

Picking "Lower my energy bills as a renter" doesn't just send a
message — it nudges `motivation_weights` toward cost and records a
tech/topic interest, so the extractor starts warm and the _first_
agent turn already has real context instead of spending two turns
rediscovering why the user came.

Presets are curated content: they live in the same git-first `content/`
directory (CI-validated, synced on deploy) and are filtered by the
upfront slots (§4.8) before display. Curators should offer both axes —
motivation-flavored presets ("I want backup power during outages")
and technology-flavored ones ("Is solar worth it?") — because
motivation presets are the single cheapest lane-detection signal we
can get. The current hardcoded `CHIPS` list is the interim
implementation and migrates into the library in phase 3.

---

## 4. Session profile

### 4.1 The slot envelope

Every slot is a value plus metadata; provenance and confidence drive
both the readiness function and the sidebar.

```ts
type Slot<T> = {
  value: T | null;
  provenance: "stated" | "inferred" | "edited" | "propagated" | null;
  confidence: "high" | "low"; // two levels; finer granularity is false precision
  asked_at?: string; // set when the agent asked — prevents re-asking
  updated_at: string;
};
```

### 4.2 The slot registry (single source of truth)

Slots are defined declaratively **once**; everything derives from the
registry — the Zod schema, the extractor prompt (so the extractor
learns new slots automatically), the sidebar renderer, and the
durable-propagation whitelist.

```ts
const SLOT_REGISTRY = {
  tenure: {
    type: z.enum(["owner", "renter", "other"]),
    extractor_hint: "Whether the user owns or rents their home",
    sidebar: { label: "Your situation", group: "context" },
    durable: true,
    elicitation: "upfront", // see §4.8: collected before chat, not extracted
  },
  // adding a slot = adding an entry here, nothing else
} satisfies Record<string, SlotDef>;
```

Each slot declares how it is elicited: `"upfront"` (dedicated UI step
before chat, §4.8), `"conversational"` (the extractor, the default),
or `"either"`.

Initial slots:

| Group   | Slot                 | Type                                                          | Durable                |
| ------- | -------------------- | ------------------------------------------------------------- | ---------------------- |
| context | `tenure`             | owner / renter / other                                        | yes                    |
| context | `housing_type`       | single-family / apartment / condo / mobile                    | yes                    |
| context | `region`             | coarse: state/province — never an address                     | yes                    |
| context | `household`          | size, decision authority (sole/shared/landlord/hoa)           | yes                    |
| context | `existing_systems`   | heating, cooling, has_solar, has_ev                           | yes                    |
| intent  | `motivation_weights` | vector, see §5                                                | yes (primary only)     |
| intent  | `timeline`           | ready-now / this-year / exploring                             | no                     |
| intent  | `budget_posture`     | minimal / moderate / willing-to-invest (posture, not dollars) | no                     |
| lists   | `goals`              | append-only, tagged free text                                 | no                     |
| lists   | `constraints`        | append-only, tagged free text                                 | promotion rule, §4.6   |
| lists   | `preferences`        | see 4.3                                                       | propagation rule, §4.6 |
| lists   | `topics_discussed`   | technology tags touched                                       | no                     |

### 4.3 Preferences (stances)

A generic record for the user's disposition toward **options** (things
they can accept or decline). Facts (tenure, region) never get stances.

```ts
type Preference = {
  entity: string; // namespaced: "tech:solar", "approach:diy", "financing:loan"
  stance: "curious" | "interested" | "priority" | "ruled_out";
  note?: string; // "roof too shaded"
  provenance: "stated" | "inferred" | "edited";
};
```

Rules:

- **Default is absence.** No record = unknown. Absence is a neutral
  prior in scoring (no boost, no suppression) and is what turns
  playbook `priority_questions` into things the agent asks.
- **Never infer `ruled_out` from silence.** A user who hasn't mentioned
  EVs has not declined them.
- The composer must _cover_ all `interested`+ technologies and remains
  free to introduce unmentioned ones that score well — that's the app
  doing its job.
- `ruled_out` is a suppression signal everywhere: the agent stops
  pitching it, the composer excludes it, and action-item dismissals
  (with reasons) write back into preferences so future sessions
  inherit the "no". A profile that remembers "no" is a bigger trust
  win than one that remembers "yes".

### 4.4 Extraction

After each user turn, a cheap model call receives the current profile +
the last exchange and returns **patch operations** (`set`, `append`,
`clear`) — not a full profile. Hard rules:

- The extractor may never overwrite a slot with `provenance: "edited"`
  (user corrections are sacred).
- `propagated` values start at `confidence: "low"` so the agent
  naturally re-confirms them ("still in Massachusetts?").

### 4.5 Readiness (replaces the 3-turn gate)

```ts
function readiness(profile: SessionProfile, lane: LanePlaybook): ReadinessResult;
// returns { score: 0-100, missing: SlotName[], ready: boolean }
```

Deterministic, explainable, testable without a model. The `missing`
array powers three things: the sidebar shows exactly what's unknown,
the context builder tells the agent what to learn next, and the report
button's disabled state can say _why_.

**Ratchet policy:** persist `readiness_reached_at` on the session and
never revoke a reached gate, even if a later schema change adds new
required slots. A gate that moves backwards reads as a bug.

### 4.6 Durable propagation

`profiles.durable_profile JSONB` holds only the slow-changing subset
(registry `durable: true` slots), written at session end with explicit
user opt-in. Goals, timeline, budget posture, and topics stay
session-scoped — a new conversation is _for_ those; copying them
would open session two with stale intent.

**Consent granularity.** The session-end opt-in is a single yes/no,
but rendered _with_ the values shown ("Save: renter · Boston, MA ·
gas heat · no solar?") so consent is informed. Per-slot control lives
on the **read side** instead: at next session start, durable values
arrive as `provenance: "propagated"`, `confidence: "low"`, shown as
pre-filled pills with a "change" tap — the user re-confirms or
corrects each value cheaply at the moment it's actually used, which
doubles as staleness protection ("still renting?"). A per-slot
checkbox list at session end would be friction with no added control.

**Preference propagation rule.** A preference propagates only if
(a) its `note` cites a durable fact about the home or place ("solar
ruled out — shaded roof"), or (b) the user set it via an explicit
sidebar edit. Inferred, unexplained stances stay session-scoped — a
passing `curious` about EVs should not follow the user forever.

**Constraint promotion rule.** Constraints are session-scoped by
default, but a constraint propagates (including mid-session, e.g.
when a follow-up deep-dive discovers one, §8.3) when it describes
**the home rather than the moment**: "100-amp electrical panel" and
"HOA restrictions" promote; "can't spend money until spring" does
not. The extractor tags constraints with a `durable: boolean` hint at
capture time, and promotion happens under the same session-end
consent as the rest of the durable profile.

### 4.7 Sidebar

Renders generically from the registry (groups, labels), including
stances ("You told us: no loans; solar ruled out — shaded roof").
**User-editable**: extraction errors become one-click corrections, and
edited values are the highest-provenance data we can get.

### 4.8 Upfront slots (required before chat)

Some slots are so fundamental that the first agent answer would be
wrong or generic without them. These are marked
`elicitation: "upfront"` in the registry and collected through
dedicated UI steps before the conversation starts — formalizing the
existing tenure/zip stepper in `src/routes/chat.index.tsx`.

Initially exactly two, matching today's flow:

- **`tenure`** — the card picker (owner / renter / not sure).
- **`region`** — the zip step. The zip resolves to
  `{ state, city, zip }`; the **zip is kept only for utility- and
  program-level matching** in the content library, is displayed only
  as city/state, and is never anything finer than zip (the existing
  "only your zip — never your address" promise holds). Skippable —
  a skipped region just means region-tagged content is filtered to
  national-level until the agent learns it later.

Rules:

- Upfront answers enter the profile as `provenance: "stated"`,
  `confidence: "high"` — the strongest signal we get, for free.
- **Returning users skip the steps**: durable-profile values pre-fill
  as `propagated` pills with a "change" affordance (the existing
  change-pills pattern), one tap to confirm rather than re-answer.
- **The bar for `upfront: true` is deliberately high.** Every added
  step costs conversion at the most fragile moment of the funnel. A
  slot qualifies only if the _very first_ response would mislead
  without it. Motivation, timeline, budget posture do not qualify —
  they're what the conversation is for. Expect this set to stay at
  two.

---

## 5. Lanes (motivation)

### 5.1 The vector is primary; the lane is derived

```ts
motivation_weights: Slot<{
  cost: number;
  carbon: number;
  comfort: number;
  resilience: number;
  learning: number;
}>;
// lane = argmax(weights) — derived, never stored as source of truth
```

This makes ambiguous sessions degrade gracefully:

- **Ranking** always uses the blended vector against component impact
  vectors — it cannot fail on ambiguity.
- **Question priority** merges the top two lanes' priority questions.
- **Narrative framing** is the only forced discrete choice: if the top
  two weights are within ~0.15, use a framing-only **"mixed"** playbook
  that names both goals explicitly and groups report sections by
  technology instead of motivation.

Weights can shift mid-session; everything downstream re-derives. The
sidebar shows motivation as editable.

### 5.2 The five lanes

| Lane             | User's core question                  | Report shape                                    |
| ---------------- | ------------------------------------- | ----------------------------------------------- |
| `lower_bills`    | "How do I spend less?"                | Ranked by payback speed; quick wins first       |
| `climate_impact` | "What actually reduces my footprint?" | Ranked by carbon impact; honest about magnitude |
| `comfort_health` | "Why is my home drafty/stuffy/cold?"  | Problem-first: diagnose, then fix               |
| `resilience`     | "What happens when the grid fails?"   | Scenario-first: outages, backup, independence   |
| `learning`       | "Help me understand this space"       | A study guide, not an action plan               |

```ts
type LanePlaybook = {
  id: LaneId;
  required_slots: SlotName[]; // readiness gate (learning needs almost none)
  priority_questions: SlotName[]; // what to probe next, in order
  impact_weights: Weights; // default weights when lane chosen explicitly
  report_sections: SectionSpec[]; // order + framing of report
  tone: string; // "lead with numbers" vs "lead with how-it-works"
};
```

Notes:

- **Lane ≠ persona.** Tenure is a _filter_ on eligible components; lane
  is a _sort/framing_. The current `PERSONA_NOTES` survives as the
  filter axis.
- **The `learning` lane is load-bearing**: it legitimizes users with no
  project intent, relaxes the readiness gate, and changes the report
  _type_ — preventing the system from pressuring browsers into fake
  action plans.

### 5.3 Chat behavior (context builder)

`buildSystemPrompt` evolves into
`buildContext(profile, lane, stage, retrievedContent)` — a pure,
snapshot-testable function assembling: base voice/boundaries + profile
summary + lane playbook + stage + retrieved component summaries +
"still need to learn: …".

On brevity: answer briefly and genuinely, end with a fork ("want the
deeper version now, or shall I note it for your report?"), and always
go deep when the user pushes. _"I'll explain that in the report"_ as a
stated policy reads as withholding. The conversation must stand on its
own; the report earns the **organization**, not exclusive access to
the substance.

### 5.4 Structured questions (clickable answer options)

When the agent asks a question, it can render suggested answers as
tappable buttons — with free-form input always available alongside.
Mechanism: one tool exposed to the chat model:

```ts
ask_user({
  question: string,
  slot?: SlotName,                 // if set: options derive from the registry enum —
                                   // code fills them in, the model doesn't enumerate
  options?: { label: string; patch?: ProfilePatch }[],  // for non-slot questions
  allow_free_text: true,           // always true; options are suggestions, not a form
})
```

Why this is more than a UI nicety:

- **A button tap is typed data.** Clicking "I rent" applies the slot
  patch directly with `provenance: "stated"`, `confidence: "high"` —
  no extractor call, no misparse risk. The tap's label is also sent as
  the user message so the transcript stays natural.
- **Slot-targeted questions are the reliable path for a weak model.**
  Emitting `ask_user({ slot: "timeline" })` is a far easier
  structured-output task than composing a well-formed option list;
  the registry supplies labels deterministically.
- **Graceful degradation both ways.** If the model asks in plain text
  without the tool, the conversation works as today (extractor catches
  the answer). If the user ignores the buttons and types, the
  extractor handles it. Buttons are an accelerator, never a gate.

Guardrails: at most ~4 options; never render options as the only way
to answer; and don't turn consecutive turns into a survey — the
playbook's `priority_questions` should interleave with genuine
conversation, not batch into a form.

Persistence note: option buttons are message _parts_ beyond plain
text. The `messages` table currently stores `content TEXT` only; a
nullable `parts JSONB` column (§10) carries the structured parts so
history replays render the buttons (disabled) faithfully.

---

## 6. The composer contract

The single seam where profile, lanes, and library meet — and where
free-model reliability risk concentrates. Strict rules on both sides.

### 6.1 Inputs (assembled by code)

```ts
type ComposerInput = {
  profile: CompactProfile; // ~300 tokens
  motivation_weights: Weights;
  framing: FramingSpec; // from derived lane / mixed playbook
  candidates: CandidateComponent[]; // the key input, see below
  figure_templates: TemplateDescriptor[]; // ~4 allowed, id + schema + when-to-use
  conversation_digest: string; // 5-10 bullets, not the raw transcript
};
```

`candidates` is where quality is won **before the model runs**: code
filters the library (region/tenure/housing/`status=published`/
prerequisites-met), scores by
`weights · impact + interest boost − effort penalty`, and passes the
top ~15 as slug + title + summary + impact/effort only — never full
bodies. The model cannot recommend outside this list; a bad model day
produces a mediocre _ordering_, never a wrong _fact_.

### 6.2 Output

```ts
type ComposerOutput = {
  headline: string;
  intro: string; // 2-3 personalized sentences
  items: {
    component_slug: string; // MUST be in candidates
    rank: number;
    reveal: boolean; // top 2-3 true — progressive disclosure decided here
    personalization: string; // why THIS user; no new facts or numbers
    figure?: { template_id: string; params: unknown };
  }[];
  profile_gaps: string[]; // seeds follow-up prompts
  readiness_note: string; // honest "where you are" line
};
```

### 6.3 Validation pipeline

1. Zod parse of output shape.
2. **Slug whitelist**: non-candidate slugs dropped (logged, not fatal).
3. Figure params validated per template schema; invalid → figure
   dropped, item kept.
4. **Personalization lint**: reject strings with dollar amounts,
   percentages, or URLs (cheap regex enforcement of "no new facts").
5. Fewer than 3 surviving items → **one retry** with validation errors
   appended.
6. Retry fails → **deterministic fallback**: top-scored candidates in
   score order with each component's own generic one-liner. Blander
   but correct — report generation never hard-fails. This retires the
   `extractJson` regex-repair path.

### 6.4 Lazy personalization

Split **selection** (small, structured, must be reliable) from
**personalization** (prose, per item). Personalize only
`reveal: true` items at generation time; when the follow-up engine
reveals item #4 weeks later, personalize it _then_, against the profile
as it exists at that moment. Cheaper, and late-revealed items are
_better_. The follow-up addendum writer (§8.3) is this same
personalization call with a different preamble — one contract, two
entry points.

### 6.5 Evals

The composer gets the first eval harness: fixtures of
(profile, candidates) → assertions (slug validity, coverage of
`interested` technologies, ruled-out suppression, reveal count). Stand
it up before the first prompt iteration. A second fixture set covers
the profile extractor (transcripts → expected profiles), run on every
registry change to catch extraction drift.

### 6.6 Transitional hybrid mode (small corpus)

Until the corpus covers the launch scope, the composer runs in hybrid
mode: reports mix library-backed items with model-authored ones, with
per-item provenance. This is not a parallel code path — it's the same
contract with one extension:

- Items carry `source: "library" | "authored"`; authored items are
  the `component_slug: NULL` case the items schema already supports
  (§8.1).
- **Code, not the model, decides where authoring is permitted.**
  `ComposerInput` gains `authoring_allowed_for`: the topic tags whose
  candidate pool fell below threshold _for this profile_. An authored
  item outside those tags is dropped in validation — same posture as
  the slug whitelist. The model fills sanctioned gaps only; it cannot
  choose to bypass curated content.
- Authored items obey the existing report rules (no vendors, prices,
  tax advice), pass the same personalization lint, and are capped per
  report. Rendering is honestly differentiated: library items show
  citations and last-verified dates; authored items show an explicit
  "general guidance — not yet from our reviewed library" tag and no
  citation.
- Every authored item is logged with its (topic, profile cell) — a
  curation queue driven by real demand. The coverage metric is
  **projected authored share**, which must only shrink; full
  component-only mode is the defined end state, at which point the
  mode flag is deleted.
- Optional tie-in: when a new component later covers an authored
  item's topic, the content-based trigger (§8.4.2) can offer active
  items an upgrade to reviewed guidance.

Why this is principled rather than a workaround: it is strictly
better than the status quo (today, 100% of every report is uncited
freeform); provenance is visible per item, never blended; and the
transitional scope is measured, monotonically shrinking, and has a
defined end.

---

## 7. The report document

### 7.1 Structure

```ts
type ReportDocument = {
  meta: { doc_version; generated_at; lane_framing; readiness };
  about_you: ProfileSnapshot; // deterministic — rendered from profile slots
  your_goals: { headline; intro }; // model-authored (composer output)
  background: BackgroundEntry[]; // selected explainer components
  action_plan: ActionItemRef[]; // item references — rendered live, see below
  open_questions: string[]; // composer's profile_gaps
  sources: SourceCitation[]; // deterministic — union of components' sources
};
```

- **`about_you` is the sidebar, verbatim** — same renderer, same data.
  Zero model tokens, and it's the trust move ("here's what we based
  this on"); errors in it are user-correctable.
- **`background`** is where explainer components get a home (2–4
  matching `topics_discussed`). It flexes by lane: in `learning` it
  _is_ the report; in `lower_bills` it collapses to a couple of
  entries. The playbook's `report_sections` controls this.
- **Frozen vs live:** `meta`, `about_you`, `your_goals`, `background`
  freeze at generation. `action_plan` stores item _references_ and the
  web renderer joins against current item state. That mechanism is
  what makes one artifact both a milestone and a starting point.

### 7.2 Rendering: web-canonical, exports as projections

The canonical report is the structured document; every surface
independently renders it (never export a snapshot of the web page):

- **Web** = the living view: item states, "Explore this" buttons,
  held-back teasers, interactive figures.
- **PDF/docx** = frozen projections: states as static checkmarks with
  "as of {date}", held-back items omitted or listed as "coming later",
  figures rasterized (SVG → PNG at export), plus a footer: "your live
  plan may have progressed — see the web version."

If export quality starts to matter (sharing with a landlord/contractor
is a real use case), the upgrade path is a server-side render of a
print-styled route (Playwright/Chromium on a serverless function) —
same React renderer, real typography. Don't invest further in the
client-side jsPDF path.

---

## 8. The follow-up engine

Reframe: **the report stops being the artifact and becomes a view.**
The durable artifact is a set of _action items_ the user owns; follow-up
sessions are how items evolve.

### 8.1 Items as first-class rows

```sql
CREATE TABLE action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  component_slug TEXT,              -- library link; null for bespoke items
  component_version INTEGER,        -- version at selection → staleness detection
  title TEXT NOT NULL,
  personalization TEXT,             -- the "why this fits you" the composer wrote
  state TEXT NOT NULL DEFAULT 'suggested'
    CHECK (state IN ('suggested','exploring','committed','in_progress','done','dismissed')),
  rank INTEGER NOT NULL,
  revealed BOOLEAN NOT NULL DEFAULT false,   -- progressive disclosure gate
  snoozed_until TIMESTAMPTZ,
  dismissed_reason TEXT,            -- feeds library curation + preferences
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE item_events (          -- audit trail + activity feed + trigger fuel
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id),   -- which conversation caused this
  from_state TEXT, to_state TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The composer generates ~8 ranked items but reveals only the top 2–3.
Reveal the next when an item hits `done`/`dismissed`, or on a follow-up
visit. "Introduce recommendations over time" is a boolean flip.

### 8.2 Follow-up sessions

```sql
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'discovery'
  CHECK (kind IN ('discovery','follow_up'));
ALTER TABLE sessions ADD COLUMN parent_report_id UUID REFERENCES reports(id);
ALTER TABLE sessions ADD COLUMN focus_item_id UUID REFERENCES action_items(id);
```

Entry point: every revealed item card gets **"Explore this"** → a
`follow_up` session seeded with the durable profile, a parent-report
summary, the focused item's **full component body** (where `body_md`
gets spent), and the item's event history. The agent's mission changes:

> You are continuing from the user's report, focused on: {item}. Don't
> re-interview them. Go deep: answer specifics, surface the concrete
> next micro-step, note anything that changes their fit for this action.

### 8.3 What a follow-up session produces (not a new report)

1. **State transitions** — proposed by the agent via tool call,
   confirmed by the user in UI. Never silent.
2. **An item addendum** — a short structured brief appended to the item
   ("what we dug into on {date}"), rendered on the item card. The
   living report grows in place.
3. **New suggested items + profile patches** — e.g. a heat-pump
   deep-dive that surfaces a 100-amp panel adds a constraint to the
   durable profile _and_ may surface the "panel upgrade" component as a
   new prerequisite item.

One coherent plan per user; the original report stays frozen ("here's
what we told you and when") while the item list is alive.

### 8.4 Triggers (in build order)

1. **Visit-based (first, no infra):** a "Your plan" panel for returning
   signed-in users replaces the blank-chat landing — items by state,
   staleness nudges, next unrevealed item as a teaser. Computed at page
   load.
2. **Content-based (the differentiated one):** component `version` bump
   or approaching `expires` → find active `action_items` referencing
   that slug → notify. _"The rebate program tied to your heat-pump item
   was updated"_ falls out of `component_slug + component_version` for
   free.
3. **Time-based (last):** snooze wake-ups, periodic check-ins. Needs
   Vercel cron or Supabase `pg_cron`, real email (e.g. Resend), a
   `communication_prefs` column, unsubscribe handling. Gate every send
   on explicit opt-in collected at report time, not signup.

---

## 9. Guests

The design concentrates per-user state into two objects — the session
profile and the report document + items — and both serialize cleanly.
Rule: **guest state lives in localStorage in exactly the shapes the
database rows would have.**

- **Chat + extraction:** the guest endpoint stays stateless; the client
  sends messages _and_ current profile; the server runs the same
  extraction and returns profile patches in the response stream; the
  client applies and persists locally. Zero DB writes.
- **Sidebar, readiness, lanes:** pure functions — identical experience.
- **Library, filtering, composer:** no identity dependence; report
  document + items stored locally.
- **What degrades:** item state persists only in that browser;
  visit-based triggers work locally; content-based and time-based
  triggers don't exist for guests.

That degradation list is the signup pitch, delivered at maximum-value
moment: _"Sign up to keep this plan — track your steps anywhere, and
we'll tell you when the programs behind your recommendations change."_
Migration on signup is one idempotent server function inserting the
localStorage profile/report/items under the new `user_id` — a
transform-free copy. **Build the migration function with the guest
feature, not after**; shape drift between guest and DB representations
is what would quietly kill it.

Cost controls: guest turns now carry real cost (extraction per turn,
composer on report). Rate-limit by IP, cap guest session length, and
have the guest composer skip the retry (straight to deterministic
fallback) to bound worst-case spend. Privacy invariant worth
preserving and advertising: guest profile data transits the server
per-request but is never stored.

---

## 10. Schema changes (all additive)

Per `DATABASE.md` rules — nullable/defaulted columns, no renames:

```sql
-- profile
ALTER TABLE sessions ADD COLUMN profile JSONB;                 -- session profile
ALTER TABLE sessions ADD COLUMN readiness_reached_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN durable_profile JSONB;         -- opt-in carryover

-- follow-up engine
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'discovery';
ALTER TABLE sessions ADD COLUMN parent_report_id UUID REFERENCES reports(id);
ALTER TABLE sessions ADD COLUMN focus_item_id UUID;            -- FK added with table below
-- + action_items, item_events (see §8.1)

-- content (synced from repo, read-only at runtime)
-- + content_components, content_media, content_sources

-- reports: keep existing columns; new column for the structured document
ALTER TABLE reports ADD COLUMN document JSONB;                 -- ReportDocument, doc_version inside

-- structured message parts (quick-reply buttons etc., §5.4)
ALTER TABLE messages ADD COLUMN parts JSONB;                   -- null = plain text (existing rows)
```

RLS follows existing patterns (`auth.uid() = user_id`, or via session
ownership). Content tables are world-readable, service-role writable.

---

## 11. Extensibility & versioning

Two mechanisms, applied consistently:

1. **A declarative registry per extension axis** — adding something is
   adding a data entry, not editing call sites.
2. **Tolerant, normalize-on-read parsing** — old saved data never
   breaks and never needs a migration.

| Axis             | Registry                       | Add =                                                                                                                      | Never                                                                              |
| ---------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Profile slots    | `SLOT_REGISTRY`                | one entry (schema, extractor hint, sidebar, durable flag all derive)                                                       | rename/repurpose a key; narrow an enum                                             |
| Preferences      | entity namespace vocabulary    | a string convention                                                                                                        | reuse a namespace with new meaning                                                 |
| Lanes            | playbook registry              | playbook + weight dimension + **impact backfill across the library** (deliberately expensive — a content-curation project) | remove a lane id                                                                   |
| Figure templates | template registry              | template + schema                                                                                                          | delete or reuse an id (retired ids keep a "figure unavailable" or successor entry) |
| Content tags     | vocabulary file (CI-validated) | one line                                                                                                                   | repurpose a tag                                                                    |
| Report document  | `doc_version` in `meta`        | new optional sections                                                                                                      | drop the ability to render any historical version                                  |

**Normalize-on-read** is the only viable mechanism because profiles
also live in guest localStorage — you can't run a SQL migration over
browsers. One shared `normalizeProfile(raw)` (and equivalent for
report documents) fills missing slots with empty values, **passes
unknown keys through untouched** (protects against mixed-version
clients — an old bundle saving a profile must not strip slots a newer
bundle wrote), and coerces per-slot parse failures to null instead of
failing the whole object.

Consequences for saved data, summarized:

- Old profiles parse with new slots null; resumed sessions self-heal
  (the agent asks about gaps — better than any backfill).
- Readiness ratchets (§4.5) — reached gates are never revoked.
- Old reports are frozen; items pin `component_version`; content
  updates surface as staleness _signals_, never mutations of past
  advice. Extending the system makes old reports quieter, never wrong.
- Extractor drift on existing slots is the subtle risk of adding slots
  — covered by the extraction eval fixtures (§6.5), run on every
  registry change.

Honest limit: this is **additive** extensibility. Renames, semantic
changes, and removals are deliberately hard on every axis — the right
trade for a system whose stored artifacts are long-lived user-facing
advice.

---

## 12. Risks & prerequisites

1. **The free OpenRouter model is the biggest architectural risk.**
   Everything leans on reliable structured output (extraction, patches,
   composer). Budget for a cheap paid model (Haiku-class) for
   extraction and composition at minimum; free tier can remain for chat
   prose. The deterministic fallbacks (§6.3) bound the damage but don't
   remove the need.
2. **Evals before extraction drives UX** (§6.5). Once readiness gating
   and the sidebar depend on extraction accuracy, prompt changes need
   more than vibes.
3. **Dev/prod database separation is a soft prerequisite.** This
   roadmap implies frequent schema evolution; the shared-database
   discipline (`DATABASE.md`) gets painful fast. Split projects
   before, not during.
4. **Guest endpoint abuse/cost controls** before retrieval and
   extraction make guest turns more expensive (§9).
5. **Region is jurisdiction-critical**: required tag in the library and
   required profile slot from day one; collected location stays coarse
   (state/province) for privacy.
6. **Per-component feedback** (extend the existing `feedback` table or
   add item-level ratings) is the curation loop — it tells us which
   library content to fix.

---

## 13. Sequencing

1. **Session profile**: slot registry (including the upfront
   tenure/region slots, §4.8, formalizing the existing stepper),
   extractor, quick-reply buttons (§5.4), sidebar, readiness function,
   `>= 3 turns` gate replaced. Independently shippable.
2. **Lanes/playbooks + context builder** refactor of
   `src/lib/prompts/chat.ts`.
3. **Content library + composer + component-based reports** with
   citations, figures, and the new report document (frozen sections +
   live action plan). Presets (§3.6) migrate from the hardcoded
   `CHIPS` list into the library here; until then the hardcoded list
   gains `profile_patches` in phase 1.
4. **Follow-up engine**: action items + "Your plan" panel (visit-based
   triggers) → follow-up sessions → content-based triggers →
   time-based reminders/email.

Guest parity and the signup migration function ship _with_ each phase
(same shapes), not as a separate phase. Within phase 3–4 the strict
order is: library → composer → items → follow-up sessions → triggers,
because items only make sense once reports are component-based.
