# Migrating Off Lovable Cloud

This document describes how the `cleanstart` app was taken off **Lovable
Cloud** — the all-in-one platform it was originally built on — and rebuilt
on independent, standard services. It's written so someone non-technical
can follow the same path, with explanations of *why* each step exists, not
just what to click.

If you just need access to the *existing* team's already-running copy of
the app, stop here and use [ONBOARDING.md](ONBOARDING.md) instead — that's
a much shorter process of requesting credentials, not creating new
infrastructure.

## Background: why migrate, and how the code got to GitHub

Lovable is an AI app builder: you describe an app in chat, and it builds
and hosts it for you. Behind the scenes, Lovable Cloud quietly provides
everything the app needs — a database, user sign-in, and access to AI
models — all bundled under Lovable's own account. That's convenient, but
it means the app only runs inside Lovable: you can't move it, you can't
choose your own AI provider, and you're tied to Lovable's pricing and
limits.

The good news is that Lovable generates real, ordinary code, and it offers
a **GitHub sync**: in the Lovable editor you connect your GitHub account,
and Lovable creates a repository and keeps it up to date — every change
made in Lovable is pushed to GitHub automatically. That sync is the escape
hatch this whole migration depends on. It had already been set up for this
project (the original Lovable-connected repository is
`jreddy777/cleanstart`, whose `main` branch is what Lovable writes to), so
the full source code was sitting on GitHub before the migration began. If
your Lovable project isn't synced to GitHub yet, do that first: in
Lovable, open the GitHub integration and connect a repository.

Once the code lives on GitHub, "migrating off Lovable" means replacing
each hidden Lovable-provided service with one you own:

| Lovable provided… | Replaced with… |
|---|---|
| A managed database + user accounts | **Supabase** (the same technology Lovable uses under the hood, but under your own account) |
| "Sign in with Google" via Lovable's wrapper | **Google Cloud** OAuth credentials of your own |
| AI model access via Lovable's gateway | **OpenRouter** (one API that fronts many AI models, with free options) |
| Hosting the live website | **Vercel** (builds and hosts the site on every code push) |

The rest of this document walks through those replacements in the order
they need to happen. Tools are introduced at the point you need them.

---

## 1. Get a copy of the code you can work on

Everything starts with getting a copy of the code where you can change it
without Lovable overwriting your work. Lovable keeps writing to the
repository's `main` branch, so the key idea is: **leave `main` alone as
Lovable's territory, and do all migration work on a separate branch.**

You can do that either directly in the original repository (just create a
new branch there), or — as was done for this project — by **forking**
first: creating your own independent copy of the repository under your own
GitHub account. A fork adds a layer of insulation and is the natural
choice when the person doing the migration isn't the owner of the original
repository. Both approaches work; the steps below assume a fork.

**Install GitHub Desktop** (https://desktop.github.com) and sign in with
your GitHub account. This is a friendly graphical app for copying
repositories to your computer and managing changes — no command line
needed for everyday use.

**Install Git for Windows** (https://git-scm.com/download/win, default
options). This one needs a word of explanation: GitHub Desktop bundles its
own private copy of Git, which is enough for GitHub Desktop itself — but
several tools used later in this process (and AI coding assistants like
Claude Code, if you use one) expect Git to be installed system-wide.
Installing it now avoids a confusing failure later.

Then:

1. On github.com, open the original Lovable-connected repository and click
   **Fork** to create your copy.
2. In GitHub Desktop: File → Clone Repository → select your fork → choose
   a folder on your computer → Clone. "Cloning" downloads the code to your
   machine so you can run and edit it.
3. Create the working branch for the migration — this project named it
   **`mvp`** — leaving `main` untouched as a snapshot of the original
   Lovable code. Keeping `main` pristine turned out to be useful: it
   preserves a clear "before" state to compare against or fall back to.
4. Once the `mvp` branch exists on GitHub (it will after your first push),
   make it the repository's **default branch**: on github.com, go to your
   repo's **Settings → General → Default branch** and switch it to `mvp`.
   The default branch is what people land on when they clone, and what
   pull requests target automatically — without this, collaborators would
   keep accidentally working against the old Lovable code on `main`.

---

## 2. Cut the code's ties to Lovable

The exported code still *calls* Lovable's services in a few places, so
before the app can run anywhere else, those call sites have to be
rewritten. **In this repository, this work is already done** — it lives in
the `mvp` branch (the key commit is titled *"Migrate off Lovable Cloud"*),
so if you forked this repo you inherit it for free. It's described here so
you understand what changed, and so anyone migrating a *different* Lovable
app knows what to look for. This is the one part of the migration that
involves actual programming — an AI coding assistant can do it (a
ready-to-use prompt is provided below), but someone should review the
result.

What had to change, and why:

- **Sign-in code.** Lovable wraps Google sign-in in its own helper
  (a package called `@lovable.dev/cloud-auth-js` and a generated file
  `src/integrations/lovable/`). That wrapper routes sign-in through
  Lovable's servers, so it can't work independently. It was deleted and
  replaced with Supabase's own built-in Google sign-in, which does the
  same job in fewer lines.
- **AI model access.** The app called Lovable's "AI Gateway" to reach
  language models. That was replaced with a direct connection to
  OpenRouter, plus a fallback list of free models — if the first free
  model is momentarily rate-limited (common with free tiers), the request
  automatically retries the next one instead of failing.
- **Deployment target.** One line of build configuration was added to
  tell the app's build system to produce output in the format Vercel
  expects.
- **A committed `.env` file.** Lovable had committed a `.env` file (the
  file that holds the app's configuration keys) into the repository. In
  this case it contained only *publishable* values — the old project's
  public database address and its anon key, which are designed to be
  visible in the browser anyway — so nothing secret was exposed. Still,
  `.env` files are exactly where secrets *would* go, so the migration
  deleted it, added `.env` to Git's ignore list so it can never be
  committed again, and added a safe fill-in-the-blanks template
  (`.env.example`) in its place. If you're migrating your own Lovable
  app, check what your committed `.env` contains.
- **Database setup scripts.** Lovable's auto-generated database migration
  files were consolidated into a single, readable "initial schema" script,
  with some hardening added (safeguards against duplicate report rows,
  indexes for common lookups, tightened function permissions). This is
  what `supabase db push` applies in step 3.
- **Pointing at the new database.** `supabase/config.toml` was updated
  from Lovable's Supabase project ID to the new self-owned one (the
  linking step in section 3 handles this automatically).

### Prompt for an AI coding assistant

If you're migrating a different Lovable app, open the repository in an AI
coding assistant (Claude Code, Cursor, etc.) and use a prompt like this as
a starting point — then review the diff it produces:

> This app was exported from Lovable Cloud and I'm migrating it to my own
> Supabase project, OpenRouter for AI, and Vercel for hosting. Please make
> the following changes:
>
> 1. **Remove the Lovable auth wrapper.** Delete the
>    `@lovable.dev/cloud-auth-js` dependency and the generated
>    `src/integrations/lovable/` module. Rewire every sign-in call that
>    used it (e.g. Google sign-in in the auth modal) to use the Supabase
>    client directly:
>    `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })`.
> 2. **Replace the Lovable AI Gateway with OpenRouter.** Find the AI
>    provider setup that points at `https://ai.gateway.lovable.dev/v1`
>    and replace it with an OpenAI-compatible provider using base URL
>    `https://openrouter.ai/api/v1` (overridable via an `OPENROUTER_URL`
>    env var), authenticated with `Authorization: Bearer
>    ${OPENROUTER_API_KEY}`. Remove any Lovable-specific headers and
>    run-ID plumbing. Add OpenRouter's model-fallback mechanism: inject a
>    `models` array into each request body listing the primary model
>    followed by a few free fallback models, so rate-limited free models
>    fall through instead of failing the request. Make the primary model
>    overridable via an `OPENROUTER_MODEL` env var.
> 3. **Target Vercel.** Configure the build for Vercel (for a
>    Nitro/TanStack Start app: set `nitro: { preset: "vercel" }` in the
>    Vite config).
> 4. **Clean up environment files.** If a `.env` file is committed,
>    delete it from the repository, add `.env`, `.vercel`, and
>    `supabase/.temp` to `.gitignore`, and create a `.env.example`
>    template documenting every variable the app needs, separating
>    public build-time variables (`VITE_*`) from server-only secrets.
> 5. **Consolidate the database migrations.** Merge Lovable's
>    auto-generated SQL migration files in `supabase/migrations/` into a
>    single initial-schema migration. Preserve the schema, make sure
>    every table explicitly enables Row Level Security with appropriate
>    policies, and add any obviously missing indexes or uniqueness
>    constraints.
>
> After the changes, the app must build and run locally with only the
> env vars from `.env.example` set, with no remaining references to
> lovable.dev anywhere in the code.

---

## 3. Set up your own database (Supabase)

Lovable's hidden database is actually Supabase under the hood, and the
app's code already speaks Supabase natively — which is why this migration
is possible without rewriting the data layer. You're essentially giving
the app the same kind of database it always had, just under your own
account.

First, install the runtime the project's tooling needs:

**Install nvm-windows** (https://github.com/coreybutler/nvm-windows/releases —
download the latest `nvm-setup.exe` and run it). This is a manager for
Node.js, the engine that runs the project's build tools; using a manager
rather than installing Node directly makes it easy to switch versions
later. After installing, open a **new** PowerShell window (an already-open
window won't see it), then run:

```
nvm install 22
nvm use 22
```

**Install Bun** — the project's package manager (already used when the app
lived on Lovable), which installs the app's dependencies and runs its
scripts. In PowerShell:

```
powershell -c "irm bun.sh/install.ps1 | iex"
```

Open a new terminal afterwards, then verify: `node --version` should print
`v22.x.x` and `bun --version` should print a version number. Finally,
install the project's dependencies — from inside the cloned folder:

```
bun install
```

Now the database itself:

1. Create an account at https://supabase.com and start a **new project**
   (this one was named `clean-start-mvp`). During creation you'll be asked
   a few questions:
   - **Enable Data API: ON** — required; this is the doorway the app uses
     to talk to the database.
   - **Automatically expose new tables: OFF** — the project's database
     script already declares explicitly which tables are reachable;
     leaving auto-exposure off means nothing becomes reachable by
     accident.
   - **Enable automatic RLS (Row-Level Security): ON** — RLS is the rule
     system that keeps each user's data visible only to them. The
     project's database script already switches it on for every table
     explicitly, so this setting is a belt-and-suspenders safety net, not
     something the app depends on.
2. In the Supabase dashboard, under **Project Settings**, note down three
   values: the **Project URL**, the **Project ID** (the short code in the
   URL), and the **Publishable (anon) key**. Despite the scary-sounding
   name, the publishable key is safe to expose — it only grants the access
   that RLS rules allow.
3. Create your local configuration file from the template:
   ```
   copy .env.example .env
   ```
   `.env` is where the app reads its keys from when running on your
   machine. It's deliberately excluded from Git (see section 2), so each
   person fills in their own. Open it in a text editor and fill in:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
     `VITE_SUPABASE_PROJECT_ID` — the values from step 2 (these end up in
     the public web page, which is fine).
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` — the same URL and key
     again, read by the server side of the app.
   - `SUPABASE_SERVICE_ROLE_KEY` — the "master key" Supabase issues
     alongside the publishable one. Unlike the publishable key, it
     **bypasses all security rules**, so never share it or commit it. The
     app's server code has an admin client that uses it; fill it in here
     for local testing of server-side flows, and it also goes into
     Vercel's environment variables in step 7.
4. Connect the project folder to your Supabase project and create the
   database tables. The Supabase command-line tool does this; you don't
   install it separately — `bunx` fetches and runs it on demand. In a
   terminal inside the project folder:
   ```
   bunx supabase login
   bunx supabase link --project-ref <your-project-id>
   bunx supabase db push
   ```
   `login` opens a browser window to authorize the tool; `link` ties this
   folder to your specific Supabase project (it also records the project
   ID in `supabase/config.toml`); `db push` runs the project's schema
   script against your empty database, creating all tables, rules, and
   indexes in one shot.

   *Windows note:* if PowerShell refuses to run the commands with a
   "scripts is disabled" error, either allow local scripts once with
   `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`,
   or prefix each command with
   `powershell -ExecutionPolicy Bypass -Command "..."`.

---

## 4. Set up "Sign in with Google" (Google Cloud)

Under Lovable, Google sign-in "just worked" because Lovable owned the
Google credentials. Independent apps need their own: Google requires every
app that offers "Sign in with Google" to be registered, so users can see
who they're granting access to.

1. Go to https://console.cloud.google.com and create a new project (this
   is just Google's container for your app's settings — no code involved).
2. Under **APIs & Services → OAuth consent screen**, fill in the basics:
   app name, support email, developer contact. This is the screen users
   see when Google asks "Do you want to let this app see your email
   address?". While the app is in **Testing** status, Google only lets
   explicitly listed **test users** sign in — add your own email (and any
   collaborators') here, or sign-in will mysteriously fail for everyone.
3. Under **APIs & Services → Credentials**, create an **OAuth 2.0 Client
   ID** of type **Web application**:
   - **Authorized redirect URI** — this is the critical one. It's where
     Google sends users back after they approve, and it must be your
     *Supabase* project's callback address, because Supabase brokers the
     whole sign-in:
     `https://<your-project-id>.supabase.co/auth/v1/callback`
   - **Authorized JavaScript origins** — add your live site's address
     once you have it (step 8). Notably, `localhost` does **not** need to
     be listed here, and local sign-in still works: the app signs in via
     a full-page redirect through Supabase, so from Google's point of
     view the interaction happens at the Supabase callback address, not
     at whatever address your app is running on. (Which addresses your
     app may run on is controlled by *Supabase's* redirect-URL list in
     step 8 instead.)
4. Google gives you a **Client ID** and **Client Secret** — copy both.
5. In the Supabase dashboard: **Authentication → Providers → Google** —
   paste in the Client ID and Secret and enable the provider. This is the
   handshake that lets Supabase complete Google sign-ins on your behalf.

---

## 5. Set up the AI provider (OpenRouter)

The app's chat feature needs a language model. OpenRouter
(https://openrouter.ai) is a single service that provides access to many
AI models — including genuinely free ones — through one account and one
key, which is why it was chosen over signing up with a specific model
vendor.

1. Create an account (signing in with GitHub is the one-click option).
2. Generate an API key. Two settings on the key were chosen deliberately:
   - **Credit limit: $0** — the key can only use free-tier models (the app
     defaults to a free model and falls back to other free models if one
     is busy), and can never accidentally spend money.
   - **Expiration: 30 days** — a stolen or leaked key goes stale on its
     own. The trade-off is that someone must regenerate it monthly and
     update it wherever it's stored (your `.env`, and later Vercel) —
     worth a recurring calendar reminder.
3. Add the key to `.env` as `OPENROUTER_API_KEY=...`. (The optional
   `OPENROUTER_URL` / `OPENROUTER_MODEL` lines in the template let you
   point at a different model service later — leave them blank for the
   defaults.)

---

## 6. Try it locally

Before putting anything on the internet, prove the pieces fit together on
your own machine — problems are far easier to diagnose here than in a
deployed environment. From the project folder:

```
bun run dev
```

Open the printed local address (typically `http://localhost:8080`) in a
browser. Confirm the app loads, you can sign in with Google, and the chat
responds (which exercises Supabase, Google, and OpenRouter in one pass).

---

## 7. Put it on the internet (Vercel)

Vercel hosts the live website and — because it watches your GitHub
repository — automatically rebuilds and redeploys every time code is
pushed. This replaces Lovable's built-in hosting.

1. Create an account at https://vercel.com, signing in with GitHub (this
   also grants Vercel permission to watch your repositories).
2. **Import** your repository as a new Vercel project.
3. During import, add the environment variables from your `.env` file —
   including `SUPABASE_SERVICE_ROLE_KEY`, which the deployed server code
   needs available. Deployed code can't read the `.env` file on your
   laptop — Vercel stores these values encrypted and supplies them to the
   app at build/run time. The import screen accepts a bulk paste of the
   whole file.
4. The first deployment builds from the repository's **default branch**.
   If you already switched the default branch to `mvp` in section 1,
   you're set. If not, tell Vercel explicitly which branch is production:
   **Project Settings → Environments → Production → Branch Tracking**,
   set it to `mvp` — and note that changing this setting doesn't rebuild
   anything by itself; trigger a deployment manually via the
   **Deployments** tab → **Create Deployment**.
5. Note the live URL Vercel assigns (this project got
   `https://cleanstart-smoky.vercel.app`).

---

## 8. Register the live address everywhere

Google and Supabase each keep an allow-list of addresses they'll cooperate
with — a standard security measure so credentials can't be borrowed by an
imposter site. Your new Vercel URL needs to be added to both, or sign-in
will work locally but fail in production:

1. **Google Cloud Console** → your OAuth Client ID → add the Vercel URL to
   **Authorized JavaScript origins**.
2. **Supabase Dashboard → Authentication → URL Configuration**:
   - **Site URL**: the Vercel URL — where Supabase sends users after
     sign-in confirmations.
   - **Redirect URLs** — every address sign-in is allowed to return to:
     - the Vercel URL (optionally with `/**` appended to allow any page)
     - `http://localhost:8080` — so local development keeps working
     - `https://<your-project>-*.vercel.app/**` — a wildcard covering
       Vercel's **preview deployments** (Vercel builds a temporary copy of
       the site for every pull request; without this wildcard, sign-in
       would fail on those previews)

With that, the migration is complete: the app runs entirely on services
you own, and Lovable is no longer involved. Day-to-day development from
here is covered in [ONBOARDING.md](ONBOARDING.md).

---

## A note on what a more professional setup would look like

The setup described above (and in [ONBOARDING.md](ONBOARDING.md)) was
deliberately kept simple so that people new to coding could get productive
quickly: one database, one set of keys, everyone working against the same
live services. That's a reasonable trade-off for a small MVP with little
real user data — but it cuts several corners that a production project
with real users would not. If the project grows, here's what would change,
roughly in order of importance:

- **Stop developing against the production database.** This is the
  biggest one. Right now, a developer running the app locally reads and
  writes the *same* database that live users depend on — a bug or a
  careless experiment can corrupt or delete real data. The professional
  pattern is that each developer runs a **local copy of Supabase** on
  their own machine (the Supabase CLI can do this with `supabase start`,
  using Docker; `docs/setup_mac.txt` sketches this for macOS), seeded with
  fake test data. Schema changes are tried locally first, then applied to
  production only when merged.
- **Add a staging environment.** Between "my laptop" and "live for
  users," mature projects keep a full middle copy — a separate Supabase
  project, its own keys, and a Vercel environment deploying from a
  staging branch. New features soak there before reaching production.
  Vercel's preview deployments currently point at the production
  database; they should point at staging instead.
- **Separate credentials per environment and per purpose.** One shared
  `.env` handed to every developer means everyone holds production
  secrets, and a leak can't be traced or revoked narrowly. Better:
  developers get only local/staging keys, production secrets live *only*
  in Vercel, and anything sensitive (like the service-role key) is held
  by as few people as possible and rotated on a schedule.
- **Automated tests and checks before merging.** There's currently no
  test suite — the safety net is clicking through the app by hand. A
  professional setup runs linting, type checks, and automated tests on
  every pull request (via GitHub Actions or similar), so a broken change
  is caught by a robot before a reviewer even looks at it.
- **Graduate the "free tier" choices.** The $0-limit, 30-day OpenRouter
  key and free AI models are fine for an MVP, but free models are
  rate-limited and can disappear; production would use a paid key with a
  modest spending cap, a pinned paid model, and monitoring on usage.
  Similarly, the Google OAuth app would be moved out of **Testing**
  status (so anyone can sign in, not just listed test users), which
  requires completing Google's verification, and the app would get a
  real custom domain instead of a `*.vercel.app` address.
- **Error monitoring and backups.** Someone should know when the live app
  breaks *before* a user reports it (an error-tracking service like
  Sentry, plus alerts) — and database backups should be verified, not
  assumed (Supabase's free tier keeps them short-lived).

None of this blocks the current way of working — it's the roadmap for
when the project has users whose data and uptime matter.
