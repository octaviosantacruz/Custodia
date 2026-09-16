# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DS Hub: a CMDB-style inventory tool for CyberArk Privilege Cloud Safes.
It syncs safes/members from the CyberArk API, keeps a full history in
PostgreSQL, and lets an operations team classify each safe (owner, business
unit, remediation status) independently of what CyberArk reports — a new
sync never silently overwrites a human decision.

Stack: FastAPI + PostgreSQL (`psycopg`) backend, React + TypeScript + Vite
frontend, plain sequential `.sql` migrations applied by a tracked runner;
historical migration files are immutable and are not merged or deleted after
application.

## Commands

```bash
# Install
backend/.venv/bin/pip install -r backend/requirements.txt
npm install && npm install --prefix frontend

# Run both backend (:8000) and frontend (:5173)
npm run web

# Backend tests (all)
cd backend && .venv/bin/python -m unittest discover -s tests
# Single test file / case
cd backend && .venv/bin/python -m unittest tests.test_cyberark
cd backend && .venv/bin/python -m unittest tests.test_cyberark.SomeTestCase.test_something

# Frontend build (also type-checks: tsc --noEmit && vite build)
npm --prefix frontend run build

# Full pre-commit verification (compile, backend tests, probe scripts, frontend build, git diff check)
npm run verify   # == scripts/verify.sh

# Apply pending SQL migrations (idempotent, tracked in schema_migrations)
scripts/migrate.sh
```

Docker deployment (separate backend/frontend images, external Postgres) is
documented in `docs/operations/deployment.md`; migrations run via
`python /app/scripts/migrate.py` inside the backend image or
`./scripts/migrate.sh` from a configured checkout.

## Architecture

Backend layering is strict and intentional (see
`docs/architecture/modularity.md` for the canonical version, in Spanish):

- **`api/routes/`** — HTTP only: auth, validation, responses. No SQL, no
  CyberArk mapping logic here. Routes are split into facades (`auth.py`,
  `safes.py`) plus focused modules (`safe_read.py`, `safe_write.py`,
  `safe_lifecycle.py`, `auth_session.py`, `auth_bootstrap.py`, etc.).
- **`services/`** — transformation and validation: `ingestion_*` (compare,
  source, persistence), `pam_*` (mapping, source, persistence), `cmdb_*`
  (models, persistence), `cyberark_*` (parsing, settings, transport/OAuth).
- **`repositories/`** — all PostgreSQL access, split by concern:
  `safe_queries.py`, `account_queries.py`, `safe_mutations.py` (writes +
  audit), `user_admin.py` (transactional user persistence + audit),
  `catalog_queries.py` / `catalog_mutations.py`.
- **`integrations/`** — external HTTP clients and their contracts.
  `identity_admin.py` and `sia.py` are wired through the source-specific
  synchronizers `identity_admin_sync.py` and `sia_sync.py`. They remain
  explicitly configured clients: never invent endpoints, scopes, payloads or
  relationships when a tenant contract is missing.
- `main.py` is the composition root (FastAPI app, middleware, routers).
  `lifecycle.py` owns the DB pool and ingestion scheduler lifespan.
  `cyberark.py` is a thin endpoint facade; OAuth, retries, and HTTP
  validation live in `cyberark_transport.py`.

Documented extraction boundaries (don't undo these without the stated
prerequisite):
- `auth.py` stays unsplit until integration tests cover local login,
  password change, permissions, and OIDC — it's access-control code, and a
  mechanical split without that coverage adds risk.
- No generic repository abstraction — Safes, accounts, and catalog queries
  have distinct filters/contracts and shouldn't be forced into one shape.
- A file is only worth splitting when it sheds a distinct responsibility and
  the split is covered by a regression test — not for line count alone.

Frontend (`frontend/src/`):
- `App.tsx` composes workspaces (`safes-workspace.tsx`,
  `users-workspace.tsx`, `activity-workspace.tsx`,
  `integration-workspace.tsx`, `general-workspace.tsx`) and holds global
  state; domain logic lives in `hooks/` (`use-safe-*`, `use-dashboard`,
  `use-auth`, `use-ingestion`, `use-catalog-form`).
- `app-header.tsx` composes layout/nav/notifications/profile; each popover
  is its own component sharing `hooks/use-popover.ts`.
- `safe-table.tsx` composes filters, rows, accounts, and pagination.
- `safe-detail-drawer.tsx` owns tab state; presentation lives in
  `safe-detail-sections.tsx`.
- `lib/api.ts` is the common HTTP transport; domain calls live in
  `lib/*-api.ts` (`dashboard-api.ts`, `catalog-api.ts`, `users-api.ts`,
  `activity-api.ts`).
- `lib/password-policy.ts` is the single source of truth for password rules
  on the frontend.

## Auth model

Two modes via `AUTH_MODE` (`local` or `oidc`):
- **local**: users live in Postgres, sessions are signed
  (`SessionMiddleware`); writes from scripts/automation authenticate via
  `APP_WRITE_TOKEN` + `X-Access-Token` header (constant-time compare),
  attributed to `APP_ACTOR_ID`.
- **oidc**: Google Workspace/Okta via `authlib`; identity provider groups
  map to internal `reader`/`operator`/`admin` roles through
  `OIDC_ROLE_MAP_JSON` (see `services/oidc_mapping.py`).

`SESSION_SECRET` is required for both modes. `.ca_secret` holds the CyberArk
client secret and is never committed; in Docker it's mounted as a secret at
`/run/secrets/ca_secret`.

## Migrations

`migrations/NNN_description.sql` — sequential, immutable, tracked in
`public.schema_migrations` by `scripts/migrate.py`. Never edit an already-
applied migration; add a new numbered file instead. The runner uses a
Postgres advisory lock and auto-baselines migrations 001–013 if it finds an
existing schema with no tracking rows.

## Docs

`docs/` (Spanish, intentionally excluded from what ships) holds
architecture, product, and operational decisions — check
`docs/architecture/integration-contracts.md` before touching PAM/SIA
integration work, and `docs/reference/safes-members-findings.md` for known
data-shape quirks from the CyberArk API.

## Git remotes

This repo pushes to two independent remotes, `origin` (personal account) and
`itti` (the `itti-cybersecurity` org, the active one for the team) — there is
no automated sync between them, so a commit must be pushed to each
explicitly (`git push origin main` and `git push itti main`). See
`docs/operations/git-remotes.md` for the SSO/SSH requirement on the `itti`
remote and history notes.

## Product context and non-negotiable data rules

The product is **DS Hub**, an operational CMDB for privileged access in
CyberArk Privilege Cloud. It is not a generic demo, spreadsheet replacement,
or graph experiment. The useful output is a trustworthy inventory that lets
operations classify Safes, review accounts and members, audit local changes,
and later connect PAM and SIA chains.

Current verified PAM chain:

```text
users -> roles -> safes -> platforms -> psm
```

The intended SIA chain is:

```text
users -> roles -> access policies -> sia
```

PAM data already verified from real API responses includes approximately 465
Safes, 95 users, 78 roles, 75 platforms, 3 PSMs, and the current account
inventory. Exact counts must always come from the database/run being inspected,
not from hard-coded UI text.

Important semantics:

- `safe_members` are Safe permission relationships (`User`/`Group`); they are
  not a licensing KPI and must not be presented as the number of licensed
  users.
- Account inventory belongs in `cyberark_accounts`. It is operational data
  only: account name, username, address, Safe and platform identifiers. Never
  persist or export passwords, secrets, credential attributes, or full account
  payloads.
- Credential-rotation KPIs (`% rotadas en 90 días`, automatic management
  disabled, last-verified age) are NOT implemented and must not be faked from
  other fields. They require an explicit product decision to persist a narrow
  allowlist of non-secret `secretManagement` timestamps (a new migration +
  ingestion mapping + a note in `docs/architecture/integration-contracts.md` +
  a regression test). Until then, `GET /api/analytics/freshness` only reports
  Safe `last_modification_time` age and account-inventory thinness/staleness,
  and the UI must label that as freshness, not rotation.
- Internal CyberArk Safes must be excluded from business-scope metrics only
  after an explicit classification decision. Do not infer that classification
  only from a name pattern.
- `creationTime` and `lastModificationTime` have different epoch precision in
  observed CyberArk payloads. Preserve raw data and use the existing safe
  conversion logic; do not parse timestamps through JavaScript `Number` when
  microsecond precision matters.
- `memberId` has multiple observed formats. Treat it as an opaque normalized
  identifier and preserve the raw payload.
- `membershipExpirationDate` was `null` in the observed sample. Never infer
  password rotation or expiration status from that field.
- Human workflow metadata (`business_unit`, `responsible`, workflow status,
  next action, inventory scope and quality) must not be overwritten by a
  CyberArk sync.

## Sync and database safety

The ingestion design has two layers:

- raw append-only snapshots, one row per Safe per run;
- staging/current tables upserted per Safe in independent transactions.

The web sync is deliberately two-phase:

1. `POST /api/ingestion/preview` reads CyberArk and compares changes without
   modifying staging.
2. The operator confirms the preview and starts a complete run.

Only a complete, successful run may reconcile absent records as `retired`.
Never physically delete records during ingestion. A partial response, API
format change, duplicate identifier, or network failure must not create false
retirements. Local workflow assignments remain intact after a sync.

Before SQL/database work:

- inspect the migration and current schema first;
- never edit an applied migration; add the next numbered migration;
- use parameterized queries and existing repository helpers;
- preserve transaction boundaries, especially when writing audit records;
- do not print or paste `DATABASE_URL`, passwords, `.env.local`, `.ca_secret`,
  or OAuth tokens into chat, logs, tests, commits, or prompts;
- local PostgreSQL may be reached through the configured connection string;
  Docker is not required for code work, but do not assume `psql` is installed;
  the backend's `psycopg` environment can be used for read-only checks.

## Security and authorization rules

Local authentication uses signed sessions and database users. OIDC is prepared
for Google Workspace/Okta but must not be enabled or claimed as complete until
its environment and callback configuration are supplied.

The roles are intentionally narrow:

- `reader`: read-only inventory;
- `operator`: inventory/catalog operational writes;
- `admin`: user/role management and restricted exports.

CSV exports are operational convenience files for an authorized provider or
external area, not a database dump. They require `inventory:export`, currently
assigned only to `admin`, are audited, contain no secrets, and neutralize
spreadsheet formula cells. Keep the filter from the active view all the way
through the component props, hook, route and parameterized repository query.

Every write must have permission enforcement server-side and an audit event.
Prefer `record_audit(..., connection=conn)` over hand-written audit inserts so
an audit row participates in the same transaction as its mutation.

## Integration contract boundary

`backend/app/integrations/identity_admin.py` and `sia.py` are tested contractual
clients with HTTPS validation, OAuth client credentials, retries and source-
scoped synchronization. Their routes are:

- `POST /api/ingestion/identity-admin/runs`
- `POST /api/ingestion/sia/runs`

No source is enabled merely because a URL exists in the environment. The full
set of approved variables, permissions, pagination behavior and payload rules
lives in `docs/architecture/integration-contracts.md`.

Do not infer SIA policies, ZSP, users or roles from PAM Safes, members,
platforms, or account rows. Keep Identity Administration and SIA isolated from
PAM by `source_system`. If a tenant contract or configuration is missing, the
client must fail clearly and the UI must not fabricate coverage. The versioned
probes under `scripts/` are for controlled inspection only.

The single sanctioned exception is the Identity drawer's PAM-chain bridge
(`repositories/identity_pam_bridge.py`, `GET /api/cmdb/identity-users/{id}/pam-chain`):
it links an Identity Administration user to a PAM user **only** by exact
`source_id` equality (shared CyberArk Identity UUID) — never by name/email/
heuristic, roles and SIA excluded, read-only, and never fed into
`/api/cmdb/coverage` or any KPI. See the "Excepción sancionada" section in
`docs/architecture/integration-contracts.md`; `test_identity_admin_isolation.py`
enforces the boundary.

After the exact UUID match, that bridge delegates to the PAM-only traversal in
`repositories/pam_chain_queries.py`, which follows the four verified edge
types through platform and PSM. The dedicated `/pam/graph` workspace calls the
same traversal by PAM user `object_id`; it is single-source and does not add
SIA name references to the graph.

## Frontend product rules

The main workflow is a dense but readable inventory table plus summary views.
Keep the Safe table useful for scanning 465+ rows: stable columns, sticky or
clear identity context, pagination, account search, explicit empty/loading/error
states, and a detail drawer for members, accounts and technical metadata.

Use custom controls already present in the design system (`CompactSelect` and
related components) instead of browser `alert`, `prompt`, or raw selects for
new interactions. Keep dark mode as the default, use the green DS Hub accent
with restrained semantic colors, and ensure status, account type, unit and
responsible selectors remain legible in both themes. Avoid card nesting,
marketing copy, and visual changes that reduce data density.

The user menu should expose the signed-in user's role and logout. Password
creation/change must display the shared policy from `lib/password-policy.ts`.
Never display an existing password after creation except through an explicitly
controlled, one-time admin workflow that the backend authorizes and audits.

## Working protocol for future sessions

At the start of each task:

1. Read this file, the relevant files, `docs/architecture/modularity.md`, and
   `docs/architecture/integration-contracts.md` before changing code.
2. Inspect `git status --short`; preserve unrelated user changes.
3. State the concrete bug/requirement and identify the owning layer before
   editing. Do not refactor by file size alone.
4. Make the smallest coherent change that matches existing patterns.
5. Add a focused regression test for every logic, data-flow, authorization,
   transaction, or security change. A successful TypeScript build does not
   prove that runtime values were passed through correctly.
6. Run `npm run verify` before reporting completion. For database changes,
   also run the relevant migration/read-only query when credentials are already
   configured, without printing them.
7. Report files changed, tests run, migration requirements, and any external
   blocker. Do not commit or push unless explicitly requested.

When a source contract or tenant configuration is incomplete, continue
improving tests, validation, documentation, and local behavior, but do not
fabricate external payloads, relationships or readiness.
