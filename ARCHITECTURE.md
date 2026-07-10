# Clean Start — Architecture Overview

This document explains how the Clean Start app is built and hosted today, and how it got here. It's written to be readable by both technical and non-technical team members — technical details are included, but explained in plain language.

Clean Start is a chat-based guide that helps people explore clean energy options (solar, heat pumps, EVs, efficiency upgrades) for their home, and produces a personalized summary report at the end of a conversation.

## 1. Where we came from

The app was originally built with [Lovable](https://lovable.dev), an AI-assisted app builder. Lovable didn't just generate the code — it also _managed the infrastructure the app ran on_:

- **Database**: Lovable automatically provisioned a [Supabase](https://supabase.com) database (Postgres) for the project.
- **AI model**: Chat replies were generated through Lovable's own "AI Gateway," which proxied requests to Google's Gemini model.
- **Sign-in**: Google/Apple/Microsoft sign-in went through Lovable's own auth service before handing off to Supabase.
- **Testing/preview**: The app could only really be run and tested inside Lovable's own environment, since all of the above only worked with credentials Lovable held internally.

This worked well for one person building solo, but created two problems once more people wanted to contribute:

1. Any usage (chatting, testing) consumed the _project owner's_ Lovable credits — there was no way to spread that cost or give a teammate their own account for it.
2. Contributors were implicitly required to use Lovable itself, since nothing could be run or tested outside of it.

## 2. The migration

To make the app independent of any one person's Lovable account, we replaced each Lovable-managed piece with an equivalent, independently-owned service:

| Piece                    | Before                               | Now                                                                     |
| ------------------------ | ------------------------------------ | ----------------------------------------------------------------------- |
| Database & user accounts | Lovable-provisioned Supabase project | Our own [Supabase](https://supabase.com) project                        |
| AI model access          | Lovable's AI Gateway (Gemini only)   | [OpenRouter](https://openrouter.ai) (many models, currently a free one) |
| Sign-in (Google, etc.)   | Lovable's auth proxy                 | Supabase's built-in sign-in, directly                                   |
| Hosting                  | Lovable Cloud                        | [Vercel](https://vercel.com)                                            |
| Local testing            | Not possible without Lovable         | Fully possible on any developer's machine                               |

Along the way we also found and fixed a few pre-existing bugs this work surfaced (e.g. new chat sessions weren't always being saved correctly, and conversations weren't getting proper titles) — these weren't related to the migration itself, just issues that testing uncovered.

## 3. How the app works now

### 3.1 The pieces

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
        │  sign-in)        │        │                    │
        └─────────────────┘        └──────────────────┘
```

- **The web app** is built with [React](https://react.dev) and [TanStack Start](https://tanstack.com/start), a framework that lets the same project contain both the visual interface (what you see in the browser) and the server-side logic (code that needs to run privately, like talking to the database or the AI model with secret keys).
- **Vercel** builds and hosts the app, and automatically redeploys it whenever new code is pushed to the connected branch.
- **Supabase** stores all persistent data — user accounts, chat sessions, messages, and generated reports — and handles sign-in (email/password and Google). Each user can only ever see their own data; this is enforced directly by the database itself ("Row Level Security"), not just by the app's code.
- **OpenRouter** is what actually generates the chat replies and reports. It acts as a switchboard to many different AI models; we're currently using a free one, with automatic fallback to a couple of alternatives if the primary one is temporarily overloaded (free models can be rate-limited during heavy use).

### 3.2 A typical request

When someone sends a chat message:

1. The browser sends the message to a small piece of server code running on Vercel.
2. That server code checks who the user is (via Supabase), saves the message to the database, and asks OpenRouter to generate a reply.
3. The reply streams back to the browser as it's generated, and is also saved to the database once complete.

### 3.3 Where you can run this

The exact same codebase now runs in three places:

- **Locally**, on any developer's own computer, for day-to-day development — see `ONBOARDING.md` for setup.
- **On staging**, deployed automatically by Vercel from the `dev` branch, for testing integrated work before it reaches users.
- **In production**, on Vercel, built from the `mvp` branch, for real users.

There's no Lovable-based editing on this codebase going forward; Lovable remains connected to a separate, unrelated repo (`jreddy777/cleanstart`) that this project doesn't sync with. See `AGENTS.md` for the branch/contribution model.

**Two databases.** There are two separate Supabase projects:

- a **dev project**, used by local development and the staging deployment. It contains no real user data, so developers can experiment freely — including destructive database experiments — without coordinating with anyone.
- a **production project**, used only by the production deployment. It holds real user data and is changed only deliberately, at release time ("promotion" of `dev` into `mvp`), by one person following the process in `DATABASE.md`.

This means a mistake during development can no longer touch real users' data.

### 3.4 Secrets and configuration

The app needs a handful of credentials to run, split into two kinds:

- **Public values** (safe to have in a local config file): the Supabase project's public web address and public API key.
- **Private secrets** (never shared or committed to code): a Supabase key that bypasses normal access rules (used only by server-side code), and the OpenRouter API key.

See `.env.example` in the repo for the full list and where each one goes. In Vercel, these are configured per environment:

- The **Production** environment's variables point at the production Supabase project.
- In the **Preview** environment, **branch-scoped** variables for the `dev` branch point at the dev Supabase project — that's what makes the staging deployment safe.
- **All other preview deployments** (PRs from `wp/*` branches, PRs into `mvp`) fall through to the global Preview values, which — transitionally — still point at the **production** project, so that teammates with in-flight mvp-based work keep their current preview behavior.

**Transitional rule, until the global Preview values are flipped to the dev project:** don't use the Vercel preview of a `wp/*` feature branch to test against a database — it runs against production. Test locally (your `.env` → dev project) and on the `dev` staging deployment after merge. If a specific feature branch genuinely needs a working preview, add branch-scoped Preview variables for that exact branch name in Vercel, pointing at the dev project.

**Hard deadline for the flip:** before the first Phase 1 migration (WP1.2) merges to `dev`. From that point, feature-branch code expects schema the production database doesn't have, so previews falling through to prod values would be broken at best. When mvp-based feature work has wound down, flip the global Preview variables to the dev project and delete the transitional branch scopes.

Local `.env` files point at the dev project (developers still finishing mvp-based work may keep prod values until they switch to `dev`-based work).

## 4. Where things stand / what's next

- The production deployment is connected to a personal fork (`fkloosterman/cleanstart`) of the original GitHub repository (`jreddy777/cleanstart`), because of GitHub permission limitations on the original repo. Unlike earlier plans, this is now the permanent working setup, not a temporary one pending a merge back — see `AGENTS.md` for the current branch model.
- A couple of smaller product gaps were identified during testing (e.g. a user's stated persona/situation isn't currently saved to their account) and are tracked as follow-up work rather than fixed as part of this migration.
