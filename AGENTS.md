# AGENTS.md

## Required context

Before changing code, read both files completely:

1. `AGENTS.md` (this file).
2. `CLAUDE.md`, which contains the full DS Hub product context, data
   semantics, architecture, security rules, integration boundaries, and
   verification commands.

Treat `CLAUDE.md` as mandatory project context, not as optional documentation.
If it conflicts with the current source code, inspect the source and report the
difference before making a broad change.

## Working rules

- Inspect `git status --short` before editing and preserve unrelated user work.
- Never read, print, copy, or commit secrets from `.env.local`, `.ca_secret`,
  `.env.docker`, tokens, or private settings files.
- Do not invent CyberArk SIA or Identity Administration endpoints, scopes,
  payloads, or relationships. Keep those integrations contract-pending until
  the tenant contract is provided.
- Prefer existing architecture and helpers. Do not split files only because
  they are large or refactor access-control code without regression coverage.
- For logic, data-flow, authorization, transaction, or security changes, add
  a focused regression test.
- Never edit an applied SQL migration; add the next numbered migration.
- Run `npm run verify` before reporting a change as complete.
- Report changed files, tests, migration requirements, blockers, and whether the
  work is committed. Do not commit or push unless explicitly requested.

## First response for a new task

After reading both instruction files and inspecting the repository, summarize:

- the concrete requirement;
- the owning backend/frontend/integration layer;
- relevant current behavior;
- the verification you will run.

Then implement the approved task rather than stopping at a proposal.
