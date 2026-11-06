# Commit and Branch Strategy

The hackathon requires meaningful incremental commits, documented AI assistance, no large unexplained commits, and a repository that accurately reflects the work done during the event. This is the process the project actually follows.

## Branches

- `main` is the integration branch. It is updated only by merged pull requests.
- One feature branch per module or topic: `feature/agent-registry`, `feature/dependency-registry`, `feature/discovery-prerequisites`, `feature/graph-engine`, `feature/landing-page`, `docs/project-documentation`.
- A branch that depends on an unmerged branch is created from it (stacked). When the earlier branch is merged with a merge commit, the stacked branch's pull request shows only its own commits.
- Pull requests are merged with **merge commits**, keeping the module history visible.

## Commits

- Small, focused commits grouped by layer: database and migrations, then service code, then tests, then documentation. Typical order: schema → implementation → tests → docs.
- Messages are short, plain English, lowercase, describing what the change does (for example `add agent/resource external references and append-only dependency evidence`). Conventional-commit prefixes are used occasionally but not required.
- No co-author trailer is added to commit messages. AI assistance is disclosed in [05-ai-usage-attribution.md](05-ai-usage-attribution.md) instead.
- Never commit secrets, `.env` files, local databases or third-party assets that are not ours. `designs/` and `landing/` (a third-party mirror and reference images) are deliberately kept out of Git.

## Safety rules

1. **Never force push** (including `--force-with-lease`), and do not rewrite pushed history. To bring a branch up to date, `git merge origin/main` and push normally.
2. Do not commit or push without the owner's explicit decision. Automation proposes commands; the owner runs them.
3. Do not merge your own pull request before it passes the checks (typecheck, lint, tests).
4. Do not discard uncommitted work to switch branches; use a separate worktree.

## Pull request template (informal)

- **What this adds** (a short list).
- **Things worth reviewing** (security-relevant decisions).
- **Known gaps** (honest limitations).
- **How to test** (`docker compose up -d --wait`, `pnpm install`, `pnpm typecheck && pnpm lint && pnpm test`).

## Checks before a pull request

`pnpm typecheck`, `pnpm lint`, `pnpm test` all pass; docs for the module are updated in the same branch; any new environment variable is documented in [operations/03-environment-configuration.md](../operations/03-environment-configuration.md); status tables (README, landing page) are updated.

## Evidence of development during the event

The Git history is the record. Module branches and merge commits show incremental work; the first commits are documentation (README, PRD, architecture scaffolding) and the code follows in module order.
