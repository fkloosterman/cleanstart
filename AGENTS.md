## Contributing

This repo (`fkloosterman/cleanstart`) is the only one in active use. There
is no Lovable-based editing here — Lovable remains connected to
`jreddy777/cleanstart`'s `main` branch, but that's a separate, unrelated
repo that we don't sync with or merge from/into.

### Branches

- **`mvp`** — the production branch (and the repo's default branch).
  Vercel builds production from it. It changes **only** by promotion from
  `dev` or by an emergency hotfix — never by regular feature PRs.
- **`dev`** — the long-lived integration branch. All feature work lands
  here first. Vercel deploys it as a staging environment (branch-scoped
  Preview env vars → the dev Supabase project), so `dev` is continuously
  deployed against the dev database.
- **Feature branches** — one per work package, named `wp/<id>-<slug>`
  (e.g. `wp/1.4-profile-extractor`), branched off `dev`, PR into `dev`,
  **squash-merged**, branch deleted.

> **Transitional caveat:** Vercel previews of `wp/*` branches currently
> fall through to the global Preview env vars, which still point at the
> **production** database (kept that way while mvp-based work winds
> down). Don't use those previews for database-touching testing — test
> locally and on the `dev` staging deployment. Details and the flip
> deadline: `ARCHITECTURE.md` §3.4.

Both `mvp` and `dev` are protected via GitHub branch rulesets: no direct
or force pushes, everything lands via PR. `main` is not actively used;
don't rely on it being kept up to date.

### Promotions and hotfixes

- **Promotion `dev` → `mvp`** happens at phase exits (see
  `docs/implementation-plan-personalization.md`). The promotion PR is the
  release review; after merge, prod migrations are applied, then the
  deploy is verified.
- **Promotions and hotfix merge-backs are true merges, never squashed** —
  squashing severs the shared history between the two long-lived branches
  and makes every later promotion re-conflict on already-merged work.
  (Squash applies only to feature→`dev` PRs.)
- Each promotion merge gets an annotated tag (`v0.<phase>.<hotfix>`) plus
  a GitHub Release listing the prod migrations applied. WP merges are not
  tagged.
- Guardrails: `dev` never runs more than one phase ahead of `mvp`
  (promote before starting the next phase); any hotfix landing on `mvp`
  is merged back into `dev` immediately.

See `ONBOARDING.md` for the full new-contributor setup flow (Windows,
agent-guided).

## Testing

Tests use Vitest and are colocated with the code they cover
(`foo.ts` → `foo.test.ts`). Run them with `bun run test`.

- **Pure modules must ship with unit tests** — readiness, normalization,
  scoring, context assembly, validation, and similar logic land tested
  before the UI or LLM calls that use them.
- Component tests are optional.
- A PR with failing tests must not be merged; CI runs lint, typecheck,
  and tests on PRs to `dev` and `mvp`.

## Database schema changes

There are **two** Supabase projects:

- the **dev project** — used by local development and the `dev` staging
  deployment. It's disposable: migrations merging to `dev` are applied to
  it freely, and destructive local experiments need no coordination.
- the **production project** — used only by production (`mvp`). It's
  touched **only at promotion**, by one person, per the `DATABASE.md`
  process.

Never edit `supabase/migrations/` or run a migration against the
production project without reading `DATABASE.md` first. Migrations must
be additive-only (see `DATABASE.md`) because old and new code overlap in
production during deploys.
