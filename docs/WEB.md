---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-11-13
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

La demo cuenta la historia de Acme Corp: `web/src/demo/acme-api.ts` responde
desde `web/src/demo/model/company.json` las rutas de Personas, Safes, cuentas,
métricas de CyberArk e inventario de Netskope, y delega el resto en la API
simulada. Personas, equipos, Safes y contadores salen del mismo escenario que
cita el sitio (Alice: brecha; Bob: parcial; Eve: desconocido). Las fechas se
corren para que la captura parezca siempre reciente. Las pruebas e2e siguen
usando sólo `mock-api.ts`.

La demo entra con una sesión de lectura («Demo»). Una ruta que la API
simulada no conoce responde «No disponible en la demo».

## Idiomas

La app está en español (fuente) e inglés con `web/src/cross/i18n/`: `t('texto
en español')` busca la traducción en `en.ts` y, si falta, muestra el español.
El idioma sale de `?lang=`, luego de lo guardado; la demo publicada sigue al
navegador y la app con backend arranca en español. Cambiar de idioma recarga
la página. El sitio enlaza la demo con `?lang=` de su idioma.
`node scripts/i18n-report.mjs --missing` (en `web/`) lista lo pendiente.

## Datos

Todo nombre de la demo y las pruebas es ficticio: `acme.example`, Globex,
Initech. No se copian dominios, empresas, grupos, hosts ni remotos del
empleador de origen; ver `AGENTS.md`.

## Marca

La marca son dos registros que se cruzan (`web/public/mark.svg`, lima sobre
grafito); el favicon y el logo de la cabecera son el mismo dibujo. La app
conserva la estructura de DS Hub (rueda, círculos, accesos), pero usa la paleta
y las tipografías del sitio (`site/src/design/tokens.css`): azul tinta, lima
sólo para marca, acción, foco y selección, y los colores de veredicto para los
estados. Los tokens viven en `web/src/styles/foundation.css`; el texto sobre
lima usa `--accent-fill` y `--on-accent` en ambos temas.

## Diseño del sitio

**El sitio es la vidriera de la demo.** No muestra nada que la demo no
muestre: usa sus colores, sus logos, sus nombres de vistas y sus cuatro
etiquetas de vínculo, y sus pantallas son capturas reales de `web/`. Si un
texto o un elemento del sitio no se puede encontrar al abrir la demo, sobra.
Cuando la demo cambia, se regeneran las capturas y se revisan los textos.

El sitio se diseña con un método, no con adjetivos. «Moderno» o «limpio» no
describen nada; cada pedido de diseño nombra:

1. **El elemento**: maqueta, tipografía, movimiento, respuesta al toque.
2. **Una referencia** que sea excelente en ese elemento, y el principio que se toma.
3. **La adaptación** a los tokens, las fuentes y la CSP de Custodia.
4. **Lo que se deja afuera.** Una referencia sin esta parte no está pensada.

Una referencia aporta principios, nunca material: no se copian logos, textos,
ilustraciones ni maquetas de otro producto.

**Dos colores tranquilos y uno fuerte.** El azul tinta es el fondo (cerca del
60 % de una pantalla) y sus tonos más claros llevan paneles, filos y texto
secundario (cerca del 30 %). El fondo es un color que se nota, no un gris casi
negro: con un neutro sin color, el sitio se lee como un modo oscuro cualquiera. El lima es el único color fuerte (cerca del 10 %)
y va sólo en el detalle que se tiene que ver primero: la marca, las palabras
clave del titular, la acción siguiente, la selección y el foco. Todo lo demás
queda tranquilo para que ese detalle resalte: etiquetas de sección, viñetas,
subrayados, filos y resplandores son decoración y nunca van en lima. Si dos
cosas compiten por la primera mirada, una sobra. Los colores de estado (verde,
ámbar, rojo) aparecen sólo donde la demo los usa.

**Profundidad con luz, no con más color.** El sitio usa el azul tinta de la
demo tal cual; la profundidad sale de una luz fría y suave desde arriba de la
página, un filo fino bajo la cabecera y la captura del inicio que se funde
con el fondo. Nada de resplandores en lima, degradados entre colores ni
ilustraciones detrás del contenido. Si el fondo cambia de color, cambia en
`site/src/design/tokens.css` y en `web/src/styles/foundation.css` a la vez.

| Elemento | Referencia | Se toma | Se deja |
|---|---|---|---|
| Maqueta de la página | stripe.com | Una afirmación por sección, con la pantalla real del producto al lado. | Degradados vistosos y muchas llamadas a la acción. |
| Tipografía | pentagram.com | Pocos tamaños, títulos firmes, medida cómoda de lectura. | Familias de exhibición; el sitio usa Instrument Sans y JetBrains Mono. |
| Minimalismo | muji.com | Quitar hasta que quede lo útil; nada que la demo no tenga. | Calidez decorativa. |
| Recorrido | linear.app | El producto real en pantalla, una idea por paso. | Brillos y degradados decorativos. |
| Animación | apple.com | El movimiento acompaña la lectura: la pantalla cambia con el paso que se lee. | Secuestrar el scroll, video automático, bucles. |
| Primer contacto | duolingo.com | Un logro real y temprano: la demo abre sin registro. | Rachas, mascotas y recordatorios con culpa. |

Reglas que siguen de ahí:

- **El movimiento tiene presupuesto.** Sólo `transform` y `opacity`, sin
  bucles, y todo quieto con `prefers-reduced-motion`. La página se lee completa
  sin JavaScript: cada paso del recorrido lleva su pantalla.
- **La lectura no depende de la animación.** Los pasos inactivos conservan
  el contraste del texto. Con movimiento reducido se muestran todas las capturas
  en su paso, y los contenidos siguen visibles sin esperar un revelado.
- **El scroll es del visitante.** El recorrido deja la pantalla fija y la
  cambia según el paso que se está leyendo, pero la página se desplaza normal.
- **Capturas, no dibujos.** El sitio no recrea la interfaz con diagramas
  propios. `site/scripts/capture-shots.mjs` saca las pantallas de la demo en
  inglés y español; el recorrido las usa a 1000x740 para que su texto se lea.
- **Capturas en móvil.** La portada acerca el vínculo mediante un recorte CSS
  de la captura original; cada imagen ofrece abrir su versión completa en otra
  pestaña. El texto del paso aparece antes de su pantalla.
- **El sitio se lee, la app se opera.** El sitio sube la escala de texto
  (base de 16 px) sin tocar colores ni familias; la app conserva su densidad.

## Verificación

`npm run verify:web` desde la raíz: tipos, lint, estilos, pruebas unitarias,
build de la demo y e2e con Chromium. El sitio se construye con
`npm run build:site`.
