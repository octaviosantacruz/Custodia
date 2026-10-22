---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-19
---

# Roles y permisos: mapa de accesos y editor de capacidades

El dueño pidió reconstruir esta experiencia desde cero tras revisar la pantalla
anterior: el directorio lateral ocupaba demasiado ancho y el detalle dejaba un
panel grande con poca información. Este diseño sustituye el recorrido de roles
propuesto en la propuesta original (archivada en `docs/history/architecture/`). La gestión de
personas se resume en «Personas y chip de Okta».

## Pregunta y recorrido

Para quien administra Custodia: «¿Qué habilita cada rol y a quién se lo doy?».

La entrada es un **mapa de accesos a todo el ancho, con compartimientos por herramienta**. Cada rol aparece una sola vez, con columnas por área del catálogo y acceso directo a miembros. Cada celda
muestra las capacidades del área; al abrirla, el editor enfoca esa área. El
conteo usa el dominio de cada permiso, nunca el dominio nominal del rol: un
nivel de Plataforma puede contener permisos PAM y la tabla lo muestra en PAM.
CyberArk reúne PAM, Identity y SIA; Netskope reúne sus permisos. Custodia contiene los roles de Plataforma y los perfiles transversales. Cada compartimiento se puede plegar y tiene su propia tabla, para que agregar una herramienta no agregue columnas a todas las demás. La búsqueda encuentra nombres, propósitos, códigos y capacidades. Los roles
preparados tienen filtro propio; no se presentan como acceso efectivo.

Crear, consultar y editar reemplazan el mapa por una **pantalla dedicada**:

- Nombre, código y propósito compactos sobre el editor.
- Capacidades en una tabla: descripción del catálogo, acción y alcance.
- Filtros por área, búsqueda y «Sólo incluidos».
- Resumen lateral con las capacidades elegidas y los cambios reales.
- Barra de guardado visible y revisión antes de modificar un rol existente.
- «Miembros» abre las cuentas que tienen ese rol mediante `people?role=`, con
  su origen de asignación y paginación.

## Logos y extensión del catálogo

Los compartimientos, las filas y las áreas del editor usan los logos existentes
en `frontend/public`: blanco en oscuro y oscuro/negro en claro. El cambio de
tema cambia la variante mediante CSS; no se recolorean ni se crean assets.
Los permisos y los niveles se agrupan por herramienta, manteniendo visible
el área concreta de cada capacidad. La identidad visual está centralizada en
`access-tool-groups.ts`; un dominio nuevo del catálogo obtiene automáticamente
un compartimiento con su nombre y un icono neutro hasta que tenga marca propia.
BigID continúa siendo sólo un placeholder preparado, sin una integración nueva.

## Dos maneras explícitas de definir un rol

**Capacidades concretas** es el recorrido inicial: permisos explícitos de las
áreas elegidas. No agrega navegación, PAM ni ninguna capacidad implícita.
La tabla distingue navegación (abre el menú) de las funciones sobre datos.
DLP/UCI se identifican como datos por usuario. La descripción proviene del
catálogo; los códigos quedan en un detalle técnico.

**Niveles vinculados** conserva referencias al rol base de cada área. Se puede
omitir cualquier área, pero debe existir al menos una selección. El editor
explica que los cambios del rol base se heredan. Las composiciones existentes
con niveles preparados se conservan hasta que se quite cada referencia de
forma explícita. No se convierten silenciosamente en permisos copiados.

La duplicación conserva el tipo de rol y su conjunto exacto de permisos o
referencias. Los roles del sistema siguen siendo de sólo lectura. Los permisos
heredados y los códigos ausentes del catálogo se mantienen al guardar; se
identifican y sólo se quitan por una acción explícita.

## Asignaciones y Okta

Se conserva la decisión vigente de `ACCESS-UI-003`: **sin directorio de grupos
reales no se edita el mapeo de Okta desde la UI**. El detalle muestra «Lo otorga
en Okta» cuando el backend entrega grupos y el actor puede leer el mapeo. Es
configuración conocida, no una consulta de pertenencia actual.

Las asignaciones manuales se gestionan desde Miembros; las que vienen de Okta
se identifican y no tienen acción de revocación manual. Las cuentas de la
misma persona siguen siendo independientes. No se agregan datos de pertenencia
cargados a mano ni se cambian las reglas de refresco de sesión.

## Contrato técnico y validación

La reconstrucción vive en `frontend/src/cross/`. Sustituye la composición
lista/detalle y elimina el formulario anterior. Reutiliza los endpoints y el
catálogo existentes; no introduce tablas, migraciones ni un segundo motor de
autorización. El backend conserva techo de delegación, último administrador,
protección de roles del sistema, auditoría transaccional y permisos por ruta.
La UI evita ofrecer concesiones por encima del alcance del actor; el backend
vuelve a validarlas al guardar. Un rechazo conserva el borrador y su revisión.

Las pruebas de navegador cubren el mapa, el área abierta desde una celda,
payloads exactos al crear y duplicar, omisiones en composiciones, conservación
de niveles preparados, rechazo del servidor, lectura autorizada de grupos,
miembros, foco, descarte de borradores y accesibilidad. Se ejecutan además
`npm run verify`, verificación de estilos y revisión visual de escritorio.

## Evidencia de entrega

Validación local del 2026-10-11:

- `npm run verify`: 1601 tests de backend, 482 de frontend, build y typecheck,
  estilos, contratos y documentación correctos. PostgreSQL fue efímero.
- 44 E2E de acceso y regresiones pasaron en la corrida de ambos temas. Después
  del último ajuste de distribución de niveles, pasaron otros 11 casos de
  mapa, logos, composiciones, mapeos de sólo lectura y alineación.
- QA visual con `agent-browser`, datos simulados y viewport de escritorio:
  compartimientos CyberArk/Netskope y editor revisados en oscuro y claro;
  los logos usan las variantes locales correspondientes.
- Un rol preparado permite retirar una asignación manual existente sin
  ofrecer nuevas concesiones. Los permisos heredados de Okta permanecen
  identificados y sin acción de revocación manual.
- No hubo migraciones nuevas, cambios en datos reales, commit ni despliegue.

## Personas y chip de Okta

Diseño aprobado e implementado (2026-10-11) de la pestaña **Usuarios**; la configuración del
mapeo grupo → roles vive en el detalle de cada rol, sin tercera pestaña.

- **Fila por persona** (Usuario · Cuenta · Roles · Último acceso · Gestionar). Con más de
  una cuenta, la fila muestra sus orígenes y la ficha permite elegir cuál administrar; cada
  identidad conserva sus permisos. Búsqueda, filtros y **Crear usuario local** en una barra
  compacta sobre la tabla.
- **Ficha lateral («Gestionar»):** persona y cuenta, roles asignados con su origen
  (`role_assignments.source`: `manual` / `oidc`), qué puede hacer agrupado por herramienta y
  acciones de cuenta local. Las cuentas OIDC no reciben acciones de contraseña local.
- **Fase 1 (commit `de7d723f`, migración 095):** chips para agregar/quitar roles directos;
  el login reemplaza solo las asignaciones OIDC y conserva las manuales.
- **Fase 2 (commit `d3b2d9df`, migración 096):** el mapeo grupo → roles se edita con
  `PUT /api/access/oidc-group-roles`. Antes de la primera edición se lee `OIDC_ROLE_MAP_JSON`;
  la primera edición lo adopta en PostgreSQL y desde entonces se usa la base aunque quede vacío.
- **Chip de Okta:** usa solo `access_oidc_users.observed_groups` y `groups_observed_at`
  (grupos mapeados que Custodia vio en el login, no todo el directorio). Un grupo → **Okta ·
  nombre**; sin grupo → **Okta**; varios → resumen con despliegue y fecha de observación. No
  permite editar membresías ni cargar nombres a mano, y nunca deduce un grupo desde un rol.
  Respeta los permisos de lectura del mapeo OIDC. Una lista truncada de miembros no
  demuestra que una persona no tenga grupos.

## Fase 4: origen por rol y vistas habilitadas

La ficha de Usuarios explica cada asignación OIDC con los grupos exactos que
la otorgaron en el último login. `role_group_sources` en
`access_oidc_users` (migración 107) conserva el mapeo aplicado en ese momento,
en la misma transacción que los roles, los grupos observados y su auditoría.
No se reconstruye el pasado cruzando grupos con el mapeo vigente. Una lista
vacía identifica el rol predeterminado del login; `NULL` o una clave ausente
significa que no hay evidencia histórica suficiente. Las asignaciones
manuales siguen identificadas como Custodia, aunque un grupo también otorgue
ese rol. La fecha corresponde al último login y no confirma membresía actual.

La evidencia sólo se consulta y entrega con `access:oidc_mappings_read` o
`access:manage`, junto con el permiso para consultar el directorio. No se
habilita edición de grupos ni de mapeos en la interfaz.

El editor de roles, la ficha y la confirmación de una asignación muestran
«Vistas del menú». La previsualización usa el registro estático de workspaces
y los mismos `domainAccessible` y `hasWorkspaceAccess` del shell: conserva
el acceso estricto, las alternativas y los requisitos conjuntos. Excluye
destinos retirados del menú y dominios preparados. No navega con permisos
simulados ni modifica la sesión del administrador. Los roles preparados y
cuentas desactivadas se identifican sin anunciar acceso efectivo; si el
catálogo está incompleto la ficha muestra «Sin dato» en vez de inferir acceso.
La lista no incorpora preferencias personales y no reemplaza los permisos
específicos de cada función sobre los datos.
