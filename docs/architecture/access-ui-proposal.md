---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-11
---

# Propuesta de experiencia para usuarios, roles y permisos

El recorrido de **Roles y permisos** de este documento fue sustituido, a pedido
del dueño, por [Mapa de accesos y editor de capacidades](role-access-design.md).
La reconstrucción elimina el directorio lateral y el formulario anterior; las
secciones de personas y contratos de autorización siguen como antecedente.

**Estado:** aprobado por el dueño e implementado (2026-10-11), con la revisión de Okta en sólo lectura y textos del catálogo corregidos (migración 097).
El documento conserva el diseño aprobado y sus motivos. La implementación
reutiliza las fases 1 y 2 y agrega una proyección autorizada de grupos/fecha
sobre personas, sin persistencia nueva. La composición acepta dominios
opcionales: la vista SQL existente ya hereda sólo referencias explícitas,
por lo que no se requiere migración.

El estado general del trabajo sigue en
[`ACCESS-UI-001`](../tracking/TO_IMPLEMENT.md#administración-de-acceso-local-y-okta).

## Objetivo

Administrar el acceso a DS Hub desde la app con dos recorridos claros:
darle acceso a una persona y definir un perfil reutilizable para un equipo.
La pantalla debe responder quién tiene acceso, qué puede hacer y de dónde
proviene ese acceso.

La propuesta prioriza un refactor de la experiencia dentro de `cross/`.
Reutiliza usuarios, roles directos, roles compuestos y niveles por dominio
existentes. Los permisos efectivos y la autorización siguen bajo control del
backend.

## Punto de partida: fases 1 y 2 entregadas

Esta propuesta parte de dos entregas de `ACCESS-UI-001` que se reutilizan:

| Entrega | Evidencia | Funcionalidad existente |
|---|---|---|
| Fase 1 | Commit `de7d723f`, migración 095 | Cada asignación incluye `role_code` y `source` (`manual` / `oidc`). La ficha tiene chips para agregar y quitar roles directos, también en cuentas Okta. El login reemplaza sólo asignaciones OIDC y conserva las manuales. |
| Fase 2 | Commit `d3b2d9df`, migración 096 | La UI edita el mapeo grupo → varios roles mediante `PUT /api/access/oidc-group-roles`. El login, el catálogo y el diagnóstico consumen ese mapeo. |

La fase 2 conserva una transición explícita: antes de la primera edición lee
`OIDC_ROLE_MAP_JSON`; la primera edición lo adopta en PostgreSQL. Desde que
existe la fila de `access_oidc_mapping_state`, usa la base incluso si el mapeo
queda vacío. No se vuelve al entorno por vaciar la tabla.

No hay que reconstruir estas funcionalidades. El rediseño reorganiza su
presentación y mantiene sus endpoints, validaciones y auditoría. La lista de
personas ya admite `GET /api/auth/people?role=...`; las asignaciones por rol
se consultan reutilizando ese filtro.

## Orientación de producto

Las capturas revisadas muestran formularios de alta y grupos de Okta antes
de la lista de usuarios, filas altas y un editor de roles centrado en códigos,
recursos, acciones y cantidades de permisos. Eso demora encontrar a alguien
y entender su alcance.

La orientación expresada por el dueño es simplificar Okta: presentarlo como
un smartchip del usuario, con los grupos observados en el login y su fecha.
Si no hay grupos informados, se muestra únicamente «Okta». No se incorpora
una referencia de grupo cargada a mano. El foco del rediseño es la
representación de roles y permisos de DS Hub.
El dueño aprobó implementar este diseño tras incorporar las correcciones
sobre las fases existentes, el editor de mapeos y los dominios opcionales.

## Organización de la pantalla

Se mantienen dos pestañas: **Usuarios** y **Roles y permisos**.

| Vista | Pregunta principal | Entidad principal |
|---|---|---|
| Usuarios | ¿Qué acceso tiene esta persona y cómo lo gestiono? | Persona, con cuentas independientes en su ficha |
| Roles y permisos | ¿Qué habilita este perfil y a quién se asigna? | Rol |

El origen Okta se presenta en el contexto del usuario. La configuración del
mapeo se mueve a **Roles y permisos**, dentro del detalle de cada rol. No se
propone una tercera pestaña de grupos ni un bloque antes del directorio.

### Usuarios

La búsqueda, los filtros y **Crear usuario local** quedan en una barra
compacta sobre la tabla. El formulario de alta se abre al usar el botón.

| Usuario | Cuenta | Roles | Último acceso | Acción |
|---|---|---|---|---|
| Nombre y correo | Okta · grupo observado | Etiquetas de roles | Fecha o Sin dato | Gestionar |
| Nombre y correo | Local | Etiquetas de roles | Fecha o Sin dato | Gestionar |

El esquema es ilustrativo; no representa personas, asignaciones ni conteos
reales. Hay una fila por persona. Si tiene más de una cuenta, la fila muestra
sus orígenes y la ficha permite elegir cuál administrar. La agrupación visual
por correo conserva la independencia de cada identidad y sus permisos.

**Gestionar** abre una ficha lateral con este orden:

1. Persona y cuenta seleccionada: nombre, correo y origen.
2. Roles asignados, con su origen directo o recibido mediante OIDC.
3. Qué puede hacer la cuenta, agrupado por herramienta y con texto legible.
4. Acciones de cuenta local disponibles para el administrador.

Se reutilizan los chips y las acciones existentes de la fase 1 para agregar
o quitar roles directos en la ficha, junto con `role_assignments.source` para
explicar el origen. Las acciones sobre cuentas locales conservan sus controles
actuales. Las identidades OIDC no
reciben acciones de contraseña local o administración remota de Okta.

### Smartchip de Okta

El chip utiliza únicamente los grupos que DS Hub ya guarda al iniciar sesión
en `access_oidc_users.observed_groups`, junto con `groups_observed_at`. El
contrato actual observa grupos mapeados; no representa todo el directorio Okta.

- Con un grupo observado: **Okta · nombre del grupo**.
- Sin grupo informado: **Okta**.
- Con varios grupos: resumen compacto y despliegue con los nombres completos.

El despliegue muestra la fecha de observación. No permite editar membresías
ni cargar nombres manualmente, y no presenta la observación como pertenencia
en vivo. Nunca se deduce un grupo a partir de un rol.

Se reutilizan los datos persistidos. El contrato de personas devuelve el origen de las asignaciones y ahora
proyecta los grupos y su fecha por identidad con lectura autorizada, sin
nueva persistencia. La respuesta de grupos observados
limita los miembros mostrados por grupo; no debe invertirse una lista truncada
para concluir que una persona no tiene grupos.

El chip y su detalle respetan los permisos de lectura del mapeo OIDC.
La simplificación visual no elimina las asignaciones existentes ni cambia
cuándo se aplican los roles recibidos mediante OIDC.

### Roles y permisos

Se conserva un directorio de roles a la izquierda y el detalle a la derecha.
El directorio permite buscar y filtrar roles del sistema, personalizados y
preparados. Los preparados se consultan de forma explícita y quedan fuera
de la selección habitual de roles utilizables.

El detalle empieza por el propósito y el alcance del rol:

| Bloque | Contenido |
|---|---|
| Identidad | Nombre, propósito y condición de sistema o personalizado |
| Alcance | Herramientas y capacidades que habilita |
| Asignaciones | Identidades que lo tienen, consultables con autorización |
| Okta | «Lo otorga en Okta» con los grupos mapeados, en sólo lectura y sólo si existen |
| Detalle técnico | Códigos de permisos, composición y referencias |

La vista inicial usa `AccessPermission.description`, que ya existe en el
catálogo, para mostrar las capacidades de los códigos efectivos del rol.
El rediseño no requiere inventar descripciones ni un catálogo paralelo.
La descripción se presenta junto con las condiciones reales de autorización
cuando una ruta exija una combinación o alternativa de permisos. La lista es
plana: el código queda en el detalle técnico (y como `title` de cada fila), los
permisos `domain:*` no se repiten porque sólo abren el menú del área que ya
encabeza el grupo, y el buscador aparece sólo con más de 12 capacidades. Las
alertas DLP y el UCI llevan la etiqueta «Datos por usuario». La lista de roles
usa una línea por rol: nombre y «N asignaciones» o «Sin asignar»; el propósito
queda en el detalle. La migración 097 corrigió textos vagos del catálogo
(«Netskope» como nombre del área y descripciones concretas de `netskope:read` y
`netskope:admin`) y marca como heredados los códigos que ninguna ruta exige.

El resumen distingue facultades como consultar, operar, administrar y exportar
sin convertirlas en niveles universales. Un rol de administrador de un área
no implica acceso completo a todas las herramientas. Los permisos estrictos
de Netskope, por ejemplo, deben mostrarse sólo cuando realmente se conceden.

Los roles del sistema se consultan y ofrecen **Duplicar como personalizado**,
en línea con el alcance ya registrado en `ACCESS-UI-001`. La duplicación
preserva la semántica del rol original; no transforma silenciosamente un rol
directo en una composición distinta.

### Okta en el rol: sólo lectura (revisión del dueño, 2026-10-11)

La primera implementación movió el editor del mapeo al detalle de cada rol.
Revisada en pantalla, el dueño decidió sacarlo: sin SCIM ni API de Okta, DS Hub
no conoce los grupos reales, el nombre se tipea a mano y un error no otorga
nada sin avisar; además, el mapeo se configura una vez y repetir un editor en
cada rol agrega ruido. Lo cotidiano —dar o quitar un rol a una persona— ya se
resuelve con los chips de la ficha.

El detalle del rol muestra «Lo otorga en Okta» con los grupos mapeados, sólo
cuando existen y sólo con lectura del mapeo. No hay controles de edición.
`PUT /api/access/oidc-group-roles` y su tabla siguen disponibles por API, con
techo y auditoría; mientras nadie las use, el login lee `OIDC_ROLE_MAP_JSON`.
La edición vuelve a la UI con `ACCESS-UI-003`, eligiendo grupos reales cuando
exista SCIM o la API de Okta.

Las asignaciones por rol usan el filtro existente de personas. Una persona
puede incluir varias identidades: sólo se señalan como asignadas las cuentas
que tienen ese rol. El total de personas filtradas no se presenta como el
conteo de identidades del catálogo.

## Crear y editar un rol personalizado

El recorrido principal es **nombre y propósito → alcance por área → revisión**.
Se reutilizan los niveles del catálogo, con un cambio de backend explícito
para permitir omitir dominios de la composición.

Ejemplo conceptual, sin asignaciones reales:

| Área | Nivel elegido | Consulta |
|---|---|---|
| Plataforma DS Hub | Sin participación en la composición | Ver capacidades |
| CyberArk PAM | Operador | Ver capacidades |
| Identity Administration | Lector | Ver capacidades |
| SIA | Lector | Ver capacidades |
| Netskope | Lector | Ver capacidades |

Los selectores ofrecen únicamente los niveles disponibles para cada dominio;
SIA e Identity, por ejemplo, no reciben niveles de operación inventados.
La composición referencia niveles base y hereda sus cambios, como hoy.

### Dependencia de backend: composición con dominios opcionales

Antes de este refactor, `_validate_level_selections()` en
`backend/app/cross/repositories/access_control.py` exigía un nivel para **cada**
dominio, incluido `dspm` (BigID, planificado). `custom-role-form.tsx` seleccionaba
por defecto el primer nivel de todos los dominios. El nivel Lector de Plataforma
ya concede `inventory:read` de PAM; por eso la composición anterior no permitía
crear un perfil «sólo Netskope» sin incluir también lectura PAM. La selección
obligatoria de un dominio planificado también determinaba el estado del compuesto.

La implementación cambia validación e inicialización, y verifica la herencia
efectiva con PostgreSQL. La vista SQL existente no necesitó cambios.
Se implementó la siguiente semántica:

1. Representar «Sin participación» omitiendo el dominio de `level_refs`, sin
   crear un nivel ficticio ni reemplazarlo por Lector.
2. Cambiar la validación para aceptar un subconjunto de dominios conocidos,
   manteniendo al menos una selección, unicidad por dominio y niveles válidos.
3. Resolver herencia, estado y techo de delegación sólo desde las selecciones
   explícitas. La vista `access_effective_role_permissions` ya une las filas
   referenciadas; el recorrido completo debe garantizar que ningún valor
   predeterminado reintroduzca permisos de áreas omitidas.
4. Adaptar inicialización, edición, detección de combinaciones duplicadas y
   vista previa del frontend a esa misma semántica. Los dominios planificados
   no se agregan por defecto a perfiles utilizables.
5. Conservar íntegramente las composiciones ya guardadas. Omitir un dominio
   al editar es un cambio explícito y auditado, sin retirar selecciones existentes
   automáticamente ni modificar los roles base.

Una prueba de integración debe crear un compuesto con sólo el nivel Netskope
elegido, sin Plataforma, PAM ni BigID, y verificar su estado activo y sus
permisos efectivos: sin `inventory:read`, `domain:pam` ni otros permisos PAM.
También debe cubrir agregar y retirar selecciones, herencia de cambios del
nivel base, techo de delegación, auditoría e invariantes de administrador.

Omitir un área significa que esa selección no aporta permisos. Otros roles
de la cuenta o niveles base seleccionados pueden conceder capacidades de
esa herramienta; el resumen final debe reflejar esas concesiones reales.

La selección individual de permisos queda disponible en edición avanzada.
Las asignaciones existentes de roles directos siguen siendo representables.
**Nuevo permiso** sale del recorrido habitual y conserva su restricción
administrativa: crear un código de catálogo no incorpora por sí solo una
función o una comprobación de autorización a la aplicación.

## Revisar el efecto de un cambio

Antes de guardar, la interfaz presenta las capacidades agregadas y quitadas.
Al editar un rol compartido, explica que cambia el alcance de sus asignaciones;
la lista de identidades se consulta sólo con el permiso correspondiente.

Al retirar un rol de una cuenta, el resultado considera sus demás roles.
Si una capacidad sigue concedida por otro rol, se indica que permanece.
La vista previa explica el efecto esperado; el backend vuelve a validar el
estado y los permisos al guardar.

Las asignaciones manuales y las derivadas de OIDC conservan su semántica.
Los cambios de mapeo OIDC se aplican en el próximo login según el contrato
actual. No se promete revocación inmediata por una edición visual.

## Alcance del refactor y dependencias

| Trabajo | Base existente o ampliación necesaria |
|---|---|
| Tabla compacta y alta bajo demanda | Reorganización de `user-admin.tsx` y sus estilos |
| Ficha de acceso por identidad | Evolución del drawer existente y las asignaciones con origen |
| Roles por propósito y capacidades | Evolución de `role-admin.tsx`, usando catálogo y permisos reales |
| Origen y edición de roles por cuenta | Reutilizar `role_assignments.source`, chips y acciones entregados en `de7d723f` |
| Okta en el detalle del rol | Sólo lectura de `AccessRole.oidc_groups`; la edición queda por API hasta `ACCESS-UI-003` |
| Composición con dominios opcionales | Cambio explícito de validación e herencia backend; adaptar el formulario y su resolución, con regresiones |
| Smartchip con grupos observados | Usar grupos y fecha ya persistidos; proyectarlos por identidad con autorización si hace falta |
| Asignaciones por rol | Reutilizar `GET /api/auth/people?role=...`, con paginación y distinción entre persona e identidad |
| Vista previa de capacidades | Resolver desde roles y permisos existentes; el backend revalida cada escritura |

Los componentes frontend citados pertenecen a `frontend/src/cross/components/`.
Las ampliaciones backend conservan rutas → servicios → repositorios y la
auditoría transaccional. El refactor mantiene el catálogo, los roles y las
asignaciones existentes. No se agrega persistencia de referencias manuales.
La composición opcional es trabajo backend obligatorio para ese recorrido;
si su implementación necesita modificar vistas o estructura SQL, se agrega
una migración numerada nueva. Las migraciones 095 y 096 no se reescriben.

## Secuencia implementada

1. Reorganizar Usuarios reutilizando la fase 1 y los grupos observados para el chip.
2. Mostrar el mapeo de Okta en el rol en sólo lectura (el editor se retiró tras la revisión del dueño).
3. Rehacer el alcance con descripciones del catálogo y asignaciones por filtro.
4. Implementar y verificar dominios opcionales en backend antes de habilitar
   «Sin participación» en el editor; luego adaptar el formulario y la vista previa.

Esta entrega sigue el alcance aprobado de `ACCESS-UI-001`. El tracker mantiene
separados los pendientes más amplios de selección de recursos y vista previa
de pantallas; no se inventa una equivalencia entre permisos y vistas.

## Límites para la implementación

- Las fases 1 y 2 son la base entregada: se reorganizan y se conservan.
- El editor grupo → rol permanece disponible en Roles y permisos.
- El chip usa únicamente grupos observados y fecha; no acepta referencias manuales.
- El origen `manual` / `oidc` ya está resuelto. El contrato actual no enumera
  qué grupo causó cada asignación OIDC; los grupos se muestran como observados,
  sin atribuirles una causalidad por rol que la respuesta no acredita.
- «Sin participación» depende del cambio backend descrito, no de una decisión
  visual pendiente. La duplicación conserva el tipo y los permisos del original.

## Criterios de aceptación y verificación

- La lista de usuarios aparece inmediatamente después de su barra de herramientas.
- Cada ficha deja claro qué identidad se administra y de dónde proviene cada rol.
- El chip de Okta muestra sólo información disponible y autorizada.
- El rol muestra qué grupos de Okta lo otorgan, sin controles de edición.
- La lista por rol reutiliza el filtro de personas y conserva la cuenta correcta.
- Un compuesto de sólo Netskope puede existir sin dominios obligatorios ajenos
  ni permisos PAM implícitos, con verificación backend de su herencia y estado.
- El alcance de un rol puede entenderse sin leer códigos técnicos.
- Las capacidades se corresponden con la autorización real del backend.
- Se conservan asignaciones, techo de delegación, protección del propio rol,
  último administrador y auditoría transaccional.
- Las acciones disponibles respetan permisos y modo de autenticación.
- El flujo funciona con teclado y en los temas oscuro y claro, con densidad
  de escritorio y estados de carga, vacío, error y guardado explícitos.

La implementación requiere regresiones de flujo y autorización, comprobación
de la vista previa frente al backend y E2E de escritorio para los recorridos
modificados. Se ejecutará `npm run verify` y el grupo E2E transversal pertinente.
Los resultados de esta entrega están registrados a continuación.

## Evidencia de la entrega (2026-10-11)

- `npm run verify`: aprobado; 1.601 tests backend con PostgreSQL efímero,
  482 tests frontend, compilación, estilos, tipos generados y controles del
  repositorio. No se agrega migración.
- Regresiones E2E de acceso, teclado, contraste, temas, mapeos y composiciones:
  54/54 aprobadas en una compilación aislada en `/tmp`, incluyendo Ayuda y
  avisos para comprobar los fallos de la corrida extensa.
- La suite transversal completa ejecutó 293 casos: 289 aprobaron en esa
  corrida. Las cuatro fallas fueron dos descargas de assets en Ayuda, una
  aserción de animación de avisos y la regresión nueva de geometría del diálogo
  de grupos. Esta última se corrigió colocando el diálogo fuera del panel
  animado. Los cuatro casos aprobaron en la repetición aislada anterior.
- Se inspeccionó la interfaz con `agent-browser` y datos de prueba. El backend
  sigue imponiendo techo, origen de asignaciones, último administrador y
  auditoría; los mapeos OIDC se aplican en el siguiente login.

Revisión del dueño (mismo día): el editor de Okta se retiró de la UI y queda
«Lo otorga en Okta» en sólo lectura; la lista de capacidades pasó a ser plana,
sin `domain:*` ni buscador para pocos ítems; la lista de roles usa una línea
por rol y la migración 097 corrige textos del catálogo. `npm run verify`
aprobado (1.601 backend, 482 frontend) y E2E de `auth` y `ux-aud` en ambos
temas (173 casos).

La proyección de grupos usa el issuer configurado y sólo las identidades de
la página. Las pruebas HTTP verifican la redacción sin permiso de lectura del
mapeo; PostgreSQL verifica las observaciones persistidas, la herencia dinámica
sin dominios implícitos, el retiro explícito de áreas y el paso de una
composición planificada a activa al omitir el área planificada.

## Referencias

- [Diseño de vistas por pregunta](view-design.md).
- [Catálogo generado de roles, dominios y permisos](access-catalog.md).
- [Autenticación y asignaciones locales/OIDC](../operations/authentication.md).
- [Modularidad y propiedad de las capas](modularity.md).
- [Contratos de integración y límites entre fuentes](integration-contracts.md).
