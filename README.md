# Custodia

Inventario de herramientas de seguridad con procedencia, cambios explicables
y decisiones humanas que una sincronización no sobrescribe.

Este checkout inicia el producto personal desde una base limpia. Contiene
documentación y su verificador; **todavía no incluye aplicación, demo ni
backend Go**. El orden elegido es Portfolio, instalación autohospedada y,
después de validar uso, evaluar SaaS.

## Empezar

1. Leer [producto](docs/PRODUCT.md) y [diseño de la demo](docs/DESIGN.md).
2. Trabajar `PROD-FIX-001` del [tracker](docs/TO_IMPLEMENT.md): un ejemplo
   reproducible con dos conexiones, cambios y revisión humana.
3. Construir la demo antes de ampliar conectores o desarrollar SaaS.

## Documentación

| Tema | Documento |
|---|---|
| Alcance y etapas | [Producto](docs/PRODUCT.md) |
| Go y PostgreSQL | [Arquitectura](docs/ARCHITECTURE.md) |
| Configurar y sincronizar herramientas | [Conectores](docs/CONNECTORS.md) |
| Switchboard, OIDC y QA | [Acceso](docs/ACCESS.md) |
| Interfaz y recorrido de ejemplo | [Diseño](docs/DESIGN.md) |
| Criterios para avanzar | [Validación](docs/VALIDATION.md) |
| Decisiones aceptadas y recomendaciones | [Decisiones](docs/DECISIONS.md) |
| Qué se aprovechó y qué se retiró | [Referencia de la revisión](docs/REFERENCE.md) |
| Pendientes y evidencia entregada | [Pendientes](docs/TO_IMPLEMENT.md) · [Cierres](docs/IMPLEMENTED.md) |

## Verificación disponible

```bash
npm run verify
```

Requiere Node.js con soporte de módulos ES; no instala paquetes. Comprueba
documentación, enlaces y separación de IDs. No ejecuta pruebas de producto:
sus gates se agregarán con la demo y Go.

## Relación con la versión anterior

La rama `product/go-reset` parte de `f6a7acc` y retira el árbol heredado en
este worktree, `/home/saint/projects/Custodia-product`. El checkout
`/home/saint/projects/Custodia` conserva la aplicación anterior y es el que
usan los servicios locales. No se modificaron sus unidades ni sus bases.
La historia Git sigue disponible como referencia; no es material listo para
publicar. La procedencia y distribución se revisan en `PROD-DIST-001`.
