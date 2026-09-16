# Contratos de integración CyberArk

## Estado actual

La cadena PAM fue verificada contra API real e ingerida en la capa normalizada:

```text
users -> roles -> safes -> platforms -> psm
```

| Fuente | Contrato verificado | Uso normalizado |
|---|---|---|
| `/API/Users` | `Users[]`; algunos registros no incluyen `UUID`, todos los observados tienen `username` | `user`; UUID cuando existe, `username` como fallback documentado |
| `/API/UserGroups` | listado paginado; `id` numérico y `groupName` | `role` |
| `/API/UserGroups/{id}` | `members[]` con `id` y `username` | `user_has_role` cuando el usuario existe en `/API/Users` |
| `/API/Safes/{safeName}/Members` | miembros `Group` coinciden por `memberName` con `groupName` | `role_grants_access` hacia Safe |
| `/API/Accounts` | `id`, `name`, `userName`, `address`, `safeName` y `platformId` cuando están presentes | cuentas no sensibles en `cyberark_accounts`; relación `safe_uses_platform` cuando la evidencia es completa |
| `/API/Platforms` | `Platforms[]`, `general.id`, `general.name`, `general.active`, `general.systemType`, `sessionManagement.PSMServerID` | `platform`, `psm`, `platform_uses_psm` |
| `/API/Platforms/{id}` | `PlatformID`, `Active`, `Details.AllowedSafes` (texto) | sólo `allowed_safes_pattern` de plataforma; se excluyen políticas, reglas de contraseña, notificaciones y demás campos de `Details` |

El explorador visual `/pam/graph` presenta las relaciones PAM verificadas por identidad. Sus inventarios de detalle están separados: `/pam/platforms` usa `GET /api/cmdb/pam-platforms` para plataformas activas y el workspace unificado `/pam/connectors` usa `GET /api/cmdb/pam-connectors` para objetos `psm` activos y `GET /api/cmdb/sia-connectors` para objetos SIA (`source_system = sia`), con un toggle de vista que no mezcla sus filas. Ninguna fuente atribuye CPU, RAM o capacidad sin un contrato explícito.

La última sincronización normalizada dejó 95 usuarios, 78 roles, 465 Safes,
75 plataformas, 3 PSM y relaciones verificadas de usuario a rol, rol a Safe,
Safe a plataforma y plataforma a PSM. Siete membresías de grupo no tienen
contraparte en `/API/Users`; se omiten del vínculo y quedan como gap de fuente,
sin crear identidades inventadas.

Se almacenan únicamente identificadores y atributos operativos no sensibles de
las cuentas en `cyberark_accounts`: nombre, username, dirección, Safe y
plataforma. Nunca se almacenan contraseñas, secretos ni payloads completos de
`/API/Accounts`. Las cuentas ausentes de una corrida completa se marcan como
`retired`; una corrida con registros no identificables no reconcilia bajas.

**Alcance real de la sincronización PAM.** `POST /api/ingestion/preview`
compara únicamente Safes (`compare_inventory`); nunca aplica cambios. Al
confirmar, `POST /api/ingestion/all/runs` encola una corrida PAM completa y una
corrida aislada de catálogo PSM (`cyberark-psm-api`) en la misma acción. Para
cada fuente cuyo contrato esté configurado también encola Identity
Administration, SIA y/o Access como corridas aisladas (`configured_optional_source_jobs()` en
`backend/app/lifecycle.py`, compartida con el scheduler programado desde
2026-09-11 — antes esta ruta encolaba las cuatro corridas incondicionalmente,
inconsistente con el copy del frontend que ya decía "se encola sólo si el
contrato está configurado"). La corrida
`cyberark` (`run_ingestion`, `backend/app/ingestion.py`) siempre reconcilia
Safes/miembros y, además, llama a `sync_pam_inventory`
(`backend/app/pam_inventory.py`) — que refresca plataformas,
`platform_target`/`platform_dependent`/`platform_group`/
`platform_rotational_group`, `psm_connector`, `component` (Salud PAM) y
`aim_application` — sólo cuando `should_sync_pam(options, errors)` es `true`:
un snapshot completo de Safes (`max_safes = 0`) y sin errores. Un snapshot
parcial o con algún Safe fallido deja esos catálogos técnicos sin tocar (evita
retiros falsos por datos incompletos); el mismo criterio aplica a la corrida
programada del scheduler. Identity Administration, SIA y Access son fuentes
independientes: nunca se infieren ni se sincronizan como efecto de la corrida
PAM, y SIA no se relaciona con PAM por nombre/IP salvo las excepciones
sancionadas ya documentadas (join exacto de `platformId` en `ACCESS-001`, IP
literal en la cadena SIA).

## Cadena SIA

**Contrato confirmado el 2026-08-16** contra el tenant real:

- URL base: `https://itti.dpa.cyberark.cloud`; usa el tenant `itti`, el mismo
  identificador de `CA_PVWA_URL`, no el subdominio de Identity Administration.
- Autenticación: OAuth `client_credentials`, con el mismo cliente autorizado
  para PVWA/Identity Administration y permisos SIA/DPA en el tenant.
- Listado: `GET /api/access-policies` con `{totalCount, items[]}`; cada política
  observada incluye `policyId`, `policyName`, `status`, `description`,
  `platforms` y `ruleNames`.
- Detalle: `GET /api/access-policies/{policyId}`; agrega `userAccessRules`,
  grantees por usuario/grupo/rol y `providersData`. En el tenant validado,
  `providersData.OnPrem` contiene `ipRules`, `fqdnRules` y `logicalNames`,
  que se conservan como destinos/assets operativos de la política.

La implementación usa un cliente separado en `backend/app/integrations/sia.py`,
una sincronización en `backend/app/sia_sync.py` y persiste políticas como
`source_system = 'sia'`, `object_type = 'access_policy'`. Los grantees se
conservan como atributos hasta confirmar que sus IDs cruzan de forma estable
con Identity Administration; no se fabrican relaciones. Los destinos permanecen
dentro de los atributos de `access_policy`; no se crean relaciones hacia PAM ni
objetos de destino independientes sin un contrato adicional.

**Conectores (`SIA-CONN-001`) y recursos VM (`SIA-RES-001`) confirmados e
implementados el 2026-09-11**, mismo cliente y credenciales:

- `GET /api/connectors` → `{continuationToken, count, items[]}`, persistido
  como `object_type = 'sia_connector'`. Excluye `hostIp`/`hostName`/
  `hostNetwork`/`hostSubnet`/`hostInstanceId` (host/red) y `proxySettings`
  (shape nunca observado con un valor). `activeSessionsCount`/`status`/
  `version`/`region`/`workspaceId` se conservan.
- `GET /api/infrastructure/virtual-machines` → `{items[], nextToken,
  totalCount}`, persistido como `object_type = 'sia_resource'` con
  `attributes.resource_type = 'virtual_machine'` (deja espacio para un futuro
  catálogo Database sin nueva migración). Excluye `ip`/`fqdn`/`networkName`.
- **Ambos catálogos son opcionales**: `CA_SIA_CONNECTORS_PATH` y
  `CA_SIA_VM_INFRASTRUCTURE_PATH` no forman parte del contrato requerido de
  `SiaSettings.from_environment()` — una instalación que sólo configuró
  políticas sigue sincronizando sin cambios. `sync_sia_inventory` sólo pide y
  reconcilia estos tipos cuando su path está configurado, para no retirar
  filas de un catálogo que una corrida determinada nunca pidió.
- **Cadencia programada por fuente configurada**: cada ciclo de
  `INGESTION_INTERVAL_MINUTES` encola PAM y, cuando sus contratos están
  configurados, Identity Administration, SIA y Access como corridas
  independientes. La cola y el lock por `source_system` mantienen aisladas
  las fallas y reconciliaciones de cada fuente; una integración sin variables
  aprobadas no genera una corrida fallida.
- **Paginación no confirmada, resuelta de forma defensiva**: `continuationToken`/
  `nextToken` fueron observados truthy incluso con la colección completa
  (`count`/`totalCount` ya satisfecho). El cliente corta por `count`/
  `totalCount`, no por la sola presencia del token, y sólo falla ruidoso si
  la página es más corta que su propio total reportado — ahí sí haría falta
  confirmar el parámetro real de cursor, cosa que cuatro nombres candidatos
  (`nextToken`/`cursor`/`pageToken`/`continuationToken`) no lograron
  distinguir en un tenant sin exceso de datos para paginar de verdad.
- `Strong accounts` (`SIA-STRONG-001`) implementado 2026-09-11: `GET
  /api/database-strong-accounts` → `{items[], nextCursor, totalCount}`,
  persistido como `object_type = 'sia_database_account'` (propio, no
  compartido con `sia_resource`: la reconciliación opera por `object_type` y
  una instalación que sólo configura uno de los dos catálogos no debe retirar
  las filas del otro). Sólo se mapean los campos confirmados: `storeType`/
  `createdAt`/`modifiedAt` a nivel raíz y `accountProperties.{platform,port,
  database}`; `accountProperties.address`/`.username` se excluyen (host/
  credencial-adyacente). Opcional (`CA_SIA_DB_STRONG_ACCOUNTS_PATH`), mismo
  patrón que conectores/VM arriba. `Database resources` separado de Strong
  accounts sigue sin implementar: no se encontró un endpoint distinto.

### Validaciones pendientes

- **Paginación de `/api/access-policies` confirmada e implementada (2026-09-10):**
  el cliente pagina con `limit`/`offset` hasta agotar `totalCount` (o hasta una
  página corta cuando el tenant no lo devuelve), con un tope de seguridad de
  20 000 objetos y detección de `totalCount` inconsistente entre páginas.
  Ver `backend/app/integrations/sia.py::SiaClient.get_policies` y
  `backend/tests/test_sia.py`.
- **Probe de throttling 2026-09-11 (inconcluso):** 40 requests secuenciales a
  `/api/access-policies` (~2.5 req/s sostenido durante ~16s) devolvieron `200`
  en las 40, sin ningún header `Retry-After`/`X-RateLimit-*` expuesto ni en
  éxito. No se observó `429`. Esto no confirma que el tenant nunca throttlee,
  sólo que este umbral bajo no lo dispara ni expone métricas de rate limit;
  una ráfaga concurrente o de mayor volumen se acerca a un test de stress real
  contra producción y requiere autorización explícita adicional antes de
  intentarse. El cliente ya reintenta con backoff ante `429`/5xx (`get_json`)
  como diseño defensivo, independientemente de este resultado.
- Falta confirmar el espacio de IDs de grupos y roles SIA para relaciones
  normalizadas futuras.
- La UI del tenant muestra políticas recurrentes, recursos Database/VM,
  Strong accounts, conectores y diagnósticos de sesiones. `SIA-RES-001` (VM),
  `SIA-CONN-001` y `SIA-STRONG-001` (Database strong accounts) ya tienen
  contrato API confirmado e implementado (ver arriba); `SIA-DIAG-001` sigue
  sin ningún endpoint público encontrado.
- Recursos, Strong accounts y conectores SIA permanecen
  `source_system = 'sia'`. No se unen a las plataformas/PSM PAM ni a cuentas
  PAM por nombre, dirección, servicio, dominio o cualquier heurística.
- Session diagnostics requiere decisión de RBAC, retención y allowlist. Por
  defecto quedan excluidos usuario, target/IP, Session ID, texto libre,
  certificados y recordings.

## Access space (ACCESS-001)

**Contrato confirmado el 2026-09-11** contra el tenant real, implementado
end-to-end:

- URL base: `https://{tenant}-userportal.cyberark.cloud` (subdominio propio
  del Access space, distinto del de PVWA y del de SIA).
- Autenticación: reusa el mismo flujo OAuth `client_credentials` /
  `oauth2/platformtoken` y el mismo client id/secret ya autorizados para
  PVWA — confirmado en vivo, no hizo falta habilitar nada nuevo en el tenant.
- Listado: `GET /api/assets` con `{assets:[...], diagnostics, nextToken, size}`.
  Cada asset observado incluye `accessMethod`, `address`, `assetCategory`,
  `assetId`, `assetType`, `connectionComponents`, `customProperties`
  (`{port, logon_domain}`), `fileCategories` (casi siempre `{}`),
  `isFavorite`, `platformId`, `platformSubtype`, `platformType`, `protocol`,
  `username`, `workflowStatus`.
- Paginación **no confirmada**: todas las respuestas observadas (7 assets)
  tuvieron `nextToken: null`. El cliente (`integrations/access.py`) falla
  ruidosamente si alguna vez llega un `nextToken` no nulo, en vez de adivinar
  el parámetro de cursor — mismo criterio que `sia.py` aplicó a `get_policies`
  antes de que su paginación se confirmara.

La implementación usa un cliente separado en `backend/app/integrations/access.py`,
una sincronización independiente en `backend/app/access_sync.py` y persiste
assets como `source_system = 'access'`, `object_type = 'access_asset'`
(migración `040`). El historial de corridas (`cyberark_ingestion_runs`) y
`cyberark_findings` ampliaron el mismo valor en la migración `042`: el CHECK
de `025` no incluía `access`, y `POST /api/ingestion/all/runs` fallaba al
encolar esa fuente. Excluidos del mapeo: `address` (host/IP),
`username` (credencial-adyacente), `customProperties.logon_domain` y
`fileCategories.LogonDomain` (dominio AD, mismo criterio que host/infra).

**`platformId`: excepción sancionada, segundo puente cross-source.**
`platformId` cruza exactamente con el `PlatformID` de PAM (los 2 valores
distintos observados en 7 assets coincidieron con un `PlatformID` ya
ingerido; confirmado también en la corrida real: 7/7 assets resolvieron
`platform_name`). A diferencia de `PLAT-002` (donde la mayoría de los IDs
*no* cruzaban), acá el espacio de IDs sí es compartido. Aun así, **no se
persiste como relación** en `cyberark_inventory_relationships`: esa tabla
tiene una sola columna `source_system` y no puede representar un edge entre
un objeto `access` y uno `cyberark`. Se resuelve con un join de sólo lectura
en `backend/app/repositories/access_queries.py` — mismo patrón que el puente
Identity Administration -> PAM (`identity_pam_bridge.py`) y el join SIA -> Safes
por IP (`sia_queries.py::_safe_links_by_ip`): sólo por igualdad exacta de ID,
nunca por nombre, y un asset sin match sigue listándose normalmente con
`platform_name = null`.

## Contrato confirmado de Identity Administration

Contrato confirmado el 2026-08-16 contra el tenant real mediante los probes
versionados (ver `docs/reference/identity-administration-sample.json` para
la forma completa, anonimizada):

- URL base del tenant: la misma que `CA_IDENTITY_URL` (no un host nuevo).
- Endpoint OAuth: `{CA_IDENTITY_URL}/oauth2/platformtoken`, mismo flujo
  `client_credentials` que ya usa PVWA.
- Autenticación: el mismo `CA_CLIENT_ID`/secreto que ya usan para Safes
  alcanzó (rol `System Admin` asignado sobre ese usuario de servicio); no
  hizo falta un cliente OAuth nuevo.
- Protocolo: SCIM 2.0 (RFC 7644), no el shape `value`/`nextLink` que se
  había asumido especulativamente antes de confirmar el contrato.
- Endpoint de usuarios: `GET /scim/v2/Users` (id, userName, displayName,
  active, emails, groups embebidos, meta.lastModified).
- Endpoint de roles: `GET /scim/v2/Groups` (id, displayName, members
  embebidos, meta.lastModified).
- Paginación: `startIndex`/`count` (estándar SCIM), sin `nextLink`.
- **Bugs conocidos de esta API** (no del cliente): `totalResults` en
  `/scim/v2/Users` es poco confiable — reportó 79 cuando el conteo real era
  100. `meta.created`/`meta.lastModified` de cada usuario a veces coincide
  con el instante exacto del pedido en vez de una fecha histórica real. Una
  misma página puede repetir el mismo `id` dos veces, a veces idéntico, a
  veces con campos distintos entre ambas copias. El cliente no usa
  `totalResults` para decidir cuándo parar de paginar (usa el criterio de
  página corta) y colapsa `id` repetidos dentro de una página (se queda con
  la primera aparición) antes de que lleguen a la validación de duplicados
  conflictivos del CMDB normalizado.
- **Dato tranquilizador**: dos corridas consecutivas contra el tenant real
  devolvieron el mismo conjunto de 79 usuarios / 64 roles y la segunda no
  retiró ningún objeto — el universo de identidades es estable entre
  corridas aunque los metadatos puntuales (timestamps, `totalResults`,
  duplicados intra-página) no lo sean.
- Pendiente operativo: comportamiento exacto ante `429` y límites de rate
  limit del tenant; el cliente reintenta, pero todavía no se validó el límite
  real del tenant.

## Mapeo esperado

| Fuente | `object_type` | `source_id` | Relaciones |
|---|---|---|---|
| Identity Administration user | `user` | ID estable del usuario | `user_has_role` |
| Identity Administration role/group | `role` | ID estable del rol | `role_grants_access` |
| Safes actual | `safe` | `safe_number` o `safe_url_id` | `safe_uses_platform` |
| Plataforma | `platform` | ID/nombre estable | `platform_uses_psm` |
| PSM | `psm` | ID/nombre estable | n/a |
| Política SIA | `access_policy` | ID estable | `policy_grants_sia` |
| SIA | `sia` | ID estable | n/a |

## Reglas

- No usar `safe_members` como sustituto de usuarios de Identity Administration.
- La relación rol→Safe PAM se admite únicamente cuando un miembro `Group` de
  Safe coincide con un `groupName` único observado en `/API/UserGroups`; el
  identificador persistido del rol sigue siendo el `id` de CyberArk.
- No tratar nombres como identificadores estables fuera de esa evidencia de
  unión documentada.
- Para la presentación del directorio SCIM, `displayName` con prefijo
  `sg_cyberark` identifica un grupo Okta según la convención operativa
  confirmada. Los demás objetos de `/scim/v2/Groups` se presentan como roles;
  esta clasificación no crea relaciones ni cruza fuentes.
- Identity Administration reconcilia una corrida SCIM completa de forma aislada:
  usuarios y roles ausentes se marcan `retired` dentro de
  `source_system = 'identity_administration'`. Nunca retira objetos PAM o SIA.
- Las relaciones PAM se conservan y pasan a `retired` solo cuando su fuente no
  tiene gaps de mapeo. Actualmente se reconcilian `role_grants_access` y
  `platform_uses_psm`; `user_has_role` y `safe_uses_platform` esperan resolver
  sus registros no mapeables.
- Cada ingesta debe guardar `source_run_id`, `first_seen_at` y `last_seen_at`.

**Federaciones (`ID-001`) confirmadas e implementadas el 2026-09-11**, mismo
cliente y credenciales, sin variables nuevas requeridas:

- `GET /Federation/GetFederations` → `{Result:[...], ErrorCode, success}` —
  no es una colección SCIM, no pagina con `startIndex`/`count`.
- Persistido como `object_type = 'identity_federation'`, sólo con los campos
  núcleo: `FederationUuid` (source_id), `FederationName` (display_name),
  `FederationType`, `Active`, `Role`, `Usage`.
- **Excluido explícitamente**: `Config` (metadata SAML/SSO, certificados IDP/
  SP — nunca certificados, misma regla que en todo el proyecto) y
  `Domains[]`/`Apps[]`/`CyberarkServices[]` (topología de apps/dominios
  federados sin necesidad de negocio confirmada para exponerla en el CMDB).
  Si esa necesidad aparece, se agregan como campos explícitos propios, nunca
  como passthrough de los objetos originales.
- **Opcional**: `CA_IDENTITY_ADMIN_FEDERATIONS_PATH` no está en el contrato
  requerido de `IdentityAdminSettings.from_environment()` — una instalación
  que sólo sincroniza usuarios/roles sigue funcionando sin cambios;
  `identity_federation` sólo entra en la reconciliación cuando ese path está
  configurado.
- `Roles/GetRole` (API separada `user-mgmt-api`) sigue sin confirmar (no hay
  un ID de rol real para probar su shape); no forma parte de este contrato.

## Excepción sancionada: puente Identity Administration -> cadena PAM

Aprobada 2026-08-29 por el dueño de producto. La lectura cross-source
permitida vive en `identity_pam_bridge.py` (drawer de Identidad y anotación
de asiento Standard en Usuarios), y sólo bajo estas condiciones:

- **Sólo por identificador determinístico.** Se vincula un usuario de
  `source_system = 'identity_administration'` con un usuario de
  `source_system = 'cyberark'` **únicamente** cuando `source_id` es
  exactamente igual (el mismo UUID de CyberArk Identity). Nunca por
  `display_name`, email, `user_name`, `ILIKE` ni ninguna heurística.
- **Cobertura parcial y explícita.** En la corrida observada, 49 de 77
  usuarios de Identity Administration tienen contraparte PAM por UUID; los
  usuarios PAM con `attributes.identity_key = 'username'` no participan. El
  drawer muestra "sin equivalencia en la cadena PAM" cuando no hay match.
  Las cifras exactas salen siempre de la base, no de este texto.
- **Roles y SIA quedan fuera.** Los roles de Identity Administration no
  comparten `source_id` con los roles PAM (0 coincidencias observadas), así
  que no hay puente para roles. SIA no expone el UUID en sus grantees; su
  vínculo sigue siendo navegación por nombre desde el drawer, señalada como
  tal en la UI.
- **Sólo lectura y aislada de las métricas.** La consulta vive en
  `backend/app/repositories/identity_pam_bridge.py`. Se expone en
  `GET /api/cmdb/identity-users/{object_id}/pam-chain` y, con el mismo
  criterio de UUID, anota `standard_seat_reconciled` en
  `GET /api/cmdb/identity-users` y el detalle. No escribe nada y no alimenta
  `/api/cmdb/coverage` ni ningún KPI. La evidencia del asiento Standard sigue
  siendo PAM (`EPVUser` ∩ roles Privilege Cloud); Identity sólo muestra el
  badge si el `source_id` coincide. La regresión
  `backend/tests/test_identity_admin_isolation.py` verifica que el puente
  sólo une por igualdad de `source_id`. Una vez resuelto el usuario PAM, delega
  al recorrido single-source de `pam_chain_queries.py`: `user_has_role`,
  `role_grants_access`, `safe_uses_platform` y `platform_uses_psm`.
- `backend/app/repositories/identity_admin_queries.py` permanece
  estrictamente single-source; el puente es un módulo aparte.
- El workspace `/pam/graph` consulta usuarios PAM directamente por
  `object_id`; no es una segunda excepción cross-source y no incorpora SIA.

## Configuración explícita

Los clientes no tienen endpoints por defecto. Para activarlos se deben
configurar explícitamente las variables aprobadas por el tenant:

```dotenv
CA_IDENTITY_ADMIN_URL=
CA_IDENTITY_ADMIN_TOKEN_URL=
CA_IDENTITY_ADMIN_CLIENT_ID=
CA_IDENTITY_ADMIN_CLIENT_SECRET=
CA_IDENTITY_ADMIN_USERS_PATH=
CA_IDENTITY_ADMIN_ROLES_PATH=

CA_SIA_URL=
CA_SIA_TOKEN_URL=
CA_SIA_CLIENT_ID=
CA_SIA_CLIENT_SECRET=
CA_SIA_POLICIES_PATH=
```

Para cualquiera de los secretos se puede usar el archivo equivalente
`CA_IDENTITY_ADMIN_SECRET_FILE` o `CA_SIA_SECRET_FILE`. Las variables de URL,
cliente o path por sí solas indican configuración parcial; el cliente rechaza
la sincronización si falta una parte del contrato.

## Inspección segura del contrato

Para validar cambios de contrato o endpoints adicionales se pueden usar los
probes versionados. Los probes leen los secretos desde `.env.local`,
`.ca_secret` o un archivo explícito y muestran únicamente metadatos JSON por
defecto:

```bash
scripts/probe_cyberark_endpoint.sh /API/Safes
```

Para inspecciones SIA se usa un probe separado. El script admite un header
específico porque también sirve para contratos de tenants que no usan OAuth;
la implementación actual de SIA usa el OAuth documentado arriba y no debe
copiar secretos a archivos de probe:

```bash
SIA_PROBE_BASE_URL=https://URL_APROBADA \
SIA_PROBE_HEADER_NAME=HEADER_APROBADO \
SIA_PROBE_TOKEN_FILE=.sia_api_token \
  scripts/probe_sia_endpoint.sh /RUTA_APROBADA
```

Ambos probes exigen `curl` y `jq`, usan HTTPS, limitan las URLs absolutas a la
base configurada y no imprimen el token ni el payload completo por defecto.
`PROBE_RAW=1` y `SIA_PROBE_RAW=1` quedan reservados para una inspección local
controlada. Un probe sirve para observar o validar un endpoint; no reemplaza
la aprobación del contrato ni habilita una nueva persistencia por sí solo.

## Próximos pasos

El estado de ejecución se mantiene en
[`docs/TO_IMPLEMENT.md`](../TO_IMPLEMENT.md), tareas `INT-002`, `CPM-001`,
`REL-001` y el barrido REST de Privilege Cloud Standard. `INT-001` quedó
cerrado: las corridas completas de Identity Administration y SIA ya se
validaron en el ambiente operativo.

- Paginación de `/api/access-policies` ya resuelta (`SiaClient.get_policies`).
  Sigue pendiente confirmar `429`/`Retry-After` reales y el espacio de IDs de
  grupos/roles SIA antes de agregar relaciones nuevas o automatizar
  reconciliaciones más amplias.

## Endpoints PAM documentados pendientes de validar

La documentación oficial de Privilege Cloud Standard segmenta los siguientes
endpoints PAM. Son candidatos de lectura; no autorizan por sí mismos nuevas
persistencias ni revelan el permiso efectivo del cliente del tenant.

- `GET /PasswordVault/API/ComponentsMonitoringSummary/` devuelve el resumen de
  Portal, CPM, PSM/SSH y AIM: identificador/nombre, instancias conectadas,
  totales y un contador específico de cada componente.
- `GET /PasswordVault/API/ComponentsMonitoringDetails/{ComponentID}/` agrega
  IP, usuario de componente, versión, conectividad y último logon para `PVWA`,
  `SessionManagement`, `CPM` y `AIM`. El campo
  `ComponentSpecificStat` del detalle está documentado como `-1`; no se usa
  como métrica.
- `GET /PasswordVault/API/PSM/Servers/` lista `Id`, `Name` y `Address`; y
  `GET /PasswordVault/API/PSM/Connectors/` lista `Id` y `DisplayName`. Ninguno
  aporta CPU, RAM, capacidad o salud de host.
- `GET /PasswordVault/API/Accounts/{AccountID}/Activities/` documenta
  actividades de cuenta. `User`, `MoreInfo` y `Reason` pueden contener datos
  personales o texto sensible: quedan fuera de cualquier persistencia hasta
  aprobar una allowlist y retención.
- `GET /PasswordVault/API/LiveSessions` entrega sesiones activas con campos de
  usuario, cuenta, dirección y `RawProperties`. No se persiste ni muestra ese
  detalle sin una decisión explícita de privacidad y RBAC.
- `GET /PasswordVault/API/Platforms/` (ya ingestado de forma delgada) y
  `GET /PasswordVault/API/Platforms/{id}` / `GET /PasswordVault/API/platforms/targets/`
  documentan política CPM, workflows de dual control y `PSMServerID`.
  `properties` de plataforma describe nombres de campos de cuenta, no valores.
- `GET /PasswordVault/API/platforms/dependents/`, `/groups/` y
  `/rotationalGroups/` listan catálogos adicionales (incl. `GracePeriod` en
  rotational). No se interpretan como rotación de secretos de cuenta.
- `GET /PasswordVault/API/Platforms/{PlatformID}/Safes/` devuelve nombres de
  Safe por plataforma.
- `GET /PasswordVault/API/Users?ExtendedDetails=true` agrega `enabled`,
  `suspended`, `groupsMembership` y `vaultAuthorization`. `personalDetails`,
  `internet` y `phones` de `GET /API/Users/{UserID}` quedan fuera.
- `GET /PasswordVault/API/DiscoveredAccounts/` es la cola Pending; exige Vault
  Admins. `platformTypeAccountProperties`, fingerprints y AWS key IDs no se
  persisten.
- `GET /PasswordVault/API/AutomaticOnboardingRules/` lista reglas (Vault Admins).
  `TargetSafeName` puede ser nulo si el caller no es owner del Safe.
- Incoming requests (landing `confirmrequests.htm`) y recordings
  (`GET /PasswordVault/API/recordings`) quedan bloqueados por privacidad/RBAC
  igual que `LiveSessions`. No se usa Play recording.
- AIM Gen1 `GET /PasswordVault/WebServices/PIMServices.svc/Applications/` es
  catálogo de `AppID`. Los métodos
  `.../Applications/{AppID}/Authentications/` incluyen `AuthValue` (hash, path,
  OS user, IP) y no se persisten.
- Account groups, linked accounts y
  `GET /API/accounts/{account_id}/account-dependents/` son relaciones PAM de
  sólo lectura; probe antes de persistir.
- `GET /PasswordVault/API/Accounts` documenta `savedFilter` (`PolicyFailures`,
  `FailedChange`, `FailedVerify`, `FailedReconcile`, `ScheduledFor*`). Útil
  como hallazgo sólo después de la allowlist de `secretManagement`.
- LDAP directories/mappings son configuración del Vault, no Identity
  Administration SCIM. Sin secretos de bind.
- Mutaciones, secret versions, SSH MFA caching keys, ticketing custom y
  Server Verify no son candidatos de inventario.

Para el detalle de cuenta, los únicos candidatos de estado de rotación no
secreto son `secretManagement.automaticManagementEnabled`, `status`,
`lastModifiedTime`, `lastReconciledTime` y `lastVerifiedTime`. Quedan excluidos
el secreto, `platformAccountProperties`, `manualManagementReason` y el payload
completo. La implementación debe validar los nombres y formato con respuestas
anonimizadas del tenant antes de una migración.

## Métricas de rotación de credenciales: bloqueadas por decisión

`GET /api/analytics/freshness` (`repositories/analytics.py::get_inventory_freshness`)
reporta únicamente:

- antigüedad de `safes.last_modification_time` en tramos (30 d / 90 d / 1 año / +1 año / sin dato);
- Safes activas sin cuentas activas;
- cuentas activas, retiradas y "sin ver" hace más de 30 días (`last_seen_at`).

Es una vista de **frescura operativa**, no de rotación de credenciales, y la UI
debe rotularla así.

Un KPI real de rotación (`% rotadas en 90 días`, gestión automática
deshabilitada, antigüedad de la última verificación) exige una decisión de
producto para persistir una lista blanca angosta de timestamps **no secretos**
de `secretManagement` (p. ej. `lastModifiedTime`, `lastReconciledTime`,
`lastVerifiedTime`). Eso implica: nueva migración, mapeo en la ingesta de
cuentas, una nota en este archivo y un test de regresión. Hasta esa decisión,
no se persiste ningún atributo de `secretManagement` y no se debe inferir
rotación de otros campos.
