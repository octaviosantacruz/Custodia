---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-08
---

# Modularidad de la aplicación

## Organización por plataforma y herramienta

La unidad de organización es la herramienta. Backend y frontend comparten la
misma jerarquía de propiedad:

```text
backend/app/                         frontend/src/
  cyberark/                           cyberark/
    pam/                                pam/
    identity_administration/            identity_administration/
    sia/                                sia/
    access/                             access/
    risk_management/                    risk_management/
    connector_manager/                  connector_manager/
    shared/                             shared/
  netskope/                           netskope/
    sse/                                sse/
  cross/                              cross/
```

Safes, cuentas, roles, plataformas y PSM son funciones de PAM. Usuarios,
equipos, postura de endpoints, DEM, agregados de alertas y DLP son funciones
de Netskope. No se crean herramientas nuevas para cada feature. No hay
otros proveedores en alcance ni fuentes habilitadas por el simple hecho de
existir una carpeta.

Connector Manager posee sus catálogos read-only de pools y redes en
`cyberark/connector_manager/`. Registra sólo rutas en vivo; no añade una fuente
de ingesta. `cyberark/shared/components/connectors-workspace.tsx` compone su
tabla con los inventarios PSM/SIA existentes, sin imports entre propietarios
ni relaciones inferidas entre datos.

## Capas dentro de una herramienta

En backend cada herramienta agrupa `api/routes/`, `integrations/`,
`repositories/` y `services/`, además de su sincronizador:

- Las rutas (`api/routes/`, el Controller) coordinan autenticación, validación
  de entrada y respuestas. No contienen SQL ni mapeo de payloads externos.
- Las rutas no importan `repositories/`: llaman a `services/` (`ARCH-LAYERS-002`,
  verificado por `tests/cross/test_route_layer_repositories.py`, sin excepciones).
  Los servicios con lógica (`safe_classification`, `catalog_admin`,
  `findings_management`, `user_management`, `access_management`) traducen los
  errores de persistencia con significado de dominio (FK de catálogo, clave
  duplicada, rol inexistente) y la ruta sólo los mapea a HTTP. Las lecturas
  llegan a los repositorios por fachadas de consulta por herramienta
  (`*_read_models.py`, `audit_trail.py`, `inventory_views.py`, etc.); la lógica
  nueva se agrega ahí, nunca en la ruta.
  Auth: tokens personales (`api_token_management.py`), verificación de
  credenciales locales (`local_authentication.py`), primer administrador
  (`initial_admin.py`) y resolución del usuario de `/api/auth/status`
  (`session_view.py`) tienen servicio propio. La ruta conserva lo HTTP: flags,
  token de bootstrap, límite de tasa, eventos de seguridad y la sesión. El
  recorrido real contra PostgreSQL está en
  `tests/cross/test_auth_bootstrap_postgres_integration.py`.
- Los servicios transforman y validan datos. No ejecutan SQL: ni `execute`, ni
  `fetch_all`/`fetch_one`, ni sentencias embebidas. Lo verifica
  `tests/cross/test_service_layer_sql.py` (`ARCH-LAYERS-001`); la única excepción
  es la sonda `SELECT 1` de `database_credentials.py`.
- Los repositorios consultan PostgreSQL y preservan la transacción de cada
  mutación con su auditoría. Un servicio puede abrir la conexión y decidir el
  orden de los pasos, pero cada sentencia vive en un repositorio.
- Las integraciones encapsulan HTTP externo y contratos aprobados.

PAM mantiene su cliente en `cyberark/pam/client.py`, sus esquemas de escritura
HTTP en `cyberark/pam/schemas.py` y sus módulos de ingesta dentro de la misma
herramienta. No se importa un barrel global de repositorios: cada consumidor
importa el módulo propietario.

En frontend cada herramienta agrupa sus `components/`, `hooks/`, `lib/` y
`types/`. Sus estilos viven junto al componente propietario. Las API de una
herramienta usan el transporte común `cross/lib/api.ts`.

## Código compartido y composición

`cross/` contiene funciones transversales: sesión/OIDC y administración de
acceso, usuarios locales, auditoría, actividad, logs y errores operativos,
búsqueda global, cola durable, persistencia CMDB normalizada, cobertura,
preferencias de workspaces y plantillas de tableros, Personas y puentes de
identidad sancionados.

El backend `cross/` depende de contratos neutrales y del registro de fuentes,
sin importar módulos concretos de herramientas salvo los tres puentes
sancionados: `identity_pam_bridge.py`, `person_chain_queries.py` y
`person_client_coverage.py`. El frontend conserva la composición compartida.
`cross/` no es una herramienta ni una fuente de inventario. En particular:

- `cross/repositories/identity_pam_bridge.py` conserva el puente read-only
  Identity↔PAM; `sia_person_links.py` resuelve vínculos de personas a SIA.
- `cross/services/person_email_matching.py` conserva la única implementación
  del match de correo exacto, único y autorizado.
- Los modelos y endpoints de Netskope viven en
  `netskope/sse/api/routes/`, incluidos `cmdb_netskope*` y experiencia.
- Los controles, gráficos y primitivas de edición de tableros compartidos
  viven en `frontend/src/cross/components/`. Configuración y presentación
  exclusiva de widgets PAM viven en `cyberark/pam/components/`; el tablero
  Netskope permanece dentro de `netskope/sse/`.
- Los helpers de navegación entre herramientas que no dependen de ninguna y los
  tipos de Cadenas generados pertenecen a `frontend/src/cross/lib/`. La
  navegación de widgets a filtros de Safes (`widget-navigation.ts`) es específica
  de PAM y vive en `frontend/src/cyberark/pam/lib/`.

`cyberark/shared/` contiene lo compartido únicamente entre herramientas de
CyberArk. El backend aloja allí el transporte OAuth; el frontend aloja el
router de composición, el contexto de refresh existente y los hubs de
Identidades y SIA. El hub Identidades presenta dos vistas de Identity Administration:
Usuarios y Roles y grupos. `/pam/roles` conserva el catálogo y la búsqueda PAM
con sus propias APIs; `/pam/identity/groups` redirige a Roles y grupos de
Identity sin mezclar inventarios. El hub SIA combina políticas/recursos SIA, assets Access y
cobertura importada en una sola fila de pestañas. Cada tab mantiene sus permisos
y APIs originales. `/pam/identity` es un alias de Usuarios, con reemplazo de
historia; los parámetros legacy de roles/grupos mantienen su destino.

`App.tsx` monta `RegisteredWorkspaceRouter`, que carga de forma diferida los
routers de `cyberark/shared/router.tsx`, `netskope/sse/router.tsx` y
`cross/routers/admin-router.tsx` según el runtime declarado en el `source.ts`
de cada herramienta. El `toolLabel` propietario del `source.ts` determina el
rótulo del breadcrumb y selector; la agrupación de dominios no cambia el origen
del inventario. Ayuda pertenece al dominio neutral `cross`, con runtime
administrativo y acceso abierto. `src/sources.ts` es el registro único; el catálogo de
workspaces y sus mapas se derivan de él. Rutas públicas, alias, navegación y preferencias guardadas
se conservan durante la reorganización.

Los endpoints de Cadenas PAM y los modelos de mutaciones de Safes viven en
`cyberark/pam/api/routes/`. Los gráficos avanzados, motores, presets PAM, tipos
de auditoría de Safes y acciones de overflow del frontend también pertenecen
a PAM. El diálogo técnico usado solamente por SSE pertenece a Netskope. Los modelos de respuesta de widgets se separan en los
`api/routes/preferences_models.py` de PAM y SSE; el contrato de plantillas por
rol y preferencias de workspace permanece compartido. El
contrato genérico de presets se conserva en `cross/lib/chain-preset-types.ts`.

### Qué pertenece a `cross/`

Una pieza es de `cross/` sólo si cae en una de estas categorías; el resto va a su herramienta:

- Identidad, autorización y administración local de Custodia (usuarios, roles, OIDC, tokens, rate limiting).
- Auditoría, actividad, estado de integraciones y errores/logs operativos.
- Cola de sincronización, persistencia CMDB genérica, cobertura y corridas (`sync_queue`, `cmdb_sync`, `repositories/cmdb_persistence`, `ingestion*`).
- Shell, navegación, preferencias de workspace, búsqueda, transporte HTTP, controles y gráficos compartidos por varias herramientas.
- Personas y Cadenas compartidas, y los tres puentes sancionados (`identity_pam_bridge.py`, `person_chain_queries.py`, `person_client_coverage.py`); `sia_person_links.py` resuelve destinatarios SIA contra Identity y PAM por correo exacto.

Lo que sólo usa una herramienta se mueve a ella: las Cadenas PAM y los modelos de inventario PAM viven en `cyberark/pam/api/routes/`; los gráficos avanzados, motores, tipos de auditoría de Safes y acciones de overflow en `cyberark/pam/`; el diálogo de errores técnicos en `netskope/sse/`. Los hubs Identidades/SIA y el router CyberArk permanecen en `cyberark/shared/` porque componen varias herramientas.

### Contratos neutrales y límites frontend

`IngestionStart` (`cross/api/routes/ingestion_models.py`) y `ConnectionImport` (`connection_inventory_models.py`) son contratos neutrales de la cola y de la importación local; PAM los reexporta sin duplicarlos. En frontend, los contratos estructurales de dashboards, analytics, conexiones y el puente Identity→PAM/persona viven en `cross/types/` (PAM reexporta los nombres públicos); el panel de catálogos y el badge de asiento compartidos por varias herramientas CyberArk, en `cyberark/shared/components/`. La carga diferida de widgets concretos se compone en `sources.ts`.

`frontend/tests/cross/module-boundaries.unit.test.ts` hace cumplir los imports: `cross/` sólo consume contratos y el registro raíz; CyberArk y Netskope no se importan entre sí; entre herramientas CyberArk sólo están autorizados PAM→SIA (conectores y referencias de políticas), PAM→Identity (administración de catálogos) y PAM→Risk Management (Postura). Los hooks compartidos reciben `refreshKey` de su compositor en lugar de leer `PamRefreshContext` desde `cross/`; el hook de analítica ejecutiva pertenece a `cross/`.

## Núcleo y registro de fuentes

`main.py` compone FastAPI y routers. `lifecycle.py` administra pool y tareas;
`sync_coordinator.py` despacha la cola de `cross/repositories/sync_queue.py`.
`sources.py` permanece como registro explícito de contratos, jobs,
sincronizadores y configuración. `config.py`, `db.py`, `auth.py` y los módulos
de seguridad/startup permanecen en la raíz.

Cada herramienta declara su contrato y `register()` en `source.py`. El contrato
compartido `source_contract.py` no importa herramientas. `sources.py` invoca
los registros estáticos y sigue siendo el único registro: Risk Management y
Connector Manager exponen solamente sus rutas, sin crear una fuente de sincronización no aprobada.

`main.py` compone los routers transversales con los registrados; las fachadas
CMDB e ingesta iteran sus respectivos routers. Las rutas manuales de cada
fuente viven dentro de la herramienta. El coordinador conserva locks, leases,
progreso y errores; PAM aporta su adaptador de despacho, que preserva la
finalización propia de Safes y la corrida PSM separada. El scheduler ya iteraba
el registro y no necesita un cambio de comportamiento en `lifecycle.py`.

Para agregar una herramienta backend: **crear la carpeta y registrar en un
solo lugar (`sources.py`)**. Dentro de la carpeta se implementan las capas y `source.py`, cuyo
`register()` devuelve `ToolRegistration` con sus routers y, solo con contrato
aprobado, `SourceSpec` (identidad de fuente/plataforma, configuración, jobs,
sincronizador y variables de estado). En `sources.py` se importa e invoca ese
registro y se agrega una línea de invocación en `TOOLS`. No se modifica
`main.py`, `lifecycle.py` ni `sync_coordinator.py`. Los consumidores, incluyendo estado de integración y sincronización
completa, lo iteran. No se agregan loaders dinámicos. Los rangos de routers
son metadatos de composición para conservar el orden público, no permisos ni
identidad de inventario. Las rutas nuevas requieren su cobertura de contrato.

Los tests backend siguen la propiedad del módulo principal probado:
`tests/cyberark/<herramienta>/`, `tests/netskope/` y `tests/cross/`. Los tests
de varias herramientas, puentes o seguridad/auth pertenecen a `cross/`. Los
helpers compartidos viven en `tests/support/`; todos los directorios son
paquetes importables y el discovery de unittest recorre la jerarquía.
Un test individual se ejecuta con `python -m unittest
tests.cyberark.pam.test_cyberark` desde `backend/`.

Los tests frontend siguen la misma propiedad: `frontend/tests/{cyberark/{pam,identity_administration,sia,risk_management,connector_manager},netskope/sse,cross}/` para los unitarios (`*.unit.test.ts`) y `tests/e2e/` con esa jerarquía y las fixtures comunes en `tests/e2e/support/fixtures.ts`. SSE, DLP y DEM no se separan en herramientas distintas; los puentes Identity–PAM y Personas quedan en `cross/`.

```bash
npm --prefix frontend run test:unit -- --test-name-pattern="sync"   # opciones del runner de Node
cd frontend && npx playwright test tests/e2e/cyberark/sia/sia.spec.ts
npm --prefix frontend run test:e2e:{cyberark,netskope,cross}          # cada spec pertenece a un solo grupo
```

## Límites que se preservan

- Entre herramientas CyberArk sólo se conservan PAM→SIA en
  `pam_chain_expand.py` e Identity Administration→PAM en los modelos de cadena.
  Los contratos de entrada de cola (`IngestionStart`) y metadatos de
  importación local (`ConnectionImport`) pertenecen a los modelos HTTP de
  `cross/`; PAM los reexporta para mantener compatibilidad.

- Una plataforma no importa el código de inventario de la otra. La
  composición entre plataformas se realiza desde `cross/`.
- Cada herramienta conserva su `source_system`; ninguna sincronización
  reconcilia objetos de otra fuente. Los puentes read-only sancionados no
  alimentan cobertura ni KPIs. Sus reglas están en
  `integration-contracts.md` y los tests de aislamiento existentes.
- No se inventan endpoints, scopes, payloads ni relaciones. Una configuración
  incompleta falla claramente y no habilita cobertura ficticia.
- No se cambia la autenticación ni se divide el `auth.py` del núcleo sin la
  cobertura de integración exigida por `AGENTS.md`.
- No se crea un repositorio genérico: Safes, cuentas y catálogos mantienen
  sus filtros y contratos particulares.
- Migraciones históricas y baseline permanecen inmutables. Esta
  reorganización no cambia SQL, datos, reconciliación ni auditoría.

## Verificación de la organización

`backend/tests/cross/test_tool_module_boundaries.py` controla imports directos entre
plataformas en backend/frontend e impide reintroducir código en las carpetas
globales de capas. Las pruebas de comportamiento existentes siguen validando
HTTP, permisos, sync y persistencia con los imports de sus propietarios nuevos.

`npm run verify` verifica Python, ruff, tests con PostgreSQL efímero,
probes, propiedad de estilos, tipos de Cadenas generados, tests frontend,
build y diff. Los grupos E2E siguen siendo CyberArk, Netskope y cross; la
reubicación del código no cambia las URLs ni la selección de specs.
