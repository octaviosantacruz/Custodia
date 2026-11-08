# Custodia

**English** · [Español](README.es.md)

A security tool inventory with provenance, explainable changes and human
decisions that a sync never overwrites.

Custodia is DS Hub, renamed and open-sourced under the
[Apache 2.0](LICENSE) license. `web/` is its frontend, in English and Spanish:
a home page with the wheel of sources, People, CyberArk, Netskope and Help. It
builds against the real API or as a static demo that runs in the browser with
a simulated API and fictional data ([WEB.md](docs/WEB.md)). `site/` is the
product site.
**It does not include the Go backend or real authentication yet.** The chosen
order is portfolio first, then a self-hosted install and, once usage is
validated, an evaluation of SaaS.

- Live demo: <https://custodia-demo.pages.dev> (`?lang=en` or `?lang=es`)
- Product site: <https://custodia.octaviosantacruz.com>

## Getting started

1. Read the [review of the existing product](docs/EXISTING-PRODUCT.md): the
   Python flows and contracts are the reference for the new interface.
2. Walk through the [demo](docs/WEB.md) and follow the
   [tracker](docs/TO_IMPLEMENT.md): port the contracts to Go flow by flow.

```bash
cd web
npm ci
npm run preview:demo   # static demo, no backend
# http://127.0.0.1:4184
```

The product site builds with `npm run build:site` (or
`cd site && npm ci && npm run dev`). The reduced demo in `demo/` is kept as an
earlier experiment; it is not the current demo.

## Languages

The interface speaks Spanish (the source language) and English. Texts are
wrapped as `t('Texto en español')`; English lives in
`web/src/cross/i18n/en.ts`. The language is picked from `?lang=`, then the saved
choice, and can be switched from the user menu. The published demo follows the
browser language; the app with a backend starts in Spanish.
`node scripts/i18n-report.mjs --missing` (in `web/`) lists texts without a
translation.

## Documentation

The project documentation is written in Spanish.

| Topic | Document |
|---|---|
| Scope and stages | [Product](docs/PRODUCT.md) |
| Fictional company, current site and demo | [WEB.md](docs/WEB.md) · original scenario in [COMPANY-DEMO.md](docs/COMPANY-DEMO.md) |
| Go and PostgreSQL | [Architecture](docs/ARCHITECTURE.md) |
| Configuring and syncing tools | [Connectors](docs/CONNECTORS.md) |
| Switchboard (now Ozal), OIDC and QA | [Access](docs/ACCESS.md) |
| Interface and sample walkthrough | [Design](docs/DESIGN.md) |
| Criteria to move forward | [Validation](docs/VALIDATION.md) |
| Where the demo content comes from | [Provenance](docs/PROVENANCE.md) |
| Screenshots, ES/EN copy and portfolio package | [Presentation](docs/PRESENTATION.md) |
| Accepted decisions and recommendations | [Decisions](docs/DECISIONS.md) |
| What was reused and what was retired | [Review reference](docs/REFERENCE.md) |
| Pending work and delivered evidence | [Pending](docs/TO_IMPLEMENT.md) · [Closed](docs/IMPLEMENTED.md) |

## Verification

```bash
npm run verify:web      # types, lint, styles, unit tests, demo build and e2e for web/
npm run build:site      # product site
npm run verify          # docs + company and experiment models
npm run verify:demo     # only the earlier reduced experiment, in demo/
```

`verify` needs Node.js 24 or later. Browser tests use Playwright with Chromium
(`npx playwright install chromium`; system libraries with
`npx playwright install-deps chromium`, using sudo).

## Relationship with the previous version

The `product/go-reset` branch starts from `f6a7acc`: it first removed the
legacy tree, then recovered its frontend in `company-demo/` (commit `71c68de`)
and on 22/10 retired it in favor of the new interface in `web/`.
It does not recover the backend or its deployment configuration. The checkout
at `/home/saint/projects/Custodia` is the product's only checkout (`main`).
Since 23/10 the work v1 no longer lives on this host: it remains on the
`maintenance/v1` branch (`f6a7acc`) of `origin` and in its own environment.
The `custodia-*-dev` units were removed from this server.
The databases were not touched.
The Git history stays available as a reference; it is not material ready to
publish. Provenance and distribution are reviewed in `PROD-DIST-001`.
