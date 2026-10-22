---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Custodia web: interfaz e identidad nuevas

Rama `product/custodia-ui`, carpeta `web/`. Empresa ficticia: **Acme Corp**
(antes Faro Digital; renombrada el 22/10 a pedido del dueño, con personas
genéricas: Alice, Bob, Carol, Dave, Eve, Frank). Pedido del dueño el 22/10: romper
con la interfaz heredada de DSHub y crear una identidad visual propia, con un
sistema de color explícito, incluido el login.

## Qué es nuevo y qué se conserva

- **Nuevo desde cero:** shell, navegación, login, pantallas, componentes,
  CSS, tipografías, marca y sistema de color. No importa código de
  `company-demo/src`. Dependencias de ejecución: React y dos tipografías.
- **Se conserva:** el modelo de Faro Digital (`web/src/model/company.ts` y
  `company.json`, copiados de `company-demo/lab/`) con la regla CONN-001 v1.
  `view.ts` agrega la lectura por fuente, el escenario de captura y los
  hallazgos cruzados.
- `company-demo/` se retiró de la rama el 22/10 a pedido del dueño; la UI
  anterior se consulta en Git (`71c68de`).

## Estructura y publicación

Un build estático con tres páginas: `/` sitio de producto en inglés (por
defecto), `/es/` en español y `/demo/` la app. Las dos páginas del sitio se
generan desde `site/template.html` y `site/strings.mjs` con
`scripts/build-site.mjs` (corre en `npm run build`/`dev`; los HTML generados
no se versionan). El sitio anima la historia de un hallazgo (recolectar →
unir → regla → conclusión), el logo y los bloques al entrar en pantalla; sin
JavaScript o con «reducir movimiento» se ve el estado final. La demo enruta en el hash
(`/demo/#/personas/3`) porque el servidor de sitios no reescribe rutas
profundas. `public/_headers` fija una CSP sin orígenes externos. Se publica
con Switchboard en `custodia.octaviosantacruz.com` mediante
`server-ops/deploy/hetzner-public/publish-site.py custodia-site`, sólo desde
fuentes commiteadas.

## Pantallas

Dos planos separados en la navegación:

- **Cruces** (lo que Custodia concluye): Resumen (cobertura, inventario con
  procedencia, hallazgos cruzados, puntos ciegos), Personas y la ficha de
  persona con su trama y el veredicto con evidencia.
- **Herramientas** (lo que cada una dice, sin veredictos): CyberArk ·
  Identidades, Roles, Safes, Cuentas, Plataformas; Netskope · Usuarios,
  Equipos, Versiones de cliente. Cada tabla muestra la corrida, busca en
  cualquier atributo, despliega los atributos crudos de la fuente y separa
  la columna «Vínculo», que es la unión propuesta por Custodia y su motivo.

Además: Entrar, Fuentes (conectadas y planificadas) y Sistema visual.

## Sistema visual

Fuentes conectadas: **CyberArk** y **Netskope**. Identity Administration es
el módulo de identidad de CyberArk, no una fuente aparte (corrección del
dueño, 22/10). El resto de herramientas del plan queda sin adaptador.

El color tiene tres trabajos y cada familia hace sólo el suyo:

| Familia | Uso | Valores |
|---|---|---|
| Marca (lima) | logo, acción principal, foco, selección | `--brand` |
| Procedencia | qué fuente lo dice, con sello de dos letras | `--src-pam` (CyberArk: módulos Identity y PAM), `--src-sse` (Netskope) y reservados `--src-edr`, `--src-vuln`, `--src-firewall` |
| Veredicto | qué concluye una regla, con forma propia | `--v-covered` (círculo), `--v-partial` (medio), `--v-gap` (rombo), `--v-unknown` (anillo punteado) |

Todo lo demás es la escala neutra `--ink-*`. El trazo comunica la unión:
continuo = correo exacto, discontinuo = ambiguo, punteado = ausencia. Lo
observado («sin señal») se escribe en tinta; sólo una regla pinta un
veredicto. Los logos de CyberArk, Netskope y BigID (blancos, recuperados de
`71c68de`) vuelven a pedido del dueño: sólo junto al nombre de la
herramienta, nunca como portadores de color; el sitio declara que son marcas
de sus dueños. Tipografías: Instrument Sans (interfaz) y
JetBrains Mono (datos), ambas OFL-1.1. Los tokens viven en
`web/src/design/tokens.css` y la página «Sistema visual» los documenta.

El login ofrece «Entrar a la demo» y un acceso con passkey/SSO
deshabilitado: Switchboard u OIDC genérico están diseñados, no implementados.

## Verificación

`npm run verify:web`: typecheck, build, 5 pruebas del modelo y 9 e2e en
Chromium (sitio estático y bilingüe sin JavaScript ni pedidos externos,
acceso, hallazgos, brecha frente a identidad ambigua, capturas desactualizada
y parcial, tablas por herramienta con atributos y vínculo, filtros, axe WCAG
A/AA en el sitio y quince pantallas de la demo, 390 px sin desplazamiento
lateral). Puertos locales efímeros: 4184 (dev/preview) y
4185 (e2e), igual que las demos anteriores, sin entrada en `ports.json`.
