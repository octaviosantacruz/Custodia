# Custodia

[English](README.md) · **Español**

Inventario de herramientas de seguridad con procedencia, cambios explicables
y decisiones humanas que una sincronización no sobrescribe.

Custodia es DS Hub renombrado y abierto, con licencia [Apache 2.0](LICENSE).
`web/` es su frontend, en español e inglés: inicio con la rueda de fuentes,
Personas, CyberArk, Netskope y Ayuda. Se puede compilar contra la API real o como demo estática
que corre en el navegador con una API simulada y datos ficticios
([WEB.md](docs/WEB.md)). `site/` es el sitio de producto.
**Todavía no incluye backend Go ni autenticación real**. El orden elegido es Portfolio, instalación autohospedada y,
después de validar uso, evaluar SaaS.

## Empezar

1. Leer la [revisión del producto existente](docs/EXISTING-PRODUCT.md): los
   recorridos y contratos Python son referencia para la interfaz nueva.
2. Recorrer la [demo](docs/WEB.md) y seguir el
   [tracker](docs/TO_IMPLEMENT.md): portar los contratos a Go por recorridos.

```bash
cd web
npm ci
npm run preview:demo   # demo estática, sin backend
# http://127.0.0.1:4184
```

El sitio de producto se construye con `npm run build:site` (o
`cd site && npm ci && npm run dev`). La demo reducida de `demo/` se conserva
como experimento anterior; no es la demo vigente.

## Idiomas

La interfaz está en español (idioma fuente) e inglés. Los textos se envuelven
como `t('Texto en español')`; el inglés vive en `web/src/cross/i18n/en.ts`. El
idioma sale de `?lang=`, luego de la elección guardada, y se cambia desde el
menú de usuario. La demo publicada sigue el idioma del navegador; la app con
backend arranca en español. `node scripts/i18n-report.mjs --missing` (en
`web/`) lista los textos sin traducción.

## Documentación

| Tema | Documento |
|---|---|
| Alcance y etapas | [Producto](docs/PRODUCT.md) |
| Empresa ficticia, sitio y demo vigentes | [WEB.md](docs/WEB.md) · escenario original en [COMPANY-DEMO.md](docs/COMPANY-DEMO.md) |
| Go y PostgreSQL | [Arquitectura](docs/ARCHITECTURE.md) |
| Configurar y sincronizar herramientas | [Conectores](docs/CONNECTORS.md) |
| Switchboard (hoy Ozal), OIDC y QA | [Acceso](docs/ACCESS.md) |
| Interfaz y recorrido de ejemplo | [Diseño](docs/DESIGN.md) |
| Criterios para avanzar | [Validación](docs/VALIDATION.md) |
| De dónde viene lo que lleva la demo | [Procedencia](docs/PROVENANCE.md) |
| Capturas, textos ES/EN y paquete para Portfolio | [Presentación](docs/PRESENTATION.md) |
| Decisiones aceptadas y recomendaciones | [Decisiones](docs/DECISIONS.md) |
| Qué se aprovechó y qué se retiró | [Referencia de la revisión](docs/REFERENCE.md) |
| Pendientes y evidencia entregada | [Pendientes](docs/TO_IMPLEMENT.md) · [Cierres](docs/IMPLEMENTED.md) |

## Verificación disponible

```bash
npm run verify:web      # tipos, lint, estilos, unitarias, build de la demo y e2e de web/
npm run build:site      # sitio de producto
npm run verify          # documentos + modelos de empresa y experimento
npm run verify:demo     # sólo el experimento reducido anterior, en demo/
```

`verify` requiere Node.js 24 o superior. Las pruebas de navegador usan
Playwright con Chromium (`npx playwright install chromium`; las librerías del
sistema con `npx playwright install-deps chromium`, con sudo).

## Relación con la versión anterior

La rama `product/go-reset` parte de `f6a7acc`: primero retiró el árbol heredado;
luego recuperó su frontend en `company-demo/` (commit `71c68de`) y el 22/10
lo retiró en favor de la interfaz nueva de `web/`.
No recupera el backend ni su configuración de despliegue. El checkout
`/home/saint/projects/Custodia` es el único checkout del producto (`main`).
Desde el 23/10 la v1 laboral ya no vive en este host: sigue en la rama
`maintenance/v1` (`f6a7acc`) de `origin` y en su propio entorno. Las unidades
`custodia-*-dev` se retiraron de este servidor.
Las bases de datos no se tocaron.
La historia Git sigue disponible como referencia; no es material listo para
publicar. La procedencia y distribución se revisan en `PROD-DIST-001`.
