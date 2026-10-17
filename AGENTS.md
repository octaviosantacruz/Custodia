# AGENTS.md

This is the single source of instructions for any coding agent working in
this repository — Claude Code, Codex, or others. There is no separate
`CLAUDE.md`; that file now only points here.

## What this is

Custodia: a CMDB-style inventory tool for two security platforms, each with
multiple tools, all isolated by `source_system`:

- **CyberArk**: Privilege Cloud/PAM (`cyberark` — Safes, members, accounts,
  platforms, PSM/connectors), Identity Administration
  (`identity_administration`), SIA (`sia`) and Access space (`access`).
- **Netskope**: SSE inventory (`netskope` — users, devices, alert aggregates
  and DLP incidents).

It began with CyberArk Privilege Cloud Safes: a full history in PostgreSQL,
with the operations team classifying each Safe (owner, business unit,
remediation status) independently of what CyberArk reports — a new sync never
silently overwrites a human decision. Tools of either platform that lack an
approved contract stay blocked (see `docs/tracking/TO_IMPLEMENT.md`); no
other vendor is in scope.

Stack: FastAPI + PostgreSQL (`psycopg`) backend, React + TypeScript + Vite
frontend, plain sequential `.sql` migrations applied by a tracked runner;
historical migration files are immutable and are not merged or deleted after
application.

## Commands

```bash
# Install
backend/.venv/bin/python -m pip install 'pip>=26.2,<27'
backend/.venv/bin/pip install --require-hashes -r backend/requirements.lock.txt
backend/.venv/bin/pip install -r backend/requirements-dev.txt
npm ci && npm ci --prefix frontend

# Run both backend (:8000) and frontend (:5174)
npm run web

# Backend tests (all)
cd backend && .venv/bin/python -m unittest discover -s tests
# Single test file / case (tests mirror platform/tool ownership)
cd backend && .venv/bin/python -m unittest tests.cyberark.pam.test_cyberark
cd backend && .venv/bin/python -m unittest tests.cyberark.pam.test_cyberark.SomeTestCase.test_something

# Frontend build (also runs typecheck with the explicit TypeScript 7 compiler)
npm --prefix frontend run build

# E2E por plataforma (grupos en frontend/scripts/e2e-groups.mjs; E2E_PORT=NNNN
# permite corridas en paralelo sin chocar en el puerto 4173)
npm --prefix frontend run test:e2e:netskope   # netskope*.spec.ts
npm --prefix frontend run test:e2e:cyberark   # pam, safes, sia, identity, posture
npm --prefix frontend run test:e2e:cross      # shell, dashboard, Personas, etc.

# Full pre-commit verification (includes an ephemeral local PostgreSQL cluster
# for backend integration tests, then compile, probes, frontend tests/build and
# git diff check; CUSTODIA_SKIP_PG=1 is an explicit local escape)
npm run verify   # == scripts/verify.sh
# verify + Playwright e2e + supply-chain audit
npm run verify:full

# Apply pending SQL migrations (idempotent, tracked in schema_migrations)
scripts/migrate.sh
```

Docker deployment (separate backend/frontend images, external Postgres) is
documented as a future design in `docs/operations/deployment.md`; Dockerfiles
and Compose are currently absent. The active host deployment uses systemd and
`npm run deploy`; migrations run with `./scripts/migrate.sh` from the
configured checkout. The container commands are retained only as a future
reference until Docker is explicitly reintroduced.

For configured checkouts, `npm run web:backend` and `scripts/migrate.sh` pass
through `scripts/run_with_database_secret.py`. When `DATABASE_SECRET_ID` is
set, it validates the current `DATABASE_URL` and retrieves `AWSCURRENT` via
AWS CLI only if the URL is missing or PostgreSQL rejects the credential
(`cross/services/database_credentials.py`'s `_is_authentication_failure` covers both
the literal invalid_password SQLSTATE and the `pg_hba.conf` rejection RDS
raises for a stale password). The recovered value stays in process
memory/environment and must never be logged or written back to an env file. The only sanctioned way to persist it is the explicit, opt-in
`scripts/refresh_database_password.sh`, which validates the AWS password against
PostgreSQL and writes it atomically (mode 0600, never printed) to
`DATABASE_PASSWORD_FILE` for tools that read the file directly; the app and
`migrate.sh` never need it.
That preflight only runs once, at process startup; the running backend also
carries a `DatabaseCredentialProvider` (`app.state.database_credential_provider`,
wired in `lifecycle.py`) as the pool's live `conninfo`, so a password rotated
while the process is already running recovers via the pool's
`reconnect_failed` hook instead of needing a manual restart. See
`docs/operations/deployment.md`.

## Architecture

The application is organized first by platform and tool. Features stay inside
that tool; they do not become sibling tool packages. Shared and cross-source
composition lives in `cross/`, while CyberArk-only shared code lives in
`cyberark/shared/`.

Both `backend/app/` and `frontend/src/` use:

```text
cyberark/
  pam/
  identity_administration/
  sia/
  access/
  risk_management/
  shared/
netskope/
  sse/
cross/
```

Backend layering remains strict (see `docs/architecture/modularity.md`):

- Each tool owns its `api/routes/`, `services/`, `repositories/` and
  `integrations/`, plus its synchronizer where applicable.
- `api/routes/` handles HTTP, authentication, validation and responses. No SQL
  or external payload mapping here. Services transform and validate;
  repositories own PostgreSQL and transactional audit; integrations own
  external HTTP and approved contracts.
- `cross/` owns local/OIDC authentication routes, users and permissions,
  audit/activity, operational logs, search, durable sync queue, generic CMDB
  persistence/coverage, person views and their sanctioned identity bridges.
  Netskope routes belong to `netskope/sse/api/routes/`, including experience.
- `cyberark/shared/integrations/oauth_client.py` provides the shared OAuth
  transport. Concrete tenant contracts remain in each tool's integration.
- `main.py`, `lifecycle.py`, `sources.py` and `sync_coordinator.py` are the
  composition/startup layer. `sources.py` remains the explicit source registry;
  each tool owns `source.py:register()` and its contracts/adapters/routers.
  Add a backend tool by creating its folder (including `source.py:register()`),
  importing that register in `sources.py` and adding one registration line
  to `TOOLS`; `main.py`, CMDB/ingestion facades and the coordinator iterate
  those definitions without new tool imports. `source_contract.py` holds
  dependency-free shared types. Core configuration, database and
  session authorization (`config.py`, `db.py`, `auth.py`) stay at the root.
- Backend `cross/` uses neutral contracts; concrete tool imports are limited
  to the sanctioned `identity_pam_bridge.py`, `person_chain_queries.py` and
  `person_client_coverage.py` bridges. Between CyberArk tools, preserve only
  PAM→SIA in `pam_chain_expand.py` and Identity Administration→PAM in chain
  models. No direct CyberArk↔Netskope imports.
- Shared HTTP models `IngestionStart` and `ConnectionImport` belong to
  `cross/api/routes/ingestion_models.py` and `connection_inventory_models.py`;
  PAM reexports them for compatibility.
- Request schemas for PAM live in `cyberark/pam/schemas.py`; shared account
  email validation lives in `cross/services/email_validation.py`. Import
  repositories from their owning modules, without a global repository barrel.

Backend tests mirror the principal owner under `tests/cyberark/<tool>/`,
`tests/netskope/` and `tests/cross/`. Multi-tool, bridge and security/auth tests
belong to `cross/`; shared fixtures live in importable `tests/support/`. Each
directory has `__init__.py` for recursive unittest discovery.

Documented extraction boundaries:
- Root `auth.py` stays unsplit until integration tests cover local login,
  password change, permissions, and OIDC. Moving the existing HTTP modules
  into `cross/` does not change this boundary.
- No generic repository abstraction: Safes, accounts and catalog queries have
  distinct filters/contracts.
- Split responsibilities only with regression coverage; line count alone is
  not a reason to split.

Frontend:
- Each tool owns its `components/`, `hooks/`, `lib/` API/helpers and `types/`.
  Netskope inventory, dashboards, endpoint posture, DEM and DLP all belong to
  `netskope/sse/`; they are features of SSE, not separate tool packages.
- `cross/` owns shell/auth, shared controls/charts/dashboard editing
  primitives, routing/navigation metadata, search, sync, person views,
  workspace/team preferences and shared transports.
- `cyberark/shared/router.tsx` composes the existing CyberArk workspaces.
  The Identity and SIA hubs in `cyberark/shared/components/` compose multiple
  CyberArk tools without changing each tool's data/permitted endpoints.
  The administrative router is `cross/routers/admin-router.tsx`; Netskope's
  router is `netskope/sse/router.tsx`.
- Each frontend tool declares its workspaces, categories, domains, sync
  metadata, manual sync action and lazy runtime in its own `source.ts`;
  `src/sources.ts` is the single static registry (add a tool: new `source.ts`
  plus one line there) and `src/source-contract.ts` holds the shared types.
  `cross/lib/workspace-catalog.ts`, `domains.ts` and `sync-source.ts` derive
  from it, and `cross/routers/registered-workspace-router.tsx` mounts the
  runtimes. Navigation grouping and runtime source isolation are distinct.
- `cross/lib/api.ts` is the common HTTP transport. Domain API calls belong in
  the owning tool's `lib/`. `cross/lib/password-policy.ts` is the shared
  password policy.
- Keep styles next to their component owner; chart/chain styles shared by
  multiple tools belong to `cross/`. PAM-only advanced charts, engines, saved
  chain questions, Safe audit types and overflow actions belong to `cyberark/pam/`.
  The technical error dialog (`ErrorDetailsButton`) belongs to `cross/components/`.
- Dashboard widget response models live in each tool's
  `api/routes/preferences_models.py`; only workspace/role-template models
  remain in the cross file of that name.
- The criteria for what belongs in `cross/` are in
  `docs/architecture/modularity.md` ("Qué pertenece a `cross/`").

## Auth model

`AUTH_MODE` supports three modes:

- **`local`**: local users live in Postgres and authenticate through signed
  sessions (`SessionMiddleware`).
- **`oidc`**: Google Workspace/Okta via `authlib`; the identity provider is
  the browser login authority and mapped groups are synchronized to local
  role assignments.
- **`hybrid`**: both local login and OIDC login are enabled. This is the mode
  used during the current migration to OIDC; it must not be described as
  equivalent to OIDC-only production hardening.

For scripts and automation, writes authenticate separately through
`APP_WRITE_TOKEN` + `X-Access-Token` (constant-time comparison), attributed
to `APP_ACTOR_ID`; this token path is not a browser login mode and does not
grant read access.

OIDC group mapping uses `OIDC_GROUP_CLAIM`, `OIDC_ROLE_MAP_JSON` and the
optional `OIDC_DEFAULT_ROLE` (see `cross/services/oidc_mapping.py`). OIDC must not
be enabled or claimed as complete until the issuer, client credentials,
redirect/origin settings and provider group claim are configured for the
target environment. The local OIDC checklist is in
`docs/operations/authentication.md`.

Authorization is not limited to the legacy `reader`/`operator`/`admin`
roles. Effective permissions are resolved from the access catalog:

- platform roles: `reader`, `operator`, `admin`;
- CyberArk PAM roles: `cyberark_reader`, `cyberark_operator`,
  `cyberark_admin`;
- CyberArk Safes and Cobertura (destination inventory) permissions come in read/manage pairs: `safes:read` /
  `safes:manage` and `coverage:read` / `coverage:manage` (`safes:manage` covers every classification write,
  `coverage:manage` the import, edits and export of the destination inventory). Safe and account CSV exports still
  require `inventory:export`. `safes:classify`, `safes:bulk_classify` and `connections:import` are legacy codes no
  route enforces any more;
- CyberArk tool roles: `sia_reader`, `identity_reader`;
- Netskope roles: `netskope_reader`, `netskope_admin`;
- `bigid_reader` / `bigid_admin` are seeded as `planned` placeholders with
  no integration code and no product commitment — do not scaffold a BigID
  source;
- custom composite roles select a level per domain instead of copying
  permissions. Current domain codes include `platform`, `pam`, `sia`,
  `identity`, `dlp` and `dspm`; lifecycle status determines whether a
  planned domain or role is currently usable.

Routes enforce the resulting permission codes server-side. Examples include
`access:manage` for platform administration, `pam:catalogs_read` for PAM
technical catalogs, `sia:catalogs_read`, `identity:catalogs_read` and
`netskope:read` for their corresponding read surfaces. The source of a role
(local assignment or OIDC group) does not bypass those route-level checks.

`SESSION_SECRET` is required for all three modes. `.ca_secret` holds the CyberArk
client secret and is never committed; in Docker it's mounted as a secret at
`/run/secrets/ca_secret`.

An authenticated local/OIDC session may issue a short-lived personal token via
`POST /api/auth/api-tokens`. It is an opaque `Authorization: Bearer` credential
for `GET`/`HEAD` only; permissions are resolved live, plaintext is returned
once, and only its digest is persisted. It does not replace or widen the
write-only `APP_WRITE_TOKEN` contract. See `docs/operations/authentication.md`.

## Migrations

`migrations/NNN_description.sql` — sequential, immutable, tracked in
`public.schema_migrations` by `scripts/migrate.py`. Never edit an already-
applied migration; add a new numbered file instead. The runner takes a
Postgres advisory lock; for an empty schema it applies the consolidated
`migrations/baseline.sql` (currently 001–065, controlled by
`USE_SCHEMA_BASELINE`, default true), and it auto-baselines 001–013 only for
a legacy pre-existing schema with no tracking rows.

## Docs

`docs/` (Spanish, intentionally excluded from what ships) holds
architecture, product, and operational decisions. Check
`docs/architecture/integration-contracts.md` (CyberArk) or
`docs/architecture/netskope-api.md` (Netskope) before touching any integration
work and `docs/tracking/TO_IMPLEMENT.md` for the canonical pending-work
tracker (`IMPLEMENTED.md` indexes closed work; its detail lives in
`docs/tracking/done/`). Skip docs whose frontmatter says `estado: histórico`
unless the task asks for that context. Known CyberArk data-shape
quirks are summarized in the "Product context" section of this file.

Some local, ignored historical records may still say `CLAUDE.md` or cite
`CLAUDE.md:<line>` (for example `TO_CODEX.md`). Do not edit those records to
retarget the reference; read `AGENTS.md` as the current file they meant.

## Git remotes

The current checkout has four configured remotes: `itti` (the active
`itti-cybersecurity` SSH remote), `gvz` (the original personal SSH remote),
`origin` (currently pointing to the same organization URL), and
`Cybersecurity-Org` (an HTTPS alias pointing to the same organization URL).
There is no automated sync; push explicitly to the intended remote. See
`docs/operations/deployment.md` for the SSO/SSH requirement on `itti` and the
history notes. Do not remove or repoint the duplicate aliases without an
explicit repository-owner decision.

## Product context and non-negotiable data rules

The product is **Custodia**, an operational CMDB for two platforms: **CyberArk**
(Privilege Cloud/PAM, Identity Administration, SIA, Access space) and
**Netskope** (SSE). It is not a generic demo, spreadsheet replacement, or
graph experiment. The useful output is a trustworthy inventory that lets
operations classify Safes, review accounts and members, audit local changes,
and explore the PAM chain and the Netskope facets without mixing tools or
platforms.

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
- Credential-rotation KPIs (`% rotadas en 90 días`, last-verified age) are NOT
  implemented and must not be faked from other fields. `CPM-001` (accepted
  2026-10-03) persists only the allowlist `automatic_management_enabled`,
  `management_status` and `secret_modified_at` in `cyberark_accounts.attributes`
  (absent = "Sin dato"; `lastReconciledTime`/`lastVerifiedTime` do not exist in
  the tenant and are never stored); the UI labels it "Último cambio de secreto o
  alta" and states it is not rotation. A rotation KPI needs a new explicit
  product decision (see `docs/architecture/decisions/005-no-rotation-kpis.md`).
  `GET /api/analytics/freshness` only reports Safe `last_modification_time` age
  and account-inventory thinness/staleness, and the UI must label that as
  freshness, not rotation.
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
  The single sanctioned exception (approved 2026-10-06): when a complete sync
  retires an account of a Safe whose human next action is "Dar de baja" and
  whose status is still `pending`/`in_progress`/`blocked`, only
  `workflow_status` moves to `retention_hold` ("Baja retenida", CyberArk keeps
  the deleted account through the Safe's retention). Implemented in
  `_hold_decommissions_for_deleted_accounts` (`cyberark/pam/services/pam_accounts.py`),
  audited as `system:sync` in the same transaction; every other Safe keeps
  what a person set. Decision record: `docs/architecture/decisions/004-retention-hold.md`
  (test: `test_account_retirement_postgres_integration.py`).

## Sync and database safety

The ingestion design has two layers:

- raw append-only snapshots, one row per Safe per run;
- staging/current tables upserted per Safe in independent transactions.

The web "Actualizar datos" action starts the complete run directly: since 2026-10-14 the UI no longer asks
the operator to confirm a Safe comparison first. `POST /api/ingestion/preview` still exists as an API for
controlled inspection (permission `ingestion:preview`), but no screen calls it; reconciliation safety rests on the
rules below (only a complete, successful run retires records), not on a confirmation step.

Scheduled and manual runs share the durable Postgres queue
(`cross/repositories/sync_queue.py`) dispatched by `sync_coordinator.py`; sources
are isolated by `source_system` and a per-source advisory lock prevents
overlapping runs.

Only a complete, successful run may reconcile absent records as `retired`.
Never physically delete records during ingestion. A partial response, API
format change, duplicate identifier, or network failure must not create false
retirements. Local workflow assignments remain intact after a sync.

Before SQL/database work:

- inspect the migration and current schema first;
- never edit an applied migration; add the next numbered migration;
- use parameterized queries and existing repository helpers;
- preserve transaction boundaries, especially when writing audit records;
- do not print or paste `DATABASE_URL`, passwords, `.env.local`, `.env.docker`,
  `.ca_secret`, or OAuth tokens into chat, logs, tests, commits, or prompts;
- local PostgreSQL may be reached through the configured connection string;
  Docker is not required for code work, but do not assume `psql` is installed;
  the backend's `psycopg` environment can be used for read-only checks.

## Security and authorization rules

Local authentication uses signed sessions and database users. OIDC is
prepared for Google Workspace/Okta but must not be enabled or claimed as
complete until its environment and callback configuration are supplied.

The legacy platform roles remain intentionally narrow:

- `reader`: read-only inventory;
- `operator`: inventory/catalog operational writes;
- `admin`: user/role management and restricted exports.

Domain-specific and composite roles are resolved through the same permission
catalog described above; they do not widen access merely because a user
authenticated through OIDC or because a role is named `admin` in another
domain.

CSV exports are operational convenience files for an authorized provider or
external area, not a database dump. They require `inventory:export`, currently
assigned only to `admin`, are audited, contain no secrets, and neutralize
spreadsheet formula cells. Keep the filter from the active view all the way
through the component props, hook, route and parameterized repository query.

Every write must have permission enforcement server-side and an audit event.
Prefer `record_audit(..., connection=conn)` over hand-written audit inserts so
an audit row participates in the same transaction as its mutation.

## Integration contract boundary

Each tool owns its tested contractual clients under
`backend/app/cyberark/<tool>/integrations/` or
`backend/app/netskope/sse/integrations/`, with HTTPS validation, retries and
source-scoped synchronization. CyberArk uses OAuth client credentials;
Netskope uses `Netskope-API-Token`. Their manual run routes are:

- `POST /api/ingestion/identity-admin/runs`
- `POST /api/ingestion/sia/runs`
- `POST /api/ingestion/access/runs`
- `POST /api/ingestion/netskope/runs`

No source is enabled merely because a URL exists in the environment. The full
set of approved variables, permissions, pagination behavior and payload rules
lives in `docs/architecture/integration-contracts.md` (CyberArk) and
`docs/architecture/netskope-api.md` (Netskope).

Do not infer one source's objects or relationships from another's: SIA
policies, ZSP, users and roles never come from PAM Safes, members, platforms
or account rows, and Netskope users/devices/alerts never come from CyberArk
data. Keep every source isolated by `source_system`. If a tenant contract or
configuration is missing, the client must fail clearly and the UI must not
fabricate coverage. The versioned probes under `scripts/` are for controlled
inspection only.

There are three sanctioned identity exceptions, all read-only (the first two
SIA-excluded), never fed into `/api/cmdb/coverage` or any KPI, and enforced by
`test_identity_admin_isolation.py` (the third also by
`test_person_role_access_isolation.py`); only the third reads roles:

- the Identity drawer's PAM-chain bridge
  (`cross/repositories/identity_pam_bridge.py`, `GET /api/cmdb/identity-users/{id}/pam-chain`)
  links an Identity Administration user to a PAM user by exact `source_id`
  equality (shared CyberArk Identity UUID);
- the person-link exception (approved 2026-09-25) also allows an **exact
  email, 1-to-1** match to link persons across tools, implemented only in
  `cross/services/person_email_matching.py` (human PAM users only, technical tenant
  domain excluded). Never by name, prefix or similarity; the UI labels it
  "vinculado por correo".
- the role-name exception (approved 2026-10-05) lets the person view count
  PAM Safes a person reaches through an Identity role when they have no PAM
  user of their own: an Identity role links to a PAM role only by **exact
  display name, unique on both sides**, implemented only in
  `cross/repositories/person_role_access.py` and enforced by
  `test_person_role_access_isolation.py`; the UI labels it as access by role,
  a name reference, never a confirmed link. The same approval covers SIA:
  a SIA policy reaches a person when a `granted_users` entry is exactly their
  Identity user name (unique among Identity users) or PAM user name, or a
  `granted_roles` entry is exactly one of their Identity roles whose name is
  unique among Identity roles (`sia_access_for_person`, same module).

See "Excepciones sancionadas entre fuentes" in
`docs/architecture/integration-contracts.md`. Each exception has a decision record
with its approval date and enforcing test: `docs/architecture/decisions/001-identity-pam-source-id.md`
(`test_identity_admin_isolation.py`), `002-person-email-link.md`
(`test_person_email_matching.py`) and `003-person-role-name-access.md`
(`test_person_role_access_isolation.py`).

After the exact UUID match, that bridge delegates to the PAM-only traversal in
`cyberark/pam/repositories/pam_chain_queries.py`, which follows the four verified edge
types through platform and PSM. The dedicated `/pam/graph` workspace calls the
same traversal by PAM user `object_id`; it is single-source and does not add
SIA name references to the graph.

## Frontend product rules

The main workflow is a dense but readable inventory table plus summary views.
Keep the Safe table useful for scanning 465+ rows: stable columns, sticky or
clear identity context, pagination, account search, explicit empty/loading/error
states, and a detail drawer for members, accounts and technical metadata.

**Desktop-form-factor web product:** Custodia remains a browser-based web
application; “desktop” describes the supported browser form factor on staffed
workstations, not a native desktop application. Phones and touch-first use are
explicitly out of scope. Do not add responsive mobile layouts, mobile-only
navigation, touch/gesture affordances, mobile viewport E2E coverage, or
simplified mobile data presentations unless the repository owner explicitly
reopens that product decision. Do not let a narrow viewport constraint reduce
desktop density or reshape a desktop interaction. Existing responsive CSS may
remain for graceful degradation, but it is not a feature to extend, test, or
use as a reason for new abstraction.

Every view answers one question for one persona and the menu is ordered by
those questions; one entity appears in one table per screen. Before adding or
moving a view, read `docs/architecture/view-design.md` (checklist included).

Use custom controls already present in the design system (`CompactSelect` and
related components) instead of browser `alert`, `prompt`, or raw selects for
new interactions. Keep dark mode as the default, use the green Custodia accent
with restrained semantic colors, and ensure status, account type, unit and
responsible selectors remain legible in both themes. Avoid card nesting,
marketing copy, and visual changes that reduce data density.

The user menu should expose the signed-in user's role and logout. Password
creation/change must display the shared policy from `cross/lib/password-policy.ts`.
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

First response for a new task should summarize: the concrete requirement, the
owning backend/frontend/integration layer, relevant current behavior, and the
verification you will run — then implement the approved task rather than
stopping at a proposal.

When a source contract or tenant configuration is incomplete, continue
improving tests, validation, documentation, and local behavior, but do not
fabricate external payloads, relationships or readiness.
