# Onboarding (Windows)

> **macOS/Linux users:** these steps are Windows-specific (GitHub Desktop +
> PowerShell installers, `nvm-windows`, `copy` instead of `cp`). The overall
> flow (get GitHub access → install Git/Claude Desktop → clone → let Claude
> Code drive the rest) still applies, but swap in your platform's
> installers — e.g. Homebrew + standard `nvm` on macOS, your distro's
> package manager on Linux — and skip GitHub Desktop in favor of the `git`
> CLI if you prefer. Ask Claude Code to adapt the commands once it's
> running.

> **For the AI agent running this doc:** this file is written to be followed
> _with_ a human, not read by one alone. You cannot exist or run yet during
> Phase 0 below — nothing in Claude Desktop can happen until the repo is
> cloned locally and opened in the Claude Code tab, so Phase 0 is 100%
> manual, no agent involved. You pick up starting at Phase 1, once the user
> has opened this cloned repo in Claude Desktop's Claude Code tab and asked
> you to continue their setup.
>
> From Phase 1 onward, for each step:
>
> - If it's a shell command, run it yourself and check the result before
>   moving on. Don't batch multiple install steps together — verify each one
>   before starting the next, since later steps assume earlier ones worked.
> - If it's a GUI action (installer wizard, signing into an app, entering
>   credentials), you can't do it — tell the user exactly what to click/enter,
>   then wait for them to confirm it's done before continuing. Don't assume
>   silence means success; ask.
> - If a verification command fails, stop and help the user fix it before
>   proceeding — don't push forward on a broken step.
> - The "get access" step involves secrets. Never ask the user to paste
>   secret values into chat; tell them which file to edit (`.env`) and which
>   field, and let them fill it in themselves.

> **Note on repo state:** `fkloosterman/cleanstart` is the only repo in
> active use — this is where the team develops, and Vercel builds
> production from its **`mvp`** branch, which is also the repo's default
> branch (cloning lands you there automatically). There's a separate
> `jreddy777/cleanstart` repo with its own Lovable-connected `main` branch,
> but it's unrelated to this workflow — we don't sync with or merge from/into
> it, and there's no Lovable-based editing here. `main`, `mvp`, and `dev` on
> this repo are protected via GitHub branch rulesets — no direct or force
> pushes, everything lands via PR. Feature branches branch off **`dev`**
> (the integration/staging branch) and PR back into `dev`; `mvp` changes
> only by promotion from `dev` or by hotfix — see `AGENTS.md`.

## Phase 0 — Before any agent can help (do this yourself)

No AI agent is available yet at this point — do these steps manually, in
order.

1. **Get GitHub access.** Ask whoever's running the project (currently
   Fabian) for a collaborator invite to `fkloosterman/cleanstart`. You need
   this before you can clone the repo — accept the invite (check your email
   or https://github.com/notifications).

2. **Install GitHub Desktop** — https://desktop.github.com. Install it and
   sign in with your GitHub account.

3. **Install Claude Desktop** — https://claude.ai/download. Install it and
   sign in.

4. **Install Git for Windows** — https://git-scm.com/download/win. GitHub
   Desktop bundles its own Git, but Claude Code shells out to the `git` CLI
   directly, so it needs to be on `PATH`. Run the installer with default
   options. (If you skip this, Claude Code will prompt you to install it
   the first time it needs `git` — but installing it now avoids that
   interruption.)

5. **Clone the repository.** In GitHub Desktop: File → Clone Repository →
   select `fkloosterman/cleanstart` → choose a local path → Clone.
   (Or from a terminal: `git clone https://github.com/fkloosterman/cleanstart.git`)

6. **Open the repo in Claude Code.** In Claude Desktop, open the Claude Code
   tab and open the folder you just cloned. Then send it a message like:
   _"Follow ONBOARDING.md in this repo to finish setting up my machine,
   starting at Phase 1."_

Everything below this point is meant to be driven by that agent, not done by
hand.

## Phase 1 — Agent-guided setup

1. **nvm-windows** — https://github.com/coreybutler/nvm-windows/releases
   (the `nvm-setup.exe` asset). Have the user run the installer with default
   options, then open a **new** PowerShell window (nvm won't be on `PATH` in
   an already-open terminal).
   Then run:

   ```
   nvm install 22
   nvm use 22
   ```

   Verify: run `node --version` (should print a `v22.x.x` version) and
   `npm --version`.

2. **Bun** — this project's package manager (`bun.lock`, `bunfig.toml`).
   Install via PowerShell:

   ```
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

   Then open a new terminal window so `bun` is on `PATH`.
   Verify: run `bun --version`.

3. **A code editor** (optional) — VS Code (https://code.visualstudio.com)
   is the most common choice, but any editor works. Skip if the user
   already has a preference.

4. **Get the remaining access, then populate `.env`.**

   First, tell the user to request the following from whoever's running the
   project, and wait for them to confirm they have each before moving on:
   - **Supabase**: either the **dev** project's `VITE_SUPABASE_URL` /
     `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` values
     directly, or dashboard access to the dev Supabase project to pull them
     themselves. (Local development always points at the dev project —
     never at the production one; see `ARCHITECTURE.md`.)
   - **OpenRouter**: an `OPENROUTER_API_KEY`, or their own key if they're
     meant to provision one.
   - **Vercel**: added as a member on the Vercel project/team, so they can
     see deployment logs and PR preview URLs.

   Then copy the env template:

   ```
   copy .env.example .env
   ```

   Tell the user to open `.env` in their editor and fill in the values they
   just gathered:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
     `VITE_SUPABASE_PROJECT_ID` — public, build-time.
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
     `OPENROUTER_API_KEY` — server-only secrets.

   Do this step yourself only up to running `copy .env.example .env`; don't
   type secret values into `.env` on the user's behalf even if they paste
   them into chat — ask them to edit the file directly. `.env` is
   gitignored, but double-check before committing anything that you haven't
   picked up real secrets.

   Verify: ask the user to confirm all fields in `.env` are filled in.

5. **Install dependencies.** From the repo folder:

   ```
   bun install
   ```

   Verify: command exits 0 and a `node_modules` folder now exists.

6. **Run it locally.**

   ```
   bun run dev
   ```

   Open the printed local URL and confirm with the user that the app loads
   and they can sign in.

   This intentionally doesn't cover the Supabase CLI or schema migrations —
   that's out of scope for regular onboarding. See `DATABASE.md` if/when the
   user actually needs to change the database schema.

---

## Example workflow: shipping a change

Walk the user through this once end-to-end on a small change so they've seen
the whole loop before doing it solo.

1. **Sync and branch**
   Make sure the local repo is up to date with `dev`, then create a feature
   branch off it (work-package branches are named `wp/<id>-<slug>`; for
   other small changes any short descriptive name works):

   ```
   git checkout dev
   git pull
   git checkout -b your-name-short-feature-description
   ```

2. **Work with Claude Code**
   In Claude Desktop's Claude Code tab, open the repo folder and describe
   the change. Review the plan/diffs as it works — this repo's `AGENTS.md`
   has repo-specific context Claude Code picks up automatically.

3. **Test locally**

   ```
   bun run dev      # exercise the feature in the browser
   bun run lint      # catch lint errors
   bun run test      # run the automated test suite
   ```

   Also manually click through the feature and any adjacent flows that
   were touched — automated coverage is mandatory for pure logic modules
   but optional for UI components (see `AGENTS.md`), so manual testing is
   still the main safety net for UI changes.

4. **Commit**

   ```
   git add -A
   git commit -m "Short description of the change"
   ```

5. **Push**

   ```
   git push -u origin your-name-short-feature-description
   ```

6. **Open a PR**
   In GitHub Desktop, click "Create Pull Request" (or on github.com), base
   branch `dev`, compare branch the new feature branch. Fill in a short
   description of what changed and why.

7. **Check the Vercel preview**
   Vercel auto-comments on the PR with a preview deployment link once the
   build finishes. Open it and click through the change in a real deployed
   environment (not just local dev) before merging — this catches
   env-var/build issues that don't show up locally.

8. **Merge**
   Once the preview looks good (and any review feedback is addressed),
   squash-merge the PR into `dev` and delete the branch. Vercel redeploys
   the staging environment automatically. The change reaches production
   later, when `dev` is promoted into `mvp` (see `AGENTS.md`) — feature
   PRs never deploy straight to production.
