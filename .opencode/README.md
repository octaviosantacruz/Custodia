# Agentes DS Hub — OpenCode V2

Orchestrator (primary) coordina worker y reviewer (subagents). No hay OMP, Bun,
SDK propio ni servicio adicional. OpenCode ya instalado: V2.0.20.

## Conectar modelos (una vez, sin sudo)

En OpenCode:

```text
/connect
```

- Elegir **GitHub Copilot** y completar su autenticación para orchestrator y reviewer.
- Repetir para **OpenCode Go**, con su clave de suscripción.
- `/models` permite seleccionar el modelo conectado. No se fijan IDs de
  modelos inventados ni se guardan credenciales en este repositorio.

Los perfiles fijan los siguientes modelos en su frontmatter:

| Agente | Modelo |
|---|---|
| orchestrator | `github-copilot/claude-sonnet-5.5` |
| worker | `commandcode-openai/gpt-6-luna` |
| reviewer | `github-copilot/claude-sonnet-5.5` |

Confirmar la disponibilidad de esos IDs en `/models` para la cuenta conectada.
La selección de primary no cambia el modelo de una sesión ya existente.
Suscripciones y límites de Copilot y OpenCode Go son independientes.

## Ejecutar una tarea autorizada

Reabrir OpenCode en la raíz (o recargar configuración); nuevas sesiones usan
orchestrator (antes planner). En una sesión existente seleccionar **orchestrator**
y comprobar su modelo manualmente.

```text
/dshub-task CHAIN-012 — alcance: mapa de columnas Netskope y sus tests; sin cambiar contratos
```

Es un ejemplo, no autorización para ejecutar ese ID automáticamente.
El orchestrator contrasta trackers/código, solicita aprobación del estado En curso,
delega contexto explícito, revisa diff, pide ejecutar `npm run verify`, delega
revisión fresca y espera aceptación humana antes del cierre documental.
Un fallo bloquea; máximo una ronda de correcciones. No push/deploy.
Orchestrator, worker y reviewer pueden hacer commits locales con autorización humana
explícita del mensaje y archivos/hunks en cada etapa y aprobación por comando.
No hay commits automáticos; un checkpoint sin gate/revisión sigue no aceptado.

## Permisos y límites reales

- Reviewer sólo tiene shell para inspección Git y el commit aprobado; no puede
  editar contenido ni correr tests. Ninguno de los dos tiene MCP, Code Mode ni subagentes.
- Worker tiene una excepción de shell con aprobación por solicitud: `git status
  --short`, `git diff *`, `npm run verify`, `npm --prefix frontend run test:unit`
  y `npm --prefix frontend run build`. Sólo para verificación delegada por el
  orchestrator, más la excepción de commit indicada abajo; otros comandos siguen
  denegados. E2E continúa siendo humano.
  Si el gate carga secretos, requiere un entorno aislado ya preparado; este
  permiso no habilita crear el aislamiento ni evita controles del host.
- Worker pide permiso para editar sólo áreas del producto/tests/contratos;
  no puede editar trackers, AGENTS, configuración de agentes o gate.
- Orchestrator también puede pedir (con aprobación por solicitud, y sólo con
  estas formas literales) `npm --prefix frontend run build|test:unit|verify:styles`,
  los E2E por grupo `test:e2e:netskope`, `test:e2e:cyberark` (incluye SIA) y
  `test:e2e:cross` (shell y Personas), y el `rsync`
  de copia aislada a `/tmp/opencode/dshub/`. `cd … &&` o argumentos extra no
  coinciden con el patrón y se deniegan.
- **Forma de los comandos de shell (los tres perfiles):** un comando por llamada,
  literal y desde la raíz del repo, sin `cd`, `&&`, `;`, `|`, redirecciones ni
  argumentos extra. El scanner divide los comandos compuestos y todas las partes
  deben tener su propia regla `allow`/`ask`; si una no coincide, se deniega la
  llamada completa (así se bloqueó un `git status` envuelto en otro comando).
  Ante una denegación se reporta la acción y el recurso exactos; no se amplían
  permisos para evitarla.
- Orchestrator sólo solicita edición de los dos trackers y shell acotado. Reviewer
  no edita contenido. Permisos por rol independientes, no heredados del padre.
- Los tres perfiles solicitan `git add -- *` y `git commit -m *`. Antes revisar
  status, diff, diff --cached, hooks y configuración. Sólo rutas literales
  individuales autorizadas, nunca ., -A, directorios/comodines ni commit -a,
  amend o bypass de hooks. Índice ajeno o cambios inseparables bloquean el commit.
  Los patrones de permisos no validan rutas, opciones ni el contenido del índice:
  la aprobación humana y este protocolo siguen siendo necesarios. Commit no
  significa push, deploy, gate aprobado ni cierre del tracker.
- Lectura de env/secretos conocidos denegada; grep pide aprobación porque
  su permiso se aplica a la expresión, no al directorio buscado. Antes de
  aprobar, revisar ruta e include; no buscar en env/secretos.
- No usar `--auto` ni “Allow always” amplio. Aprobar edición sólo de archivos
  dentro del alcance; aprobar comandos una vez después de inspeccionarlos.
- **No es un sandbox:** el gate corre con autoridad del usuario del host.
  Nunca ejecutar código no confiable en un checkout con credenciales. Usar
  VM/copia aislada, sin secretos/red productiva, si la tarea lo requiere.
  La antigua prueba bubblewrap del piloto OMP ya no forma parte del producto.
- Estados y entrega en Markdown son un protocolo del agente, no garantías
  deterministas. Steps limita pasos por interacción, no costo monetario total.
  Gate/cierre y autorización humana siguen siendo responsabilidad del operador.
- Las restricciones son de estos roles, no hardening global de agentes build
  ni políticas de organización. Cambiar a otro agente cambia la autoridad.

## Un worktree por tarea (automático)

Dos actores en el mismo árbol se pisan archivos, índice y puertos. Por eso **cada ID
trabaja en su propio worktree y rama `task/<ID>`, y lo crea el propio agente**: no
hay nada que ejecutar a mano.

```text
/dshub-task VIS-PAM-ACC-001 — alcance: ...      (orchestrator, con aprobaciones)
/dshub-goal VIS-PAM-ACC-001                     (autopilot, modo noche)
```

Qué pasa por dentro:

1. El orchestrator (o el autopilot) comprueba que el ID existe en `TO_IMPLEMENT.md` y
   corre `scripts/wt.sh new <ID>`: crea `/home/ubuntu/DSHub-wt/<ID>` desde la punta de
   la rama base (o lo reutiliza si ya existe), con enlaces a `node_modules`,
   `backend/.venv` y `.env.local`. Lo no commiteado en el árbol principal no viaja.
2. La sesión sigue abierta en el árbol principal, pero todo el trabajo va a `<W>`:
   rutas absolutas bajo `<W>` para leer/editar y `workdir=<W>` en cada comando de
   shell (el comando sigue siendo el literal de permissions). Las reglas
   `external_directory` y de edición de cada perfil habilitan `DSHub-wt/*`.
3. Cada agente verifica con `git branch --show-current` (workdir `<W>`) que la rama
   es `task/<ID>` antes de actuar y antes de cada commit; si no, se detiene, porque
   estaría operando sobre el árbol principal.
4. El E2E elige solo su puerto (4200-4899, derivado del ID) y `npm run verify` usa
   un Postgres efímero: varios IDs en paralelo no chocan.
5. Integración: el autopilot nunca integra (commits en `task/<ID>`, los revisa el
   dueño). El orchestrator, tras la aceptación humana, ofrece
   `scripts/wt.sh merge <ID>` (rebase + fast-forward en la base, sin push; pide
   aprobación) y luego `scripts/wt.sh clean <ID>`. A mano también: `scripts/wt.sh status`.

**Sin verificar con un modelo real:** que el parámetro `workdir` de shell y la ruta
absoluta bajo `external_directory` se apliquen en subagentes sólo está validado a
nivel de reglas (`/api/agent`), no con una corrida. La comprobación de rama es el
freno si no se aplicaran. Se verifica en la primera corrida real (`HARN-RUN-001`).

Los trackers se editan en cada rama; filas distintas se integran solas y un
conflicto en la misma fila se resuelve al hacer `merge`.

## Validación

```bash
opencode reload
opencode debug config
npm run harness:check
npm run harness:test
npm run verify
```

Confirmar orchestrator/worker/reviewer desde la interfaz de la ubicación del proyecto.
En V2.0.20, `debug agents` sin ubicación puede listar sólo perfiles globales;
la validación local se realizó con `/api/agent?location[directory]=...` y
`/api/command` del servidor, sin invocar modelos.

El check protege IDs individuales en tablas ID de ambos trackers; no expande
rangos históricos ni demuestra que una tarea esté implementada. Esa evidencia
se contrasta manualmente. La primera corrida con modelos reales permanece
pendiente en `HARN-RUN-001`; cargar agentes no consume una implementación.

Referencias V2: https://opencode.ai/v2/docs/agents,
https://opencode.ai/v2/docs/permissions,
https://opencode.ai/v2/docs/commands,
https://opencode.ai/v2/docs/cli/providers.

## Modo noche: `autopilot` (sin aprobaciones)

Decisión del dueño (2026-10-03): poder dejar un ID trabajando sin supervisión. Es un
**trío de perfiles aparte**; `orchestrator`, `worker` y `reviewer` siguen con
aprobación por solicitud.

| Perfil | Modelo | Qué puede hacer sin preguntar |
|---|---|---|
| `autopilot` (primary) | Copilot Sonnet 5.5 | Lee, corre el gate (`build`, `test:unit`, `verify:styles`, E2E por grupo, `npm run verify`, `harness:*`), edita sólo la fila de `TO_IMPLEMENT.md` y `.opencode/runs/`, y hace commits **locales** con `git add -- <ruta literal>` y `git commit -m` |
| `worker-auto` (subagente) | GPT-6 Luna | Edita `backend/app`, `backend/tests`, `frontend/src`, `frontend/tests` y `docs/architecture`; corre `test:unit`, `build` y `verify:styles`. Sin commits |
| `reviewer-auto` (subagente) | Copilot Sonnet 5.5 | Sólo lectura e inspección Git |

Ninguno de los tres tiene reglas `ask`: lo no listado se **deniega** (nunca queda
esperando a un humano). Las tres reglas `ask` por defecto de OpenCode
(`external_directory`, `read *.env`, `read *.env.*`) quedan anuladas por el
`* deny` del perfil, que va después (gana la última regla que coincide).

Lo que sigue prohibido: push y deploy; producción, probes e ingestas; secretos y `.env*`;
`IMPLEMENTED.md`, `AGENTS.md`, `package.json`, scripts del gate, dependencias
(`backend/requirements*`) y **migraciones** (un ID que las necesite queda `blocked`);
`git add` con `.`/`-A`, `--amend` y `--no-verify`. Un commit local **no cierra** el ID:
la fila queda como «En curso (código listo; pendiente de aceptación humana)».

Flujo por ID (de a uno, máximo 5 por corrida): contrastar tracker y código → En curso →
`worker-auto` → revisión del diff → gate completo → `reviewer-auto` → una ronda de
correcciones si hace falta → commit local por ID. Si el gate o el revisor fallan tras la
ronda, **se detiene toda la corrida sin commitear** y deja el árbol como está.
El resultado queda en `.opencode/runs/AAAA-MM-DD-HHMM.md` (ignorado por git).

**Riesgo aceptado:** el gate corre en el host con la autoridad del usuario y ejecuta
código escrito por el obrero sin que un humano lo haya visto. Las pruebas usan mocks y
no hay lectura de secretos permitida, pero **no es un sandbox**. Revisar los commits al
día siguiente, uno por uno, antes de aceptar.

Uso (en tmux, para que sobreviva a un corte de SSH):

```bash
tmux new -s noche
source ~/.profile && [ -n "$COMMANDCODE_API_KEY" ] && echo "clave presente"
cd ~/DSHub && opencode --agent autopilot
# dentro de la sesión:
/dshub-goal VIS-NSK-HIST-001 VIS-PAM-RET-001
# correcciones sobre una corrida que quedó detenida:
/dshub-fix VIS-NSK-HIST-001
```

Sin interfaz: `opencode run --agent autopilot "Ejecutá el flujo completo para: VIS-NSK-HIST-001"`.
