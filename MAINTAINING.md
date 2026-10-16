# Mantener DS Hub

**Creado por Octavio Santacruz.**

Esta guía orienta a quien recibe el repositorio sin conocer su historia.
La atribución identifica al creador del proyecto; el historial Git permite
consultar las contribuciones y cambios de cada archivo.
Las instrucciones de trabajo vigentes están en [AGENTS.md](AGENTS.md).

## Qué problema resuelve

DS Hub es una CMDB operativa para CyberArk y Netskope. Combina inventario
observado con decisiones locales de operación: responsables, unidad,
clasificación y acciones pendientes. Una sincronización actualiza lo observado
sin sobrescribir esas decisiones. Cada herramienta conserva su `source_system`.
Una pantalla que presenta varias herramientas no convierte sus datos en una
única fuente ni amplía los permisos del usuario.

## Por dónde empezar a leer

Las rutas de esta tabla son relativas a la raíz del repositorio.

| Archivo | Responsabilidad | Continuar por |
| --- | --- | --- |
| `backend/app/main.py` | Construir FastAPI, middleware y composición HTTP. | `sources.py` y las rutas de la herramienta. |
| `backend/app/config.py` | Validar configuración antes de servir tráfico. | `.env.example`, sin copiar valores secretos. |
| `backend/app/lifecycle.py` | Abrir/cerrar pool, validar esquema y administrar tareas. | `db.py`, `schema.py`, `sync_coordinator.py`. |
| `backend/app/db.py` | Pool PostgreSQL y helpers de consulta. | Repositorio propietario del recurso. |
| `backend/app/auth.py` | Resolver credenciales y permisos efectivos. | `cross/api/routes/auth*.py` y servicios de autenticación. |
| `backend/app/source_contract.py` | Tipos compartidos de registro y ejecución. | `source.py` de cada herramienta. |
| `backend/app/sources.py` | Registro explícito de herramientas, routers y fuentes. | `cyberark/<herramienta>/source.py`, `netskope/sse/source.py`. |
| `backend/app/sync_coordinator.py` | Despachar trabajos durables con leases y locks por fuente. | `cross/repositories/sync_queue.py` y el sincronizador propietario. |
| `backend/app/cyberark/pam/ingestion.py` | Preview e ingesta de Safes y miembros. | `services/ingestion_source.py`, `ingestion_compare.py`, `ingestion_persistence.py`. |
| `backend/app/cyberark/pam/services/ingestion_persistence.py` | Snapshot, upserts y reconciliación PAM. | Migraciones y pruebas de ingesta PAM. |
| `backend/app/netskope/sse/netskope_sync.py` | Orquestar inventario SSE y captura mínima DLP. | `integrations/netskope.py`, `services/netskope_mapping.py`, `netskope_dlp_alerts.py`. |
| `backend/app/cyberark/shared/integrations/oauth_client.py` | Transporte OAuth compartido entre clientes CyberArk. | Cliente y configuración de cada herramienta. |
| `frontend/src/main.tsx` | Montar React, caché de consultas, errores y estilos. | `App.tsx`. |
| `frontend/src/App.tsx` | Coordinar sesión, navegación, preferencias y sync. | Hooks compartidos y router registrado. |
| `frontend/src/source-contract.ts` | Tipos de workspace, runtime, navegación y sync. | `source.ts` de cada herramienta. |
| `frontend/src/sources.ts` | Registro estático y catálogos derivados del frontend. | `cross/routers/registered-workspace-router.tsx`. |
| `frontend/src/cross/routers/registered-workspace-router.tsx` | Cargar el runtime correspondiente al workspace. | Routers CyberArk, SSE y administración. |
| `frontend/src/cyberark/shared/router.tsx` | Componer pantallas y hubs CyberArk. | Componentes y hooks de la herramienta visible. |
| `frontend/src/netskope/sse/router.tsx` | Componer inventario, métricas, experiencia y DLP SSE. | Componentes y hooks dentro de `netskope/sse/`. |
| `frontend/src/cross/routers/admin-router.tsx` | Componer usuarios, actividad y ayuda. | Componentes transversales en `cross/components/`. |
| `frontend/src/cross/lib/api.ts` | Transporte HTTP común y errores de API. | `lib/` de la herramienta para endpoints y tipos. |
| `frontend/src/cross/hooks/use-ingestion.ts` | Preview, confirmación y seguimiento de sync en la UI. | `cross/lib/ingestion-api.ts` y rutas backend de ingesta. |
| `scripts/verify.sh` | Ejecutar las comprobaciones locales del repositorio. | `npm run verify`. |
| `scripts/migrate.py` | Aplicar migraciones pendientes con tracking y lock. | `migrations/README.md`. |

## Cómo interpretar el resto de los archivos

Backend y frontend se organizan por plataforma y herramienta:
`cyberark/pam`, `identity_administration`, `sia`, `access`, `risk_management`
y `netskope/sse`. `cross/` contiene funciones transversales;
`cyberark/shared/` contiene lo compartido sólo por CyberArk.

| Carpeta o archivo | Qué buscar ahí |
| --- | --- |
| Backend `api/routes/` | HTTP, schemas de entrada/salida, autenticación y permisos. |
| Backend `services/` | Transformaciones, validaciones y coordinación de casos de uso. Hay servicios de persistencia existentes, como el de ingesta PAM. |
| Backend `repositories/` | SQL, filtros, transacciones y auditoría de mutaciones. |
| Backend `integrations/` | HTTP externo, configuración, paginación y contratos aprobados. PAM también mantiene su fachada en `client.py`. |
| Backend `source.py` | Registro de routers y, cuando corresponde, contrato de sincronización. Risk Management registra rutas sin sync. |
| Frontend `components/` | Pantallas y controles; estilos junto a su propietario. |
| Frontend `hooks/` | Estado, carga de datos y acciones de la interfaz. |
| Frontend `lib/` | Endpoints, helpers y lógica de la herramienta. |
| Frontend `types/` | Contratos TypeScript del dominio. |
| Frontend `source.ts` | Workspaces, navegación, metadata de sync y runtime. |
| `tests/` | Pruebas organizadas por propietario; fixtures comunes en `support/`. |
| `migrations/NNN_*.sql` | Evolución histórica del esquema; agregar una migración nueva para cambiarlo. |

## Seguir un cambio de punta a punta

Para modificar una pantalla, empezá por su componente y hook, seguí la llamada
a `lib/`, localizá el endpoint backend y después el servicio/repositorio.
Los filtros deben llegar hasta la consulta parametrizada. Ocultar un botón no
sustituye la autorización de la ruta. Toda escritura necesita permiso y auditoría;
la auditoría de una mutación debe participar de su transacción.

Para modificar una integración, leé primero su sección de
[integration-contracts.md](docs/architecture/integration-contracts.md).
Seguí el cliente, su mapping y el sincronizador registrado en `source.py`.
Sólo una captura completa y exitosa puede reconciliar inventario ausente como
retirado. Los payloads parciales no justifican retiros. No persistir secretos
ni ampliar allowlists basándose en campos encontrados en una respuesta.

Para entender Personas o el puente Identity→PAM, leé
`cross/repositories/identity_pam_bridge.py` y
`cross/services/person_email_matching.py`, junto con sus excepciones aprobadas
en el contrato. No extender los matches a nombres o similitud.

## Mantener los comentarios útiles

Las cabeceras de los puntos de entrada explican su propósito y dónde continúa
el flujo. Los módulos que ya tienen docstrings conservan su contexto específico.
Al crear o cambiar un módulo, documentá su responsabilidad, de quién depende y
las restricciones que expliquen una decisión difícil de deducir del código.
Actualizá el comentario cuando cambie esa responsabilidad. Evitá repetir línea
por línea lo que hace el código o guardar conteos de inventario que pueden variar.

## Comprobar y entregar un cambio

Leé [modularity.md](docs/architecture/modularity.md) y revisá `git status --short`
antes de editar. Los cambios de lógica, flujo de datos, permisos o transacciones
necesitan una prueba de regresión enfocada. Corré `npm run verify`: incluye
pruebas backend con PostgreSQL efímero, comprobaciones de scripts y arquitectura,
tests frontend, tipos y build. Para cambios de interacción, corré además el
grupo E2E propietario documentado en [README.md](README.md).

No edites migraciones históricas ni el baseline. No expongas credenciales en
comentarios, logs o ejemplos. El despliegue activo y sus requisitos están en
[deployment.md](docs/operations/deployment.md); los pendientes de producto,
en [TO_IMPLEMENT.md](docs/tracking/TO_IMPLEMENT.md).
