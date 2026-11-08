---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-11-08
---

# Custodia web: el frontend de DS Hub, abierto

Custodia es DS Hub renombrado y publicado como código abierto (Apache 2.0).
Desde el 08/11 la web se construye sobre el frontend de DS Hub; la interfaz
propia del 22/10 se retiró y queda en Git (`617f460`).

## Qué hay en el repo

| Carpeta | Qué es | Cómo se publica |
|---|---|---|
| `web/` | La app: shell, inicio con la rueda de fuentes, Personas, CyberArk, Netskope, Ayuda. React + Vite + TypeScript | Proyecto de Pages `custodia-demo` |
| `site/` | Sitio de producto en inglés (`/`) y español (`/es/`), generado desde `site/site/` | Proyecto de Pages `custodia` |
| `demo/` | Experimento reducido anterior | No se publica |

## Dos modos de la app

- **Real:** `npm run build`. La app habla con `/api` a través de
  `web/src/cross/lib/api.ts`; en desarrollo, Vite reenvía `/api` a
  `127.0.0.1:8000`.
- **Demo:** `npm run build:demo` (define `VITE_DEMO=1`). Antes del primer
  render, `web/src/demo/install.ts` intercepta `fetch` y responde `/api`
  con `web/src/demo/mock-api.ts`. Es la misma API simulada que usan las
  pruebas e2e, así que la demo y las pruebas no pueden divergir. Nada sale del
  navegador; el build real no incluye ese código.

La demo entra con una sesión de lectura («Demo»). Una ruta que la API
simulada no conoce responde «No disponible en la demo».

## Datos

Todo nombre de la demo y las pruebas es ficticio: `acme.example`, Globex,
Initech. No se copian dominios, empresas, grupos, hosts ni remotos del
empleador de origen; ver `AGENTS.md`.

## Marca

La marca son dos registros que se cruzan (`web/public/mark.svg`, lima sobre
grafito); el favicon y el logo de la cabecera son el mismo dibujo. El resto
del sistema visual es el de DS Hub (`web/src/styles/foundation.css`).

## Verificación

`npm run verify:web` desde la raíz: tipos, lint, estilos, pruebas unitarias,
build de la demo y e2e con Chromium. El sitio se construye con
`npm run build:site`.
