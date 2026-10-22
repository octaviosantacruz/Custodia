# Custodia

Inventario de herramientas de seguridad con procedencia, cambios explicables
y decisiones humanas que una sincronización no sobrescribe.

La demo vigente está en `company-demo/`: **Faro Digital**, una empresa ficticia
con personas, áreas, equipos y accesos relacionados, sobre la interfaz React
original. [Escenario y recorrido](docs/COMPANY-DEMO.md). **Todavía no incluye
backend Go ni autenticación real**. El orden elegido es Portfolio, instalación autohospedada y,
después de validar uso, evaluar SaaS.

## Empezar

1. Leer la [revisión del producto existente](docs/EXISTING-PRODUCT.md): la UI
   original y la lógica Python son la base que se debe preservar y extender.
2. Recorrer [Faro Digital](docs/COMPANY-DEMO.md) y seguir el
   [tracker](docs/TO_IMPLEMENT.md): ampliar esa experiencia con datos
   sintéticos y portar sus contratos a Go por recorridos.

```bash
cd company-demo
npm ci
npm run build
npm run preview
# http://127.0.0.1:4182
```

Dirección aclarada por el dueño el 22/10: inventario de herramientas de
ciberseguridad, cruces e inferencias, priorizando la experiencia ya construida.
La demo reducida de `demo/` se conserva como experimento; no es el diseño
objetivo ni la referencia de paridad. Su aceptación no bloquea Go.

## Documentación

| Tema | Documento |
|---|---|
| Alcance y etapas | [Producto](docs/PRODUCT.md) |
| Empresa ficticia y recorridos de la demo vigente | [Faro Digital](docs/COMPANY-DEMO.md) |
| Go y PostgreSQL | [Arquitectura](docs/ARCHITECTURE.md) |
| Configurar y sincronizar herramientas | [Conectores](docs/CONNECTORS.md) |
| Switchboard, OIDC y QA | [Acceso](docs/ACCESS.md) |
| Interfaz y recorrido de ejemplo | [Diseño](docs/DESIGN.md) |
| Criterios para avanzar | [Validación](docs/VALIDATION.md) |
| De dónde viene lo que lleva la demo | [Procedencia](docs/PROVENANCE.md) |
| Capturas, textos ES/EN y paquete para Portfolio | [Presentación](docs/PRESENTATION.md) |
| Decisiones aceptadas y recomendaciones | [Decisiones](docs/DECISIONS.md) |
| Qué se aprovechó y qué se retiró | [Referencia de la revisión](docs/REFERENCE.md) |
| Pendientes y evidencia entregada | [Pendientes](docs/TO_IMPLEMENT.md) · [Cierres](docs/IMPLEMENTED.md) |

## Verificación disponible

```bash
npm run verify          # documentos + modelos de empresa y experimento, sin instalar
npm run verify:company  # build y Chromium de Faro Digital (instalar company-demo antes)
npm run verify:demo     # sólo experimento reducido anterior, en demo/
npm run package:demo    # sólo paquete del experimento anterior, sin publicar
```

`verify` requiere Node.js 24 o superior (ejecuta TypeScript directamente);
comprueba documentación, enlaces, separación de IDs y los modelos de la
empresa y del [experimento](fixtures/lab/scenario.json). `verify:demo` instala las dependencias
fijadas de `demo/`, compila sin `.env` y recorre los siete pasos del guion con
Playwright, incluyendo teclado, foco, ES/EN, pantalla angosta, accesibilidad
WCAG A/AA con axe, los estados de ejemplo y que no haya peticiones fuera
del origen. Playwright
necesita su Chromium (`npx playwright install chromium`) y las librerías del
sistema (`npx playwright install-deps chromium`, con sudo).

El experimento reducido permanece en `http://127.0.0.1:4180` cuando se ejecuta
desde `demo/`; no es la demo vigente ni la UI objetivo.

Revisión técnica 22/10: aviso parcial, filtro de conexiones, foco y guion
móvil corregidos; 16 pruebas de navegador, incluyendo cada estado con axe
en ambos idiomas. Las capturas son del laboratorio sintético. La aceptación
final del dueño y la distribución siguen pendientes; Go no está implementado.

## Relación con la versión anterior

La rama `product/go-reset` parte de `f6a7acc`: primero retiró el árbol heredado;
ahora recupera su frontend en `company-demo/` para conservar la experiencia.
No recupera el backend ni su configuración de despliegue. El checkout
`/home/saint/projects/Custodia` conserva la aplicación anterior y es el que
usan los servicios locales. No se modificaron sus unidades ni sus bases.
La historia Git sigue disponible como referencia; no es material listo para
publicar. La procedencia y distribución se revisan en `PROD-DIST-001`.
