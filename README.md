# Clean Start

> A chat-based guide that helps rentners and households explore clean energy options — solar panels, heat pumps, EVs, and home efficiency upgrades — and produces a personalized summary report at the end of each conversation.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
  - [System Diagram](#system-diagram)
  - [Request Flow](#request-flow)
  - [Database Schema](#database-schema)
  - [Secrets & Configuration](#secrets--configuration)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running Locally](#running-locally)
- [Contributing](#contributing)
  - [Branch Model](#branch-model)
  - [Shipping a Change](#shipping-a-change)
  - [Code Quality](#code-quality)
- [Database Schema Changes](#database-schema-changes)
  - [The Core Rule](#the-core-rule-additive-first)
  - [Testing a Migration Locally](#testing-a-migration-locally)
  - [Applying to the Shared Remote](#applying-to-the-shared-remote)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)

---

## Overview

**Clean Start** is a conversational web app that guides users through the landscape of home clean energy. The AI assistant — itself named *Clean Start* — meets people where they are: it adapts to whether the user is a homeowner, a renter, or just climate-curious, and progressively moves through a three-stage conversation (discovery → education → synthesis) before offering to generate a personalized PDF/DOCX summary report they can keep.

Key product characteristics:

- **No jargon, no pressure.** The assistant is warm and plain-spoken. It never pitches vendors, never quotes prices, and stays squarely within the clean-energy-for-households domain.
- **Persona-aware.** The assistant adjusts its advice based on whether the user is a renter (focus on plug-in efficiency, community solar, talking to a landlord) or a homeowner (solar, heat pumps, insulation, EV charging, incentives).
- **Streaming AI responses.** Replies stream token-by-token directly into the browser as they're generated, with a built-in fallback chain across multiple free AI models so rate-limiting on any one model is transparent to the user.
- **Persistent chat history.** Signed-in users get a full conversation history and can revisit or re-download any previously generated report.
- **Guest mode.** First-time visitors can try the full chat experience (and get a downloadable report) without creating an account.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [TanStack Start](https://tanstack.com/start) (React + file-based routing + SSR/server functions) |
| **UI Components** | [Radix UI](https://radix-ui.com) primitives + [shadcn/ui](https://ui.shadcn.com) patterns |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com) |
| **AI / Streaming** | [Vercel AI SDK](https://sdk.vercel.ai) (`ai`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`) |
| **AI Provider** | [OpenRouter](https://openrouter.ai) — primary model `openai/gpt-oss-120b:free`, with automatic fallbacks |
| **Database & Auth** | [Supabase](https://supabase.com) (Postgres + Row Level Security + built-in OAuth) |
| **Hosting** | [Vercel](https://vercel.com) |
| **Package Manager** | [Bun](https://bun.sh) |
| **Language** | TypeScript |
| **Markdown Rendering** | [streamdown](https://github.com/streamdown/streamdown) (streaming-aware markdown) |
| **Report Export** | [jsPDF](https://github.com/parallax/jsPDF) + [docx](https://github.com/dolanmiu/docx) |

---

## Architecture

### System Diagram

```
                    ┌─────────────────────┐
                    │   Your browser      │
                    │  (the Clean Start   │
                    │   web app)          │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │      Vercel         │
                    │ (hosts the app and  │
                    │  its server logic)  │
                    └──────┬───────┬──────┘
                           │       │
                 ┌─────────┘       └─────────┐
                 ▼                           ▼
        ┌─────────────────┐        ┌──────────────────┐
        │    Supabase      │        │    OpenRouter     │
        │ (database +      │        │ (AI chat model)   │
        │  sign-in)        │        │                   │
        └─────────────────┘        └──────────────────┘
```

- **The web app** is built with React and TanStack Start. The same project contains both the visual interface (what you see in the browser) and the server-side logic (code that runs privately with secret keys to talk to Supabase and OpenRouter).
- **Vercel** builds and hosts the app. Every push to `mvp` triggers an automatic production redeployment; every PR gets its own preview URL.
- **Supabase** stores all persistent data (user accounts, chat sessions, messages, and generated reports) and handles authentication (email/password and Google OAuth). Row Level Security (RLS) is enforced directly at the database layer — users can only ever read or write their own data.
- **OpenRouter** generates the chat replies and reports. It acts as a switchboard to many AI models. The app currently defaults to a free model, with an automatic fallback chain to two further free models if the primary one is rate-limited.

### Request Flow

When a user sends a chat message:

1. The browser sends the message to a server function running on Vercel (`src/routes/api/chat.ts`).
2. The server function authenticates the user via Supabase, saves the user message to the database, then calls OpenRouter to generate a streaming reply.
3. The reply streams back token-by-token to the browser as it's generated. Once the stream is complete, the full assistant message is persisted to the database.

### Database Schema

The schema lives in `supabase/migrations/20260630000000_initial_schema.sql` and defines five tables, all with RLS enabled:

| Table | Purpose |
|---|---|
| `profiles` | One row per user (linked to `auth.users`). Stores the user's persona (`homeowner` or `renter`). Auto-created on signup via trigger. |
| `sessions` | A chat session. Belongs to a profile. Has a title, a `is_complete` flag, and timestamps. |
| `messages` | Individual chat turns (`user` or `assistant` role). Belong to a session. |
| `reports` | The generated summary report for a completed session. Stores `top_options`, `key_insights`, `next_steps`, `resources` (all JSONB), a `readiness_score`, and the user's persona at generation time. Unique per session. |
| `feedback` | Per-session thumbs-up/down rating with an optional comment. |

> **Important**: all environments — every developer's local machine and production — currently point at the **same** Supabase project and database. See [Database Schema Changes](#database-schema-changes) for what this means before you touch migrations.

### Secrets & Configuration

Config is split into two categories:

- **Public build-time values** (safe in `.env`, inlined into the client bundle by Vite's `VITE_` prefix): the Supabase project URL and public anon key.
- **Server-only secrets** (never prefixed with `VITE_`, never committed): the Supabase service role key (bypasses RLS — used only in server functions), and the OpenRouter API key.

In production, all secrets are set as encrypted environment variables in the Vercel project settings.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.x — the project's package manager
- [Node.js](https://nodejs.org) 22.x (required by some tooling; install via `nvm`)
- Access to the Supabase project credentials — request from whoever is running the project
- An [OpenRouter](https://openrouter.ai) API key (a free account works)

> **Windows users:** see [ONBOARDING.md](./ONBOARDING.md) for a full step-by-step setup guide (GitHub Desktop, `nvm-windows`, PowerShell notes).  
> **macOS users:** a quick-reference command list is in [docs/setup_mac.txt](./docs/setup_mac.txt).

### Installation

```bash
# 1. Clone the repository (the mvp branch is the default)
git clone https://github.com/fkloosterman/cleanstart.git
cd cleanstart

# 2. Copy the environment variable template
cp .env.example .env
# Then open .env and fill in your Supabase and OpenRouter credentials

# 3. Install dependencies
bun install
```

### Running Locally

```bash
bun run dev
```

Open the URL printed to the terminal (typically `http://localhost:3000`). You can sign in with email/password or Google OAuth using the shared Supabase project.

Other useful commands:

```bash
bun run lint        # ESLint
bun run format      # Prettier
bun run build       # Production bundle (usually not needed locally)
```

---

## Contributing

### Branch Model

| Branch | Purpose |
|---|---|
| `mvp` | **The working and production branch.** Vercel builds from it; it is also the repo's default branch. Branch off `mvp` for all new work and PR back into `mvp`. |
| `main` | Not actively used. Don't rely on it being kept up to date. |

Both `main` and `mvp` are protected via GitHub branch rulesets — no direct pushes, no force pushes. Everything lands via pull request.

> **Note:** The active repo is `fkloosterman/cleanstart`. There is a separate `jreddy777/cleanstart` repo that Lovable remains connected to, but it is unrelated to this codebase. We do not sync with or merge from/into it, and there is no Lovable-based editing here.

### Shipping a Change

Walk through this loop end-to-end for every change:

```bash
# 1. Sync and branch from mvp
git checkout mvp
git pull
git checkout -b your-name-short-feature-description

# 2. Make your changes, then verify locally
bun run dev        # exercise the feature in the browser
bun run lint       # catch lint errors

# 3. Commit and push
git add -A
git commit -m "Short description of the change"
git push -u origin your-name-short-feature-description
```

4. **Open a PR** on GitHub targeting `mvp`. Fill in a short description of *what* changed and *why*.
5. **Check the Vercel preview** — Vercel auto-posts a preview deployment link on the PR. Click through your change in the real deployed environment before merging. This catches environment-variable and build issues that don't appear locally.
6. **Merge** once the preview looks good and any review feedback is addressed. Vercel redeploys production automatically.

### Code Quality

- **Linter**: ESLint with `typescript-eslint` and `eslint-plugin-react-hooks`. Run with `bun run lint`.
- **Formatter**: Prettier. Run with `bun run format`.
- **No automated test suite yet** — manual click-through of the feature and adjacent flows is the main safety net.

---

## Database Schema Changes

> ⚠️ **Read this section carefully before touching anything in `supabase/migrations/`.** A schema change takes effect immediately on the shared database — it affects every developer and every production user the moment it is applied.

### The Core Rule: Additive First

Because old and new code can be running against the database simultaneously (a user's stale browser tab, an in-flight Vercel deployment, a teammate on an older commit), a migration must not break code that hasn't been updated yet:

- **Adding** a table or column: safe, as long as new columns are nullable or have a default — existing code that doesn't know about them keeps working.
- **Renaming or dropping** a column or table, or tightening a constraint (e.g. adding `NOT NULL` to an existing column): only safe once you're certain no deployed code path still reads or writes the old shape. This typically requires a two-step migration across two separate deploys (add the new shape and dual-write for a while, then remove the old shape later).

When in doubt, ask: *"If this migration runs right now, before any code change ships, does the app still work? And if the old code somehow runs after this migration, does that still work?"* Both must be yes.

### Coordination

Because there is one shared database, **one person applies each migration**, and only after the PR is reviewed and merged:

1. Write the migration as a new SQL file under `supabase/migrations/`, following the naming convention `YYYYMMDDHHMMSS_short_description.sql`. Follow the style of the existing `20260630000000_initial_schema.sql` — explicit `GRANT`s and RLS policies alongside each new table.
2. Test it locally first (see below) — never apply migrations ad hoc via the Supabase Dashboard SQL editor, as this causes the committed migration history to drift from the real database state.
3. Get the PR reviewed specifically for migration safety, not just the application code.
4. Coordinate out-of-band (Slack, chat) on who will run `bunx supabase db push`. Announce before and after.

### Testing a Migration Locally

The Supabase CLI can spin up a full local Postgres + Supabase stack in Docker — completely isolated from the shared remote database.

Prerequisite: Docker Desktop running.

```bash
# macOS: start Colima (lightweight Docker runtime) if you use it instead of Docker Desktop
colima start

# Boot the local Supabase stack (first run pulls images — this will be slow)
bunx supabase start

# Apply every migration from scratch against the local stack
bunx supabase db reset
```

Point your local `.env` at the local stack's URL/keys (printed by `supabase start`), run `bun run dev`, and exercise the feature end-to-end before touching the real database.

```bash
# When done
bunx supabase stop
```

> **Windows PowerShell note:** If `bunx supabase ...` fails with a script execution error, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in your PowerShell session first (doesn't persist, no admin required).

### Applying to the Shared Remote

This is the one-person, post-merge step. First-time setup:

```bash
bunx supabase login
bunx supabase link --project-ref kqnkvtguipyprxpwlboh  # project ID is in supabase/config.toml
```

Then push pending migrations:

```bash
bunx supabase db push
```

Review the output before confirming — it shows exactly what SQL is about to run.

**Rollback:** There are no automatic "down" migrations — these are forward-only SQL files. Before applying any migration, know what you'd manually run to undo it (e.g. the `DROP COLUMN` / `DROP TABLE` that reverses an `ADD COLUMN` / `CREATE TABLE`), and write it into the PR description.

---

## Project Structure

```
cleanstart/
├── src/
│   ├── routes/                  # TanStack Start file-based routes
│   │   ├── __root.tsx           # Root layout (AppShell, auth context)
│   │   ├── index.tsx            # Landing / home page
│   │   ├── chat.index.tsx       # Main chat interface (new session)
│   │   ├── chat.$sessionId.tsx  # Resume an existing chat session
│   │   ├── chat.guest.tsx       # Guest (unauthenticated) chat mode
│   │   ├── history.tsx          # Past sessions list
│   │   ├── report.tsx           # View / download a generated report
│   │   ├── about.tsx            # About page
│   │   ├── resources.tsx        # Clean energy resources page
│   │   └── api/
│   │       └── chat.ts          # Server function: streams AI replies
│   ├── components/
│   │   ├── AppShell.tsx         # Top-level layout wrapper
│   │   ├── AuthModal.tsx        # Sign-in / sign-up modal
│   │   ├── PrivacyBanner.tsx    # Cookie / privacy notice
│   │   ├── ai-elements/         # Custom markdown renderers for AI output
│   │   └── ui/                  # shadcn/ui component library
│   ├── hooks/
│   │   ├── use-auth.tsx         # Supabase auth state hook
│   │   └── use-mobile.tsx       # Viewport breakpoint hook
│   ├── lib/
│   │   ├── ai-gateway.server.ts      # OpenRouter provider + model fallback config
│   │   ├── clean-start-prompt.ts     # System prompt builder (persona + stage)
│   │   ├── report.functions.ts       # Report generation + export (PDF, DOCX)
│   │   ├── guest-report.functions.ts # Report generation for guest sessions
│   │   ├── sessions.ts               # Session helpers
│   │   └── utils.ts                  # General utilities
│   ├── integrations/            # Supabase client setup
│   ├── router.tsx               # TanStack Router config
│   ├── server.ts                # Nitro server entry
│   └── styles.css               # Global Tailwind styles
├── supabase/
│   ├── config.toml              # Supabase CLI project config
│   └── migrations/
│       └── 20260630000000_initial_schema.sql   # Full schema (all tables + RLS)
├── docs/
│   └── setup_mac.txt            # Quick macOS dev setup commands
├── AGENTS.md                    # Contribution rules for AI coding agents
├── ARCHITECTURE.md              # Full architecture narrative
├── DATABASE.md                  # Database change process and runbook
├── ONBOARDING.md                # Step-by-step Windows onboarding (agent-guided)
├── .env.example                 # Environment variable template
├── vite.config.ts               # Vite + TanStack Start build config
├── bunfig.toml                  # Bun config
└── components.json              # shadcn/ui component registry config
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values. **Never commit real secrets.**

| Variable | Scope | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Public (build-time) | Supabase project REST URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public (build-time) | Supabase anon (public) API key |
| `VITE_SUPABASE_PROJECT_ID` | Public (build-time) | Supabase project ID |
| `SUPABASE_URL` | Server-only secret | Same URL as above, for server functions |
| `SUPABASE_PUBLISHABLE_KEY` | Server-only secret | Supabase anon key, for server functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only secret | Supabase service role key — bypasses RLS |
| `OPENROUTER_API_KEY` | Server-only secret | OpenRouter API key for AI model access |
| `OPENROUTER_URL` | Optional | Override OpenRouter base URL (default: `https://openrouter.ai/api/v1`) |
| `OPENROUTER_MODEL` | Optional | Override primary AI model (default: `openai/gpt-oss-120b:free`) |

> In production, all of the above are set as encrypted environment variables in the **Vercel project settings** — they are never stored in the repository.

---

## Further Reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — deep-dive into how the app is built and how it got here (great for new contributors and non-technical team members alike)
- [ONBOARDING.md](./ONBOARDING.md) — full step-by-step setup guide for Windows (agent-guided), with notes for macOS/Linux
- [DATABASE.md](./DATABASE.md) — the full runbook for making schema changes safely against the shared database
- [AGENTS.md](./AGENTS.md) — repo-specific rules and context for AI coding agents (Claude Code, etc.)
