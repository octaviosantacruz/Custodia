# Custodia

Inventario de herramientas de seguridad con procedencia, cambios explicables
y decisiones humanas que una sincronización no sobrescribe.

Este checkout inicia el producto personal desde una base limpia. Contiene
documentación, el ejemplo del laboratorio y una demo estática en `demo/`
(datos ficticios, sin backend); **todavía no incluye backend Go ni
autenticación**. El orden elegido es Portfolio, instalación autohospedada y,
después de validar uso, evaluar SaaS.

## Empezar

1. Leer [producto](docs/PRODUCT.md) y [diseño de la demo](docs/DESIGN.md).
2. Seguir el [tracker](docs/TO_IMPLEMENT.md): terminar la demo antes de
   ampliar conectores o desarrollar SaaS.

## Documentación

| Tema | Documento |
|---|---|
| Alcance y etapas | [Producto](docs/PRODUCT.md) |
| Go y PostgreSQL | [Arquitectura](docs/ARCHITECTURE.md) |
| Configurar y sincronizar herramientas | [Conectores](docs/CONNECTORS.md) |
| Switchboard, OIDC y QA | [Acceso](docs/ACCESS.md) |
| Interfaz y recorrido de ejemplo | [Diseño](docs/DESIGN.md) |
| Criterios para avanzar | [Validación](docs/VALIDATION.md) |
| De dónde viene lo que lleva la demo | [Procedencia](docs/PROVENANCE.md) |
| Decisiones aceptadas y recomendaciones | [Decisiones](docs/DECISIONS.md) |
| Qué se aprovechó y qué se retiró | [Referencia de la revisión](docs/REFERENCE.md) |
| Pendientes y evidencia entregada | [Pendientes](docs/TO_IMPLEMENT.md) · [Cierres](docs/IMPLEMENTED.md) |

## Verificación disponible

```bash
npm run verify        # documentación + tests del modelo (node --test, sin instalar nada)
npm run verify:demo   # build de la demo + recorrido completo en Chromium (npm ci)
```

`verify` requiere Node.js 24 o superior (ejecuta TypeScript directamente);
comprueba documentación, enlaces, separación de IDs y el modelo contra el
[fixture](fixtures/lab/scenario.json). `verify:demo` instala las dependencias
fijadas de `demo/`, compila sin `.env` y recorre los siete pasos del guion con
Playwright, incluyendo teclado, foco, ES/EN, pantalla angosta, accesibilidad
WCAG A/AA con axe, los estados de ejemplo y que no haya peticiones fuera
del origen. Playwright
necesita su Chromium (`npx playwright install chromium`) y las librerías del
sistema (`npx playwright install-deps chromium`, con sudo).

Para verla: `cd demo && npm ci && npm run build && npm run preview`
(`http://127.0.0.1:4180`).

## Relación con la versión anterior

La rama `product/go-reset` parte de `f6a7acc` y retira el árbol heredado en
este worktree, `/home/saint/projects/Custodia-product`. El checkout
`/home/saint/projects/Custodia` conserva la aplicación anterior y es el que
usan los servicios locales. No se modificaron sus unidades ni sus bases.
La historia Git sigue disponible como referencia; no es material listo para
publicar. La procedencia y distribución se revisan en `PROD-DIST-001`.
