# Implementation plan — personalization & trust architecture

**Status:** Draft for team review
**Date:** 2026-07-08
**Design:** [design-personalization-architecture.md](design-personalization-architecture.md)
(section references like §4.6 point there)

## How to read this

- Work is split into **work packages (WPs)**. Each WP ≈ one reviewable
  PR: independently mergeable, tested, and shippable without dead code
  or dark half-features.
- Each WP lists: goal, deliverables, dependencies, and a "done when".
- **Open decisions are collected in the register at the end.** A WP
  whose row says *blocked by D-n* must not start until that decision
  is made. Recommendations are offered where the choice is technical;
  product/content decisions are left genuinely open.
- Database migrations follow `DATABASE.md` (additive-only, one person
  applies, coordinated). Migrations are batched into three migration
  WPs (1.2, 3.2, 4.1) to minimize shared-database churn — though
  WP0.1 should make that concern moot.

## Ground rules (what "principled" means here)

1. **Pure functions first.** Readiness, normalization, scoring, lane
   derivation, context assembly, and validation are pure modules with
   unit tests, written before the UI or LLM calls that use them.
2. **Every WP ships with its tests.** No WP is done on "works when I
   tried it".
3. **Registry-driven, single source of truth.** Slots, lanes,
   templates, and tag vocabularies are declared once; schema, prompts,
   and UI derive from the declaration (§4.2, §11).
4. **Additive evolution only.** No renames, no repurposed fields, no
   silent semantic changes — in SQL and in JSON shapes alike.
5. **Replace, don't patch.** Fragile paths are retired by their
   replacement (e.g. `extractJson` regex-repair is deleted when the
   composer's validation pipeline lands, not kept "just in case").
6. **Guest parity is part of each WP**, not a follow-up phase: guest
   state uses the same shapes in localStorage, and the signup
   migration function is extended in the same PR that extends the
   shapes (§9).
7. **LLM-dependent behavior gets eval fixtures** before its first
   prompt iteration (§6.5). Deterministic fallbacks are part of the
   feature, not an afterthought.

## Branching & release model

The current AGENTS.md model (branch off `mvp`, PR into `mvp`) would
deploy every WP merge straight to production. For this refactor we
use an integration branch instead:

- **`dev`** — long-lived integration branch, created from `mvp`,
  protected the same way (PR-only, no direct pushes). Vercel gives it
  a stable branch domain, and its deployments use the
  Preview-environment variables → **the dev Supabase project (D13)**,
  so `dev` is a continuously-deployed staging environment.
- **Feature branches** — one per WP, named `wp/<id>-<slug>`
  (e.g. `wp/1.4-profile-extractor`), branched off `dev`, PR into
  `dev`, squash-merged, branch deleted. CI (WP0.3) runs on PRs to
  both `dev` and `mvp`.
- **Migrations, two-stage:** a migration WP merging to `dev` is
  applied to the *dev* database (freely — it's disposable). The
  *production* database is touched only at promotion, by one person,
  per the DATABASE.md process.
- **Promotion `dev` → `mvp`** happens at **phase exits** — the
  "every phase exit is functional" property exists precisely to
  define these release points. The promotion PR is the release
  review; after merge, prod migrations are applied, then the deploy
  is verified. **Promotions and hotfix merge-backs are true merges,
  never squashed** — squashing a promotion severs the shared history
  between the two long-lived branches and makes every later
  promotion re-conflict on already-merged work. (Squash applies only
  to feature→`dev` PRs.)
- **Tags at promotions only.** Each promotion merge gets an annotated
  tag — `v0.<phase>.<hotfix>` (Phase 1 → `v0.1.0`, hotfix on it →
  `v0.1.1`; Tier A completion → `v1.0.0`) — plus a GitHub Release
  whose notes are the promotion PR description and the list of prod
  migrations applied. The tag is the artifact tying a code version
  to its production schema state, which is what rollback reasoning
  needs. WP merges are *not* tagged: their squash-merged PRs already
  give them a durable identity, and nothing ever rolls back to a WP
  boundary on staging.
- **Guardrails against integration-branch rot:** `dev` never runs
  more than one phase ahead of `mvp` (promote before starting the
  next phase); any hotfix landing on `mvp` is merged back into `dev`
  immediately.

WP0.1 sets this up (branch, ruleset, branch domain) and updates
AGENTS.md so the contribution rule reads: feature work → `dev`;
`mvp` changes only by promotion or hotfix.

---

## Phase 0 — Foundations

### WP0.1 Dev environment: database, branch, deployment — *D13: resolved, proceed*
Create a second Supabase project so development stops sharing the
production database. Scope per D13: add the dev project's callback
URL as an authorized redirect URI on the existing Google OAuth client
(no new Google Cloud project; email/password needs no Google setup at
all); configure Vercel Preview-environment env vars to point at the
dev project (Production env vars stay on prod). Set up the branching
model (see *Branching & release model*): create the protected `dev`
branch from `mvp`, assign it a Vercel branch domain, and update
AGENTS.md's contribution rule. Update `ONBOARDING.md`, `DATABASE.md`,
`ARCHITECTURE.md`; `.env.example` gains nothing (same variables,
different values). Design and implementation documents are committed
as part of WP0.1.
**Done when:** a developer can run destructive local experiments
without coordinating with the team; pushing to `dev` deploys a
staging app at a stable URL against the dev database; and prod
migration remains a deliberate, separate act performed only at
promotion.

### WP0.2 Test infrastructure — *blocked by D15 (recommendation given)*
Add a test runner, a `test` script, and first trivial tests to prove
the harness. Establish conventions: colocated `*.test.ts`, pure-module
coverage mandatory, component tests optional.
**Done when:** `bun run test` passes locally and failing tests block
review by convention.

### WP0.3 CI pipeline — *depends WP0.2; blocked by D16 for the eval leg*
GitHub Actions: lint + typecheck + tests on PR. (Content validation
joins in WP3.1; evals per D16.)
**Done when:** a PR with a failing test cannot be merged unnoticed.

### WP0.4 Per-purpose model map — *D12: resolved, proceed*
Add a per-purpose model map (chat / extraction / composition) as
environment config via the existing gateway
(`src/lib/ai-gateway.server.ts` already supports custom router URLs).
Per D12's two-environment policy: development points structured tasks
at a capable free model (one-time $10 credit unlock for the 1,000
req/day cap); production points them at the bake-off winner with
OpenRouter no-training/ZDR routing enforced on extraction and
composition calls. The bake-off itself runs in WP0.5 once the
extraction fixtures exist (candidates: DeepSeek V4 Flash, Haiku 4.5,
a Flash-class model, plus free baselines). Eval runs always target
the production-designated model.
**Done when:** switching any purpose's model is an env change, ZDR/
no-training routing is verified on prod structured calls, and the
bake-off result is recorded in this doc (settling D12b's alert
level).

### WP0.5 Eval harness scaffolding — *depends WP0.2, WP0.4*
A `bun run evals` script that loads fixture files
(input → expected/asserted output), calls the configured model, and
reports pass/fail per fixture. No fixtures yet beyond a smoke test —
fixture sets arrive with WP1.4 (extractor) and WP3.6 (composer).
**Done when:** adding a fixture file is the only step needed to cover
a new case.

---

## Phase 1 — Session profile

### WP1.1 Slot registry, profile types, normalization, readiness
Pure code, no LLM, no UI:
- `SLOT_REGISTRY` with the §4.2 slots (including `elicitation`,
  `durable` flags); derived Zod schema; `Slot<T>` envelope;
  `Preference` type with entity-namespace vocabulary.
- `normalizeProfile(raw)` — tolerant read: missing slots filled,
  unknown keys passed through, per-slot failures → null (§11).
- `readiness(profile, requirements)` returning
  `{ score, missing, ready }` (§4.5). Lane playbooks don't exist yet;
  requirements are a parameter, with a default set.
- Patch-operation types (`set` / `append` / `clear`) and
  `applyPatches(profile, patches)` enforcing the edited-wins rule.
**Done when:** full unit coverage on normalization edge cases (old
shapes, junk input, unknown keys) and patch semantics.

### WP1.2 Migration #1 — *depends WP1.1 shape freeze; ideally after WP0.1*
```sql
ALTER TABLE sessions ADD COLUMN profile JSONB;
ALTER TABLE sessions ADD COLUMN readiness_reached_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN durable_profile JSONB;
ALTER TABLE messages ADD COLUMN parts JSONB;
```
All nullable; old code unaffected. Regenerate
`src/integrations/supabase/types.ts`.
**Done when:** applied per `DATABASE.md` process; app runs unchanged
before any code uses the columns.

### WP1.3 Upfront slots: stepper → profile — *blocked by D3*
Map the existing tenure/zip stepper output into profile slots with
`provenance: "stated"` (§4.8): tenure cards → `tenure`, zip step →
`region { state, city, zip }`. Applies to both the guest flow
(`chat.index.tsx`, localStorage profile) and the signed-in handoff.
D3 decides how the current `curious` tenure option and existing
`profiles.persona` data map into the new model.
**Done when:** starting a conversation produces a profile whose two
upfront slots are populated (or explicitly skipped, for zip) before
the first message.

### WP1.4 Profile extractor + eval fixtures — *depends WP1.1, WP0.4, WP0.5*
Server-side extraction call: current profile + last exchange → patch
operations (§4.4). Enforces: never overwrite `edited`; `propagated`
enters as low-confidence. Ships with the extraction fixture set
(transcripts → expected profiles) and a documented failure policy:
extraction failure logs and skips — never blocks or delays the chat
reply.
**Done when:** fixtures pass on the configured model; a deliberately
malformed model response provably cannot corrupt a profile.

### WP1.5 Wire extraction into both chat endpoints — *depends WP1.3, WP1.4*
- `/api/chat`: run extraction per turn; persist profile to
  `sessions.profile`.
- `/api/public/chat-guest`: client sends current profile; server
  returns patches in the response stream; client applies + persists to
  localStorage (§9).
- Decide-in-code (documented): extraction runs after the reply
  streams, not before (latency), as data parts on the same stream.
**Done when:** a conversation observably accumulates a profile in both
modes, with zero added time-to-first-token.

### WP1.6 Profile sidebar — *blocked by D1; depends WP1.5*
Registry-driven sidebar rendering slot groups, stances, and unknowns;
inline editing writes `provenance: "edited"` (§4.7). Same component
for guest and signed-in.
**Done when:** an extraction mistake can be corrected in one click and
the correction survives further extraction turns.

### WP1.7 Readiness gate replaces the 3-turn rule — *depends WP1.5*
Replace both `assistant messages >= 3` checks (`chat.index.tsx`,
`chat.$sessionId.tsx`) with `readiness(profile)`; disabled report
button states *what's missing*; set and respect
`readiness_reached_at` (ratchet, §4.5); context builder input gains
"still need to learn: …".
**Done when:** the report unlocks on information sufficiency, the gate
never regresses, and the old turn-count checks are deleted.

### WP1.8 Quick replies (`ask_user` tool) — *depends WP1.2, WP1.5*
Tool definition per §5.4; registry-derived options for slot-targeted
questions; UI renders option buttons + always-available free text; a
tap sends the label as the user message and applies the patch as
`stated`; parts persisted to `messages.parts` (DB) / localStorage
(guest) so history replays render disabled buttons.
**Done when:** a slot question answered by tap requires no extractor
call, and a plain-text answer to the same question still works.

### WP1.9 Guest→signup migration function — *depends WP1.5*
Idempotent server function copying the localStorage profile (and, once
they exist, report + items) into DB rows on signup (§9). Includes a
shared-shape test asserting guest and DB representations stay
identical — the drift guard.
**Done when:** signing up mid-guest-session loses nothing, and running
the migration twice is a no-op.

### WP1.10 Durable propagation — *blocked by D2; depends WP1.9*
Session-end opt-in (informed single yes/no with values shown, §4.6);
write `durable: true` slots + rule-passing preferences/constraints to
`profiles.durable_profile`; new sessions pre-fill as `propagated`
pills with change affordance; extractor tags constraints with the
`durable` hint (§4.6 promotion rule).
**Done when:** a second session starts pre-filled, re-confirmation
flips values to `stated`, and nothing propagates without the opt-in.

---

## Phase 2 — Lanes & context builder

### WP2.1 Lane playbooks + motivation weights + derivation
Pure code: `motivation_weights` slot; playbook registry for the five
lanes (§5.2) + the mixed framing fallback; `deriveLane(weights)` with
the closeness threshold as a named constant; blended
`impact_weights`; per-lane readiness requirements now feed WP1.1's
readiness function. Playbook *copy* (question wording, tone lines) is
content work (C4) — code lands with placeholder-quality copy clearly
marked.
**Done when:** unit tests cover derivation, blending, and the mixed
threshold; changing a playbook is a data edit.

### WP2.2 Context builder — *depends WP2.1*
Replace `buildSystemPrompt` with
`buildContext(profile, lane, stage, retrieved)` (§5.3) — pure and
snapshot-tested. Includes the brevity policy and the
"still need to learn" instruction. `retrieved` is plumbed but empty
until WP3.4.
**Done when:** snapshot tests pin the assembled prompt for
representative profiles; `src/lib/prompts/chat.ts` stage/persona logic
is retired.

### WP2.3 Extractor learns motivation — *depends WP2.1, WP1.4*
Extend extraction to maintain `motivation_weights` and
`technology_interests`/preferences; extend eval fixtures accordingly
(including ruled-out capture and the never-infer-from-silence rule).
**Done when:** fixtures assert weights move on motivation statements
and do *not* move on silence.

### WP2.4 Preset patches (interim) — *depends WP1.5*
The hardcoded `CHIPS` list gains `profile_patches` per §3.6 (library
migration happens in WP3.2). Initial preset set and copy is content
work (C3).
**Done when:** picking a chip warm-starts the profile and the first
agent turn reflects it.

---

## Phase 3 — Content library, composer, component reports

*The content workstream (C1–C4, below) must be underway before WP3.2
has anything real to sync.*

### WP3.1 Content schema + CI validation
`content/` directory layout; Zod schemas for components, media,
presets, sources (§3.1–3.3, §3.6); tag vocabulary file; CI job
validating frontmatter, required alt/credit on media, vocabulary
membership, prerequisite-slug resolution.
**Done when:** an invalid content file fails CI with a message a
curator can act on.

### WP3.2 Content tables + deploy-time sync — *depends WP3.1; migration #2*
`content_components`, `content_media`, `content_sources` (+ presets)
tables — world-readable RLS, service-role writable; idempotent
upsert-by-slug sync on deploy; Supabase Storage bucket for media.
CHIPS list retired in favor of library presets.
**Done when:** editing a markdown file and deploying updates the
tables; sync is provably idempotent.

### WP3.3 Candidate filtering + scoring — *depends WP3.2, WP2.1*
Pure functions: eligibility filter (region prefix, tenure, housing,
status, prerequisites-met) and score
(`weights · impact + interest boost − effort penalty`), §6.1.
**Done when:** unit tests cover each filter axis, ruled-out
suppression, and prerequisite holdback.

### WP3.3b Corpus coverage survey tool — *depends WP3.1, WP3.3*
A `bun run corpus-report` CLI that measures corpus completeness
**using the production candidate pipeline itself** (WP3.3's pure
filter + scorer), run over a grid of synthetic profiles spanning the
D9 launch scope (tenure × region × lane × technology interests, plus
every preset as a profile seed). Reads `content/` directly — no
database or deploy needed, so curators get feedback locally.

Reports:
- **Candidate pool size per synthetic profile** (the number that
  actually determines report quality) — worst cells first, so the
  output doubles as C2's curation work queue;
- **Lane coverage**: components with a nonzero impact score per lane;
- **Kind mix** per cell (a pool of five explainers and zero actions
  is not a usable pool);
- **Prerequisite reachability**: components permanently held back
  because nothing in the corpus satisfies their prerequisites;
- **Freshness**: `last_verified` age distribution, incentives past or
  near `expires`;
- **Orphans**: media referenced by nothing; preset topics resolving
  to too few components;
- **Projected authored share** per cell: the fraction of a report the
  hybrid composer (§6.6) would have to author rather than select —
  the WP3.6 gate metric.

Runs in CI as informational output on content PRs; the pass/fail
thresholds are set by D9 and enforced only as WP3.6's merge gate.
**Done when:** the WP3.6 corpus gate is a number the tool prints, not
a judgment call, and a curator can see the thinnest cells without
asking an engineer.

### WP3.4 Chat grounding + `show_figure` + citations — *blocked by D4; depends WP3.3, WP2.2*
Retrieval (top summaries by filter/score) feeds `buildContext`;
`show_figure(slug)` tool resolving only library media; citation
rendering in chat per D4.
**Done when:** answers on covered topics cite library sources, and the
agent cannot render a non-library image.

### WP3.5 Report document type + renderer — *blocked by D5; depends WP1.1*
`ReportDocument` with `doc_version` (§7.1); web renderer built against
hand-written fixture documents (composer not needed yet);
`about_you` reuses the sidebar component; legacy reports (rows without
`document`) render via the existing renderer per D5.
**Done when:** fixture documents of every section shape render
correctly; legacy report pages are pixel-unchanged.

### WP3.6 Composer + validation pipeline + evals — *depends WP3.3, WP3.5, WP0.5, and C2 corpus readiness; migration #2 includes `reports.document`*
Selection call per the §6 contract; validation pipeline (Zod → slug
whitelist → figure params → personalization lint → one retry →
deterministic fallback); composer eval fixtures. **Cuts over both
report paths in this one WP** — authenticated
(`report.functions.ts`) and guest (`guest-report.functions.ts` shares
`buildReportPrompt` and duplicates `extractJson`) — the guest variant
skips the retry (straight to fallback, §9). Only then are
`buildReportPrompt` and both `extractJson` copies deleted; a partial
cutover would leave guests broken or the old path alive.
**Hybrid mode + corpus gate (design §6.6, blocked by D20):** the
composer launches in transitional hybrid mode — library-backed items
with citations, plus model-authored items (`component_slug: NULL`,
`source: "authored"`) permitted only for topics whose candidate pool
is thin *as determined by code* (`authoring_allowed_for`), rendered
with an explicit not-yet-reviewed tag and capped per report. This is
strictly better than the current all-freeform reports, so the merge
gate softens from "full coverage" to: WP3.3b reports **projected
authored share ≤ the D9 cap** across launch-scope cells. Every
authored item in production logs its (topic, profile cell) — the
live curation queue that drives the share toward zero, at which
point the hybrid flag is deleted (defined end state, not a permanent
mode).
**Tier note:** until WP4.1 lands, the full ranked item list lives
inside `reports.document` and disclosure is static (top 2–3 render,
the rest don't) — see *Delivery tiers*, seam 1.
**Done when:** report generation cannot hard-fail on either path;
evals assert slug validity, interest coverage, ruled-out suppression,
reveal count.

### WP3.7 Lazy personalization — *depends WP3.6*
Split personalization from selection (§6.4); personalize only revealed
items at generation; the same call later serves reveals and addenda.
**Done when:** unrevealed items carry no personalization text and gain
it at reveal time against the then-current profile.

### WP3.8 Figure templates — *depends WP3.5*
Template registry + params schemas + the three §3.3 starter templates;
composer may emit figure params (validated in WP3.6's pipeline).
**Done when:** an invalid params payload drops the figure, never the
report.

### WP3.9 Export projections — *blocked by D18; depends WP3.5*
docx/PDF render from `ReportDocument` (frozen projection semantics,
§7.2): static checkmarks + "as of" stamp, held-back items handled,
figures per D18.
**Done when:** exports are faithful projections of the document, not
of the page.

### WP3.10 Guest storage + rate limiting — *D14, D7: resolved; depends WP3.6, WP1.9*
(Guest composer cutover moved into WP3.6 — it shares server code with
the authenticated path.) This WP: report document + items in
localStorage; signup migration extended to carry them; rate limiting
via a Postgres fixed-window counter table (D14) with D7's defaults —
40 messages/day/IP, 30 turns per guest session, 3 guest
reports/day/IP — all read from environment variables so they're
tunable without code changes.
**Done when:** a guest's report and plan survive a browser restart and
migrate on signup, and abuse cost is bounded by the env-configured
caps.

---

## Phase 4 — Follow-up engine

### WP4.1 Items model — migration #3 — *depends WP3.6*
`action_items` + `item_events` tables (§8.1); `sessions.kind`,
`parent_report_id`, `focus_item_id`; the item list already stored in
`reports.document` (Tier A, seam 1) is materialized into rows at
generation time — reports generated before this WP keep their
document-inline items and render as before (frozen artifacts are
never backfilled); report page's action plan renders live from items
(§7.1 frozen-vs-live split).
**Done when:** generating a report produces item rows and the report
page reflects item state changes without regeneration, while
pre-existing reports are untouched.

### WP4.2 "Your plan" panel (visit-based triggers) — *depends WP4.1*
Returning signed-in users land on plan state: items by state,
staleness nudges, next-unrevealed teaser (§8.4.1). Computed at page
load; no scheduling infra.
**Done when:** a returning user sees their plan before a blank chat
box.

### WP4.3 Follow-up sessions — *blocked by D8; depends WP4.1, WP2.2*
"Explore this" → `follow_up` session; context builder variant seeded
with durable profile + report summary + component `body_md` + item
history (§8.2); follow-up stage prompt.
**Done when:** a follow-up session demonstrably doesn't re-interview
and answers from the focused component's full content.

### WP4.4 Item state transitions + addenda — *depends WP4.3*
Agent proposes transitions via tool; user confirms in UI (never
silent, §8.3); `item_events` written with session provenance; addenda
appended via the WP3.7 personalization call; discovered constraints
flow to the durable profile under §4.6 rules.
**Done when:** a follow-up conversation can move an item through its
lifecycle with an auditable event trail.

### WP4.5 Reveal mechanics — *depends WP4.4*
Reveal-next on done/dismissed and on follow-up visits; dismissal
reasons write back to preferences (§4.3); lazy personalization at
reveal.
**Done when:** the plan provably grows over time instead of arriving
whole.

### WP4.6 Content-based triggers — *blocked by D6; depends WP4.1*
Staleness scan: component version bump / approaching `expires` →
active items referencing the slug → in-app notification per D6
(§8.4.2). No email yet.
**Done when:** bumping a component version surfaces a notice on
affected users' plans.

### WP4.7 Time-based reminders + email — *blocked by D17; depends WP4.6*
Scheduler + email provider + `communication_prefs` +
unsubscribe + opt-in at report time (§8.4.3). All four D17
sub-decisions precede any code.
**Done when:** a snoozed item wakes its owner by the channel they
opted into, and no email is ever sent without that opt-in.

---

## Content workstream (parallel, non-code)

| # | Task | Feeds | Blocked by |
|---|---|---|---|
| C1 | Editorial guidelines: tone, sourcing standards, the D9 review workflow (AI drafts → named human reviewer signs off → `reviewed_by` frontmatter required for `status: published`, CI-enforced), licensing workflow for media | WP3.1 | — (D9 resolved) |
| C2 | Initial corpus per D9: US-national + DMV (DC/MD/VA) pilot region; AI-drafted, human-reviewed; curation prioritized by the WP3.3b coverage report's thinnest cells | WP3.2 | C1 |
| C3 | Preset list (motivation- and technology-flavored) | WP2.4, WP3.2 | C1 |
| C4 | Playbook copy: priority-question wording, tone lines, section framing per lane | WP2.1 polish | C1 |

C1 is the critical content-path item and can start immediately — D9
is resolved, so nothing blocks it.

---

## Critical path & parallelization

```
WP0.1 ─┐
WP0.2 ─┼─ WP0.3          C1 → C2/C3/C4 (parallel, content)
WP0.4 ─┴─ WP0.5
   │
WP1.1 → WP1.2 → WP1.3 → WP1.4 → WP1.5 → { WP1.6, WP1.7, WP1.8, WP1.9 → WP1.10 }
                                    │
WP2.1 → WP2.2 → WP2.3, WP2.4 ◄──────┘
   │
WP3.1 → WP3.2 → WP3.3 → { WP3.4 } → WP3.6 → WP3.7 → WP3.10
            WP3.5 ──────────────────┘   WP3.8, WP3.9
            WP3.3b (corpus gate for WP3.6; work queue for C2)
   │
WP4.1 → WP4.2, WP4.3 → WP4.4 → WP4.5, WP4.6 → WP4.7
```

- Phase 1 after WP1.5 fans out: sidebar, gate, quick replies, and the
  signup migration are independent of each other.
- WP3.5 (renderer) deliberately builds against fixtures so it
  parallelizes with WP3.3/3.4 rather than waiting on the composer.
- Content (C1–C4) runs alongside Phases 1–2 so the library isn't
  empty when WP3.2 lands.

## Phase exit states (the app is functional at every boundary)

Every phase — and every individual WP — leaves a deployable,
coherent app. Pure modules land tested-but-unwired, additive
migrations land before the code that uses them, and UI wiring comes
last, so no intermediate state has dead ends or broken flows.

| After | The user has |
|---|---|
| Phase 0 | Today's app, unchanged — plus tests, CI, evals, and a reliable model behind the scenes |
| Phase 1 | Today's chat + a visible, editable profile; report unlocks on sufficiency (not turn count); tappable answers. Reports still generate the old way |
| Phase 2 | Conversation ordered around the user's motivation. Reports still old-style |
| Phase 3 | Grounded chat with citations and library figures; component-based reports with progressive disclosure — cut over on both auth and guest paths in one step (WP3.6), launching in hybrid mode (§6.6): cited library items plus clearly-labeled authored items where the corpus is still thin |
| Phase 4 | The living plan: item tracking, follow-up sessions, staleness notices, then reminders — each WP additive |

The one deliberate exception to "each WP is user-visible or inert":
WP3.6 is a *cutover* (report generation changes behavior for
everyone at once), which is why it alone carries a corpus-readiness
gate in addition to code readiness.

---

## Delivery tiers (must-have vs nice-to-have)

Phases are ordered by *dependency*; tiers cut across them by *value*.
Tier A alone is a complete, credible product. Tiers B and C can be
re-scoped or postponed without leaving stubs, because the two seams
they sit behind are designed (see notes below), not improvised.

| Tier | Theme | Work packages |
|---|---|---|
| **A — must-have: the trust product** | Profile-driven, motivation-ordered conversation; grounded, cited, hybrid reports | WP0.1–0.5 · WP1.1–1.7, 1.9 · WP2.1–2.3 · WP3.1–3.3b, 3.4 (citations; `show_figure` may defer to C), 3.5, 3.6, 3.9 (minimal: no figures), 3.10 · C1–C2 |
| **B — high-value follow-on: the living plan** | Item tracking, plan panel, follow-up sessions, reveal-over-time; convenience features | WP4.1–4.5 · WP1.8 (quick replies) · WP1.10 (durable propagation) · WP2.4 (preset patches) · C3–C4 polish |
| **C — advanced / optional** | Figures, cost optimizations, proactive engagement | WP3.7 (lazy personalization) · WP3.8 (figure templates) · WP4.6 (content triggers) · WP4.7 (email reminders) · D18 rasterization · server-side PDF |

**Seam 1 — Tier A reports carry their items inside the document.**
Without WP4.1, the composer's full ranked item list lives in
`reports.document` (the frozen artifact, where it belongs anyway) and
progressive disclosure is *static*: the top 2–3 render, held-back
items don't. WP4.1 later materializes items as rows with live state —
purely additive, because the document was always the frozen source of
truth. What Tier A users don't get: state tracking, "Explore this",
reveal-over-time.

**Seam 2 — Tier B reveals with eager personalization.** If WP3.7 is
deferred, all items are personalized at generation time; WP3.7 later
makes that lazy (cheaper, fresher for late reveals) with no behavior
change.

**Tier A degradations, stated honestly:** users re-answer the two
upfront basics each session (no durable propagation); no tappable
answer buttons (plain-text questions, extractor handles answers — the
degradation path quick replies were designed around); reports are a
milestone but not yet a living plan.

**Decisions deferred along with their tiers:** Tier A needed
D1, D3–D5, D7, D9, D12–D16, D20 — **all resolved 2026-07-08** (see
the decision register). Tier B adds D2, D8, D19; Tier C adds D6, D17,
D18 — those stay open until their tier is scheduled. Nothing in
Tier A waits on any decision.

---

## Decision register

**Status: all Tier A decisions (D1, D3–D5, D7, D9, D12–D16, D20) were
resolved 2026-07-08.** Tier B/C decisions (D2, D6, D8, D10, D17–D19)
remain open and are decided when their tier is scheduled.

### Product / UX
- **D1 — Sidebar UX.** ✅ **Resolved: persistent right-hand panel on
  desktop; on mobile, a summary chip row above the chat opening a
  slide-over drawer** (sheet/sidebar primitives already in the repo).
- **D2 — "Session end" moment.** *(Open — Tier B.)* The app has no
  explicit session-end event, but §4.6's opt-in needs one.
  Candidates: after report generation; on navigating away; explicit
  "wrap up" action. Blocks WP1.10.
- **D3 — Fate of `curious`.** ✅ **Resolved: the "Not sure yet" card
  stays; picking it leaves `tenure` null with `asked_at` set (agent
  won't nag) and nudges motivation weights toward the learning
  lane.** Tenure-filtered content falls back to both-tenure
  components until the conversation learns it. No stored-data
  conflict: the DB check constraint never allowed `curious` in
  `profiles.persona`.
- **D4 — Citation rendering in chat.** ✅ **Resolved: compact
  expandable "Sources (n)" row beneath cited assistant messages —
  label, publisher, last-verified, and a link.** Links are safe here
  because they come from `content_sources` records (deterministic);
  the old "no URLs" prompt rule existed to stop model-*generated*
  URLs, which remains in force for model output.
- **D5 — Legacy reports.** ✅ **Resolved: frozen forever — old rows
  render via the existing renderer path, never regenerated.** And
  since there is no real user base yet, pre-launch reports are
  disposable: zero effort goes into legacy support beyond not
  deleting the existing code path.
- **D6 — Notification surface.** *(Open — Tier C.)* Where do
  content-based trigger notices live — plan panel badges, a bell,
  toast on visit? Blocks WP4.6.
- **D7 — Guest limits.** ✅ **Resolved: moderate defaults — 40
  messages/day/IP, 30 turns per guest session, 3 guest reports/day/IP
  — all as environment variables so they're tunable without a
  deploy-code change.**
- **D8 — Follow-up entry UX.** *(Open — Tier B.)* Item card
  interaction design ("Explore this" placement, how addenda display).
  Blocks WP4.3.

### Content / ops
- **D9 — Content ownership & scope.** ✅ **Resolved: AI-drafted,
  human-reviewed pipeline — Claude drafts components against the C1
  editorial guidelines; every component requires a named team
  reviewer's sign-off before `status: published`. Launch scope:
  US-national content plus region-specific content for the DMV area
  (DC / Maryland / Virginia) as the pilot region.** Review sign-off
  is enforced structurally (e.g. a `reviewed_by` frontmatter field
  CI-required for published status), not by convention. Exact
  component-count thresholds for the WP3.6 gate are set once the
  WP3.3b tool exists to measure projected authored share.
- **D10 — Media licensing policy.** *(Open — needed before media
  lands in C2; components can ship without media.)* What licenses are
  acceptable for library images; who verifies.

### Technical / budget
- **D11 — (reserved — folded into D12).**
- **D12 — Model policy.** ✅ **Resolved: a two-environment policy.**
  *Development:* free OpenRouter models via the per-purpose model map
  (a one-time $10 credit purchase lifts the free cap to 1,000
  requests/day — ample for dev + eval runs; dev/eval traffic is
  synthetic, so free-endpoint data policies don't touch real users).
  *Production structured tasks (extraction, composition):* a cheap
  paid model with OpenRouter no-training/ZDR routing enforced, chosen
  by a bake-off on the WP0.5 extraction fixtures — candidates include
  DeepSeek V4 Flash, Haiku 4.5, a Flash-class model, *and* the best
  free models as baselines. **Discipline that makes the split safe:
  eval fixtures always run against the production-designated model
  before prompt-touching merges** — prevents prompts tuned on the dev
  model drifting on prod. **D12b (budget):** deferred until the
  bake-off picks; posture will be alert-only (~$25/mo) — at
  $0.0001–0.0015 per extraction call, spend is single-digit dollars
  monthly until real traffic says otherwise.
- **D13 — Second Supabase project.** ✅ **Resolved: yes, create it.**
  Google sign-in needs no new Google Cloud project: add the dev
  project's callback URL as an authorized redirect URI on the
  existing OAuth client (or a second client in the same GCP project);
  email/password works in dev with zero Google setup. Vercel side:
  Preview-environment env vars point at the dev Supabase project
  (Production env vars stay on prod) — optionally a branch domain for
  a stable dev URL. Folded into WP0.1's scope.
- **D14 — Rate-limit store.** ✅ **Resolved: Postgres counter table**
  (fixed-window counters by IP in the existing Supabase project; no
  new vendor).
- **D15 — Test runner.** ✅ **Resolved: Vitest.**
- **D16 — Evals in CI.** ✅ **Resolved: manual, with a required PR
  checklist line ("ran `bun run evals` against the prod-designated
  model — pass") on prompt-touching PRs.** Revisit once real spend
  is known.
- **D17 — Email stack.** *(Open — Tier C.)* Provider (e.g. Resend),
  scheduler (Vercel cron vs `pg_cron`), compliance review of reminder
  emails, comms preference UX. Blocks WP4.7 only — deliberately last.
- **D18 — Figures in exports.** *(Open — Tier C; Tier A's WP3.9 ships
  the recommended minimal form: no figures, with an "available in the
  web version" note.)* Rasterization approach decided if/when export
  usage justifies it.
- **D19 — Zip lookup dependency.** *(Open — Tier B; doesn't block
  WP1.3.)* **[rec: bundle a static zip-prefix→state dataset,
  removing the client-side `zippopotam.us` call.]**
- **D20 — Hybrid report mode (design §6.6).** ✅ **Resolved: adopted,
  with the proposed authored-item label: "General guidance — not yet
  from our reviewed library."** The authored-share cap for the WP3.6
  gate is set alongside D9's thresholds once WP3.3b can measure it.
