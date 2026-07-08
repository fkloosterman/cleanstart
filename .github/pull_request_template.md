## What & why

<!-- Short description of the change and its motivation. Link the WP id
from docs/implementation-plan-personalization.md if this is a work
package (e.g. "WP1.4"). -->

## Checklist

- [ ] Tests pass locally (`bun run test`)
- [ ] If this PR touches an LLM prompt (`src/lib/prompts/` or any string
      sent to a model): ran `bun run evals` against the prod-designated
      model — pass (D16)
- [ ] If this PR contains a migration: it is additive-only, and the PR
      description states the manual rollback SQL (see `DATABASE.md`)
