---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-13
---

# Autenticación y acceso operativo

Esta guía concentra OIDC local y tokens personales de API. No copiar secretos,
tokens, valores de `.env.local` ni contenido de ID tokens a tickets, chats o al
repositorio.

## OIDC con Okta

DS Hub soporta `local`, `hybrid` y `oidc`. Para una prueba, usar `hybrid` hasta
validar el flujo: conserva el login local mientras Okta es la autoridad de
identidad.

IAM debe entregar el `issuer` exacto, `client_id`, `client_secret`, redirect
URI autorizada, scopes/claims del ID token y grupos de los usuarios de prueba.
No se deben inferir valores desde un token real.

```dotenv
AUTH_MODE=hybrid
OIDC_ISSUER_URL=<issuer-entregado-por-iam>
OIDC_CLIENT_ID=<client-id-entregado-por-iam>
OIDC_CLIENT_SECRET=<client-secret-entregado-por-iam>
OIDC_SCOPES=openid profile email
OIDC_REDIRECT_URI=http://localhost:8000/api/auth/callback
OIDC_GROUP_CLAIM=groups
OIDC_ROLE_MAP_JSON=<json-con-los-grupos-reales>
OIDC_DEFAULT_ROLE=
SESSION_HTTPS_ONLY=false
```

Reiniciar `npm run web` tras modificar variables. Para probar OIDC sin login
local usar `AUTH_MODE=oidc` sólo cuando issuer, cliente y redirect URI estén
confirmados.

### Mapeo y corte

El claim de grupos debe estar en el **ID token** y filtrado por `sg_ds-hub_`.
En producción está configurado como `Always`; `OIDC_SCOPES=openid profile email`
es suficiente. No asignar un `OIDC_DEFAULT_ROLE` privilegiado.

| Grupo Okta | Rol interno |
|---|---|
| `sg_ds-hub_admins` | `admin` |
| `sg_ds-hub_operadores` | `operator` |
| `sg_ds-hub_lectores` | `reader` |

Antes de producción, confirmar usuarios de prueba, URL pública en
`OIDC_REDIRECT_URI`/`WEB_ORIGIN` y si el corte será `hybrid` u `oidc`. Probar
login, logout, cada rol y un usuario sin grupo mapeado. La migración
`050_oidc_user_directory.sql` registra sólo identidades que iniciaron sesión;
un email igual nunca une credenciales, sesiones ni permisos.

El diagnóstico read-only queda disponible sólo por API:
`GET /api/access/oidc-health`, con `access:oidc_mappings_read` o
`access:manage`. Conserva configuración no secreta y advertencias
deterministas. Su pestaña se retiró de Administración → Acceso.
`hybrid` sigue siendo un modo de transición, nunca OIDC endurecido.

### Grupos y miembros observados

Administración → Acceso → Usuarios muestra los grupos mapeados por
`OIDC_ROLE_MAP_JSON` y sus miembros observados. La migración aditiva
`076_oidc_observed_groups.sql` guarda únicamente los nombres exactos de
esos grupos y la fecha de observación en `access_oidc_users`; no guarda
tokens ni el payload del proveedor. Cada login verificado reemplaza la
observación anterior junto con los roles, en una transacción auditada.
Un claim válido vacío registra una observación sin grupos; un claim ausente
o inválido deja la pertenencia desconocida y descarta la observación previa.

Las identidades anteriores no se rellenan a partir de sus roles: permanecen
sin observación hasta un nuevo login. Un rol por defecto tampoco implica
pertenencia a un grupo. La consulta usa exclusivamente el issuer configurado.
No es una sincronización del directorio de Okta ni detecta cambios de grupo
entre logins; `OKTA-DIR-001` y la revocación inmediata siguen pendientes.

`GET /api/auth/oidc-groups` devuelve los grupos mapeados, el total de miembros
observados y hasta 100 miembros por grupo, con su fecha de observación; la UI
indica cualquier truncamiento. Requiere `access:manage`, o lectura de
directorio (`access:directory_read`, `access:local_users_manage` o
`access:role_assignments_manage`) junto con `access:oidc_mappings_read`.
La interfaz sólo presenta esta sección en modos `hybrid` y `oidc`.

## Cuenta local para automatización de navegador

Con `AUTH_MODE=hybrid` el login principal ofrece sólo Okta. El formulario
local está en `/login/local` y existe para una única cuenta local: la que usa
`agent-browser` para QA. Esa ruta no es secreta; el backend decide quién entra.

La cuenta permanece **desactivada** salvo durante una sesión de QA y nadie
conoce su contraseña:

```bash
npm run agent-access -- open --email admin@itti.digital    # activa y guarda el perfil «dshub»
agent-browser auth login dshub                              # entra por /login/local
npm run agent-access -- close --email admin@itti.digital   # desactiva y elimina el perfil
```

`open` activa la cuenta con una contraseña aleatoria, sin cambio obligatorio
en el primer login, y la entrega a `agent-browser auth save` por stdin: no se
imprime, no se registra y no se escribe en el repositorio. `close` la
desactiva con otra contraseña aleatoria que nadie guarda y elimina el perfil.
Ambos cierran las sesiones abiertas de la cuenta y registran
`automation_access_opened` o `automation_access_closed` en la auditoría, en la
misma transacción. `--profile` y `--login-url` cambian el perfil o la URL.

La regla de «al menos un administrador» cuenta las cuentas locales activas y
las identidades del issuer OIDC configurado cuando `AUTH_MODE` es `oidc` o
`hybrid`. Así la cuenta de automatización puede quedar desactivada mientras
haya un administrador de Okta. Si Okta no está disponible, o nadie conserva
`sg_ds-hub_admins`, el acceso de emergencia es `open` desde el servidor, con
acceso a la base de datos.

### Alta y corte a Okta

1. Con una sesión de administrador, crear `admin@itti.digital` en
   Administración → Usuarios y permisos, con rol `admin`. No anotar la
   contraseña temporal.
2. Ejecutar `open` y comprobar `agent-browser auth login dshub`.
3. Entrar por Okta y confirmar que la identidad tiene `admin` por
   `sg_ds-hub_admins`.
4. Desde esa sesión de Okta, eliminar la cuenta local personal.
5. Ejecutar `close`. Desde entonces no queda ninguna cuenta local activa.

## Tokens personales de API

Un usuario autenticado puede emitir un Bearer temporal para consultas desde
Swagger, scripts o reportes sin copiar la cookie del navegador.

- Sólo admite `GET` y `HEAD`; no autoriza mutaciones.
- Permisos se resuelven en cada request y no se amplían.
- Vence entre 5 minutos y 8 horas; máximo 10 activos por usuario.
- Se persiste sólo SHA-256; el valor se muestra una vez.
- Cambio de contraseña, desactivación o pérdida de roles invalida el acceso.
- Emisión y revocación se auditan sin registrar el token ni su hash.

`X-Access-Token` sigue reservado al contrato de escritura de automatizaciones;
no confundirlo con este Bearer personal.

### Emisión, uso y revocación

Desde una sesión del navegador, abrir `/docs` y ejecutar:

```json
POST /api/auth/api-tokens
{
  "label": "reporte-okr-trimestral",
  "expires_in_minutes": 60
}
```

Copiar el valor devuelto inmediatamente y usarlo como:

```text
Authorization: Bearer <token-entregado-una-sola-vez>
```

Guardar el valor sólo en el almacén seguro de la herramienta. Revocarlo al
finalizar con `DELETE /api/auth/api-tokens/{token_id}`. La lista
`GET /api/auth/api-tokens` muestra metadatos; los endpoints de administración
propia requieren sesión interactiva, no otro Bearer.

## Matriz de permisos administrativos (`ACCESS-MATRIX-001`, v1, 2026-09-26)

Esta matriz es el contrato para dividir `access:manage`. El permiso histórico
continúa funcionando como superpermiso durante la migración, pero cada ruta
debe aceptar o aplicar el permiso estrecho indicado. Ocultar un control en el
frontend nunca reemplaza la autorización del backend.

### Permisos objetivo

| Permiso | Autoridad |
|---|---|
| `access:directory_read` | Leer personas e identidades locales/OIDC. |
| `access:local_users_manage` | Crear, editar, desactivar y eliminar identidades locales y regenerar su contraseña temporal. |
| `access:role_assignments_manage` | Asignar roles dentro del techo de delegación del actor. |
| `access:roles_read` | Leer dominios, niveles, roles y permisos internos. |
| `access:roles_manage` | Crear o modificar roles dentro del techo de delegación. |
| `access:permissions_manage` | Crear permisos; reservado al superadministrador. |
| `access:oidc_mappings_read` | Leer grupos OIDC asociados a roles y diagnóstico OIDC no secreto. |
| `audit:read` | Leer auditoría funcional, logs y errores operativos sanitizados. |
| `security:events_read` | Leer eventos de autenticación y seguridad sanitizados. |

### Operaciones

| Operación | Permiso actual | Permiso objetivo | Reglas adicionales |
|---|---|---|---|
| `GET /api/auth/users` | `access:manage` | `access:directory_read` | Incluye identidades locales y OIDC; sin acciones de escritura. |
| `GET /api/auth/oidc-groups` | `access:manage` | Lectura de directorio + `access:oidc_mappings_read` | Miembros observados en logins del issuer configurado; requiere además `access:directory_read`, `access:local_users_manage` o `access:role_assignments_manage`. No enumera el tenant completo. |
| `GET /api/auth/people` | `access:manage` | `access:directory_read` | El agrupamiento visual por correo no fusiona identidades ni permisos. Los grupos observados y su fecha se proyectan por identidad sólo con `access:oidc_mappings_read` o `access:manage`, sin inferir pertenencias por rol. |
| `GET /api/auth/access-review` | `access:manage` | `access:directory_read` | `ACCESS-REVIEW-001`: una fila por rol asignado con origen, fecha y autor de la asignación manual, último ingreso de la identidad Okta y señales de revisión (cuenta local inactiva con roles, asignación manual antigua, Okta sin ingreso). Sólo lectura. Las cuentas locales no registran ingreso y los roles de Okta se reescriben en cada login: esos datos van en `null`, no se infieren. |
| `POST /api/auth/users` | `access:manage` | `access:local_users_manage` + `access:role_assignments_manage` | El rol inicial debe respetar el techo de delegación. |
| `PATCH /api/auth/users/{user_id}` | `access:manage` | Según campos: `access:local_users_manage`; sumar `access:role_assignments_manage` si cambia `role_code` | No permite auto-desactivación ni autoescalamiento; tampoco puede asignar a un tercero un rol que exceda el techo de delegación del actor (`ACCESS-CEILING-001`). |
| `POST /api/auth/users/{user_id}/roles` | — | `access:role_assignments_manage` | `ACCESS-UI-001`: suma un rol asignado en DS Hub (`manual`) a una identidad local u Okta; ningún login lo quita. Techo de delegación; nadie cambia sus propios roles. |
| `DELETE /api/auth/users/{user_id}/roles/{role_code}` | — | `access:role_assignments_manage` | Sólo roles `manual`: un rol mapeado desde un grupo de Okta responde `409` y se cambia en Okta. Techo de delegación y último administrador. |
| `POST /api/auth/users/{user_id}/reissue-temp-password` | `access:manage` | `access:local_users_manage` | Sólo identidad local; secreto visible una vez y acción auditada. |
| `DELETE /api/auth/users/{user_id}` | `access:manage` | `access:local_users_manage` | Conserva el invariante de último administrador y no elimina identidades OIDC. |
| `GET /api/access/permissions` | `access:manage` | `access:roles_read` | Catálogo interno read-only. |
| `GET /api/access/roles` | `access:manage` | `access:roles_read` | `oidc_groups` se devuelve sólo con `access:oidc_mappings_read` o `access:manage`; de lo contrario se omite/vacía. |
| `GET /api/access/domains` | `access:manage` | `access:roles_read` | Dominios y niveles read-only. |
| `PUT /api/access/oidc-group-roles` | — | `access:role_assignments_manage` + `access:oidc_mappings_read` | `ACCESS-UI-001` fase 2: reemplaza los roles que otorga un grupo de Okta (lista vacía = quitar el grupo). La primera edición adopta `OIDC_ROLE_MAP_JSON`; desde entonces el login sólo lee la tabla. Techo de delegación por cada rol agregado o quitado; rige en el próximo login. |
| `GET /api/access/oidc-health` | `access:manage` | `access:oidc_mappings_read` | Diagnóstico read-only: sólo configuración OIDC no secreta, estado de roles destino y último login; nunca client secret, tokens ni payloads de identidad. |
| `POST /api/access/permissions` | `access:manage` | `access:permissions_manage` | Sólo superadministrador; nunca delegable mediante un rol inferior. |
| `POST /api/access/roles` | `access:manage` | `access:roles_manage` | Aplica `ACCESS-CEILING-001`. |
| `POST /api/access/roles/composite` | `access:manage` | `access:roles_manage` | Aplica techo por cada dominio/nivel seleccionado. |
| `PATCH /api/access/roles/{role_code}` | `access:manage` | `access:roles_manage` | No puede añadir permisos que el actor no posee; conserva último administrador. |
| `PATCH /api/access/roles/{role_code}/composite` | `access:manage` | `access:roles_manage` | No puede seleccionar niveles superiores a los del actor. |
| `GET /api/activity` | `access:manage` | `audit:read` | Auditoría funcional sanitizada. |
| `GET /api/operational-errors` | `access:manage` | `audit:read` | Sin trazas, headers, cuerpos ni mensajes sensibles. |
| `GET /api/operational-logs` | `access:manage` | `audit:read` | Sólo registros estructurados sanitizados. |
| `GET /api/security-events` | `access:manage` | `security:events_read` | IP y email permanecen como digest. |
| `PUT /api/ingestion/schedules/{task_key}` | `access:manage` | `access:manage` | Modifica sólo el intervalo de la tarea registrada; el cambio se audita junto con la escritura en una transacción. |

Los roles compuestos pueden omitir dominios mediante `level_refs`: «Sin
participación» no agrega un nivel Lector implícito. Se exige al menos una
selección válida y única por dominio. La herencia, el estado y el techo se
calculan sobre las selecciones explícitas; las composiciones existentes se
conservan hasta que se editen. Un nivel de Plataforma puede otorgar permisos
PAM aunque no se seleccione el dominio PAM: el alcance final es la unión real
de capacidades, no sólo los nombres de las áreas.

### Compatibilidad y orden de implementación

Los permisos estrechos de escritura implican acceso a la lectura mínima que
necesita su flujo: quienes administran cuentas locales pueden listar el
directorio; quienes asignan o administran roles/permisos pueden consultar el
catálogo. Esto no concede ninguna escritura adicional y `oidc_groups` sigue
redactado sin `access:oidc_mappings_read`.

1. Una migración aditiva crea los permisos sin asignarlos automáticamente a
   ningún rol ni usuario. El rol administrador existente conserva el acceso
   por `access:manage`.
2. Las rutas aceptan `access:manage` o el permiso estrecho durante la
   transición.
3. `ACCESS-CEILING-001` se implementa antes de conceder los permisos de
   escritura a roles delegados.
4. El frontend usa los permisos estrechos para visibilidad, pero el backend
   conserva la decisión final.
5. Cada escritura mantiene su evento de auditoría en la misma transacción.

`ACCESS-ROLES-002` (2026-10-11, migración 094): el rol `admin` lista ahora
explícitamente los permisos estrechos que ya alcanzaba por `access:manage`, y
suma `netskope:read`, `access:roles_manage` y `netskope:admin`, que las rutas
de métricas AA, plantillas por rol y líneas base Netskope exigen sin
alternativa. `netskope:dlp_read` y `netskope:uba_read` se conceden sólo a
`netskope_admin`; el administrador de plataforma no los recibe.

`ACCESS-ROLES-003` (2026-10-11, migración 098): decisión del dueño, el rol
`admin` tiene **todos** los permisos activos del catálogo, incluidos
`netskope:dlp_read` y `netskope:uba_read`. `access:manage` por sí solo sigue
sin otorgarlos: los recibe el rol. Un permiso nuevo debe concederse a `admin`
en su misma migración; `test_access_catalog.py` lo exige.

`ACCESS-UI-001` (2026-10-11, migración 095): cada asignación guarda su origen
(`assignment_source`): `oidc` la escribe el login a partir de los grupos y la
reemplaza en cada login; `manual` la asigna un administrador en DS Hub, también
a una identidad Okta, y ningún login la quita. Si los grupos pasan a otorgar un
rol que ya era manual, la fila sigue siendo manual. Una identidad Okta dada de
baja en Okta ya no inicia sesión, pero conserva sus filas manuales hasta que un
administrador las quite.

Fase 2 (migración 096): el mapeo grupo de Okta → rol vive en
`access_oidc_group_roles` y se edita desde «Grupos de Okta»; un grupo puede
otorgar varios roles. Mientras no exista la fila de
`access_oidc_mapping_state`, el login sigue leyendo `OIDC_ROLE_MAP_JSON`. La
primera edición copia ese mapeo a la tabla y crea la fila en la misma
transacción (auditado como `oidc_mapping_adopted`); desde entonces la variable
ya no se lee, aunque la tabla quede vacía. `OIDC_DEFAULT_ROLE` sigue en el
entorno. Un cambio rige en el próximo login de cada miembro.

Decisión 2026-10-11: la UI no edita este mapeo. Sin SCIM ni API de Okta, DS
Hub no conoce los grupos reales y un nombre tipeado con error no otorgaría
nada sin avisar. El detalle del rol lo muestra en sólo lectura («Lo otorga en
Okta») y la ruta `PUT /api/access/oidc-group-roles` queda disponible por API
hasta `ACCESS-UI-003`. Mientras nadie la use, el login sigue leyendo
`OIDC_ROLE_MAP_JSON`.

Las rutas de inventario/cadenas que aceptan `access:manage` como alternativa a
permisos de dominio no forman parte de esta matriz: ya aceptan
`pam:catalogs_read`, `identity:catalogs_read`, `sia:catalogs_read` o
`netskope:read` y no son administración de identidades/RBAC.
