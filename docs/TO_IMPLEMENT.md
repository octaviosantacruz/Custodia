# Por implementar en DS Hub

**Última revisión:** 2026-09-12 (incluye revisión de seguridad tipo pentest — `PENTEST-001`/`002`/`004`/`005`/`006`/`007`/`011` cerrados y `PENTEST-003`/`008`/`009`/`010`/`012` pendientes)
**Código revisado hasta:** `cad1987`
**Propósito:** fuente central y actualizable del trabajo pendiente del proyecto.
El inventario de trabajo cerrado está en [`IMPLEMENTED.md`](IMPLEMENTED.md).

Los documentos de arquitectura, producto, operaciones y referencia conservan
el contexto y la evidencia. Este archivo concentra el estado, el orden y el
criterio de cierre. Si otro documento contradice el estado de una tarea, este
tracker tiene precedencia y debe actualizarse junto con el cambio.

## Cómo mantener este documento

Estados:

- **Listo**: puede implementarse con contratos y datos actuales.
- **Verificar**: existe un reporte previo, pero el código cambió; reproducir
  antes de modificar.
- **Bloqueado**: requiere contrato, payload, permiso o decisión todavía no
  confirmado.
- **Externo**: depende de un equipo o plataforma fuera del repositorio.
- **En curso**: implementación iniciada y aún no cumple todos sus criterios.

Al comenzar una tarea, cambiarla a **En curso** y enlazar rama/issue si existe.
Al terminarla, retirarla de las tablas activas y mover su evidencia a
[`IMPLEMENTED.md`](IMPLEMENTED.md), con commit y fecha. No duplicar el mismo
pendiente en varios roadmaps.

## Orden recomendado

1. Pulir inventario operativo con datos ya persistidos: nomenclatura de Safes
   cuando soporte entregue el mapeo, y densidad/claridad de tablas.
2. Desacoplar el frontend y el motor de dashboard (`MOD-001`–`MOD-005`) cuando
   no haya un cambio de producto en curso: esos archivos concentran conflictos.
3. Ampliar Postura o agregar nuevas fuentes solo cuando exista evidencia
   contractual y un caso de decisión concreto.

## Auditoría de seguridad — revisión tipo pentest (2026-09-11)

Revisión de código (sin modificar archivos ni generar commits) orientada a
qué reportaría un pentest formal. Verificado con HTTP real contra la app
(`httpx.AsyncClient`/ASGI), no sólo lectura de código. `npm audit` (raíz y
frontend) y `pip-audit` (backend): 0 vulnerabilidades de dependencias.
**No presentar el proyecto como "sin vulnerabilidades" todavía.**

### P0 — bloqueantes antes de un pentest o de producción

| ID | Estado | Hallazgo validado | Próxima acción | Criterio de cierre |
|---|---|---|---|---|
| `PENTEST-003` | Riesgo operativo aceptado transitoriamente — secreto de sesión endurecido en código (2026-09-12) | MFA, HTTPS forzado, cookies `Secure`, rotación de `APP_WRITE_TOKEN`/`AUTH_BOOTSTRAP_TOKEN` y aislamiento de Postgres/puerto 8000 no se pueden verificar sólo leyendo el repositorio. La condición crítica de secreto de sesión débil sí quedó mitigada: `AppSettings` rechaza valores menores a 32 bytes y placeholders conocidos; `.env.example` ya no proporciona un valor copiable. **Decisión del responsable de producto:** MFA y HTTPS/HSTS quedan delegados a Okta Access Enterprise (OIDC) una vez que esté en producción; hoy el ambiente todavía usa `AUTH_MODE=hybrid`, riesgo aceptado durante la migración. | No implementar MFA/HTTPS propios en DS Hub. Confirmar el paso a `AUTH_MODE=oidc` puro y mantener el checklist operativo: secreto aleatorio real, rotación de tokens técnicos, Postgres y `:8000` no expuestos. Rotar `SESSION_SECRET` al desplegar este hardening si existe cualquier duda sobre su valor actual; esto invalida sesiones existentes. | Reevaluar cuando Okta Access Enterprise pase a producción y se pueda retirar el modo híbrido; hasta entonces queda como riesgo operativo aceptado. |

### P1 — corregir antes del pentest

| ID | Estado | Hallazgo validado | Próxima acción | Criterio de cierre |
|---|---|---|---|---|

### P2 — antes de exponer el ambiente a terceros

| ID | Estado | Hallazgo validado | Próxima acción | Criterio de cierre |
|---|---|---|---|---|

### P3 — hardening de menor prioridad

| ID | Estado | Hallazgo validado | Próxima acción | Criterio de cierre |
|---|---|---|---|---|

### Controles verificados como correctos (no requieren acción)

SQL injection (parametrizado), XSS directo (sin `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write`), tokens en `localStorage` (no se usa), secretos PAM persistidos o devueltos por la API (no ocurre), inyección de fórmulas CSV (`_csv_cell()` neutraliza `=`, `+`, `-`, `@`), CORS wildcard (no existe), comparación insegura del token técnico (usa `hmac.compare_digest`), session fixation en login (la sesión se limpia antes de crear la nueva), vulnerabilidades conocidas en dependencias (`npm audit`/`pip-audit`: 0).

**Antes de un pentest formal:** `PENTEST-001`, `002`, `004`, `005`, `006`, `007` y `011` están cerrados (ver `IMPLEMENTED.md`). Evaluar a continuación `PENTEST-008`, `009`, `010` y `012` (P1/P2/P3). `PENTEST-003` queda fuera de este orden: el componente crítico del secreto de sesión se endureció, pero los controles restantes son un riesgo operativo aceptado transitoriamente hasta que Okta Access Enterprise esté en producción.

## Observaciones de auditoría técnica (2026-09-11)

Este bloque convierte el informe de auditoría de solo lectura en trabajo
trazable. Los puntos están contrastados contra el código actual. **Verificar**
no significa que exista una vulnerabilidad: indica que falta una regresión,
una medición o una búsqueda exhaustiva antes de modificarlo.

### Seguridad y contrato de API

| ID | Estado | Hallazgo validado | Próxima acción | Criterio de cierre |
|---|---|---|---|---|
| `AUD-API-002` | Backlog | La mayoría de endpoints no declara `response_model`; la documentación OpenAPI queda sin forma de respuesta, pero no hay una regresión funcional inmediata. | Aplicar modelos a endpoints nuevos o modificados, empezando por auth, permisos, mutaciones y catálogos; no hacer un refactor masivo sin compatibilidad. | Los endpoints priorizados publican schemas estables y tests de compatibilidad. |

### Rendimiento y frontend

| ID | Estado | Hallazgo validado | Próxima acción | Criterio de cierre |
|---|---|---|---|---|
| `AUD-PERF-001` | Listo | `services/cmdb_persistence.py` hace un `execute` por objeto y por relación; `ingestion_persistence.py` hace un `execute` por miembro dentro de cada Safe. | Medir una corrida representativa y diseñar inserciones por lote (`executemany`, multi-row o COPY) manteniendo transacción y reconciliación. | La misma corrida usa menos round-trips y conserva conteos, conflictos y estados stale. |
| `AUD-PERF-003` | Medido, fix mayor de lo esperado | Medido con 150 Safes simuladas + un contador de renders temporal (no comiteado): cada keystroke en el buscador re-renderiza las 150 filas (≈9 renders por fila en una tanda de 7 caracteres, ~2.2s de trabajo total). Se implementó `React.memo` en `SafeTableRow` + callbacks estabilizados con `useCallback` en `safe-table.tsx`, pero la re-medición dio el mismo resultado exacto (1350 renders): la causa real no es `safe-table.tsx` sino que `useSafeTableConfig` (`hooks/use-safe-table-config.ts`) reconstruye *todo* el objeto `tableProps` — incluidos `onSelect`, `onQuickUpdate` y el resto de los callbacks — en cada render de quien la llama, y a su vez `selectSafe` (`use-safe-detail.ts`), `quickUpdate`/`saveAssignment` (`use-safe-mutations.ts`) tampoco están envueltos en `useCallback`. Arreglarlo de verdad requiere estabilizar toda esa cadena de hooks, no sólo la tabla — un cambio más grande y cruzado de lo que este ítem preveía, sobre el componente más denso y crítico de la app. Revertido el intento parcial en `safe-table.tsx`/`safe-table-row.tsx` (no comiteado) porque no lograba ninguna mejora medible y sí agregaba complejidad. | Encarar como una tarea propia: estabilizar `use-safe-detail.ts`, `use-safe-mutations.ts` y `use-safe-table-config.ts` con `useCallback`/`useMemo` de punta a punta, volver a medir con el mismo método antes de dar por cerrado, y recién ahí memoizar `SafeTableRow`. | Se documenta una mejora de render medida (no sólo un cambio aplicado a ciegas) sin cambiar selección, expansión ni edición. |

El informe no encontró TODO/FIXME antiguos, tests omitidos ni dependencias npm/pip
sin uso; no se agregan como tareas.

## P0 — confiabilidad y validaciones pendientes

| ID | Estado | Trabajo | Próxima acción | Criterio de cierre | Fuente |
|---|---|---|---|---|---|
| `INT-002` | Bloqueado | Confirmar paginación, `429`, `Retry-After` y espacio de IDs de SIA | Paginación implementada 2026-09-10. Probe 2026-09-11: 40 requests secuenciales (~2.5 req/s, 16s) devolvieron `200` sin `429` ni headers `Retry-After`/`X-RateLimit-*` — inconcluso, no confirma el umbral real; una ráfaga mayor requiere autorización explícita adicional (test de stress sobre producción). Pendiente: umbral real de throttling y espacio de IDs de grupos/roles | Cliente y tests reflejan el contrato real; no se crean relaciones por nombre | [contratos](architecture/integration-contracts.md) |

## Candidatos priorizados con contrato documentado

Estos endpoints están documentados por CyberArk. Antes de persistir o mostrar
datos se valida con un probe mínimo del tenant, los permisos efectivos y la
allowlist indicada; la documentación pública no sustituye esa validación.

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `SYS-001` | Listo | Salud de componentes PAM: resumen y detalle de Portal, CPM, PSM/SSH y AIM | — | Probe 2026-09-10: `GET /API/ComponentsMonitoringSummary` → `{Components:[{ComponentID,ComponentName,ComponentTotalCount,ConnectedComponentCount,Description,ComponentSpecificStat}], Vaults:[{IP,IsLoggedOn,Role}]}` (3 componentes: PVWA, CPM, SessionManagement). `GET /API/ComponentsMonitoringDetails/{ComponentID}/` agrega `ComponentIP`, `ComponentUserName`, `ComponentVersion`, `IsLoggedOn`, `LastLogonDate` por instancia. Persistir sólo `ComponentID/Name/TotalCount/ConnectedCount` del summary y `ComponentVersion/IsLoggedOn/LastLogonDate` del detalle; excluir `ComponentIP`, `ComponentUserName` y `Vaults[].IP` |
| `PSM-001` | Listo | Catálogo técnico de servidores PSM y conectores de sesión | — | Probe 2026-09-10: `GET /API/PSM/Servers` → `{PSMServers:[{ID,Name,Address}], Total}`; `GET /API/PSM/Connectors` → `{PSMConnectors:[{ID,DisplayName}], Total}`. `PSMServerId` de `PLAT-002` cruza contra `PSMServers[].ID` |
| `CPM-001` | Bloqueado | Account Management Health sin secretos | Aprobar allowlist: `automaticManagementEnabled`, `status`, `lastModifiedTime`, `lastReconciledTime`, `lastVerifiedTime`; luego probar 3–5 cuentas con estados distintos | Migración aditiva, mapeo y tests; nunca se persisten secreto, `platformAccountProperties`, `manualManagementReason` ni payload completo |
| `CA-AUD-001` | Bloqueado | Auditoría de CyberArk por cuenta | Aprobar allowlist y retención para `Alert`, `Date`, `Action`, `ActionID` y `ClientID`; excluir por defecto `User`, `MoreInfo` y `Reason`; luego probar cuentas representativas | Fuente append-only de sólo lectura, paginada si el tenant lo requiere, separada de `AUD-001` y sin textos potencialmente sensibles |
| `SESS-001` | Bloqueado | Sesiones activas: resumen operativo o detalle restringido | Definir pregunta operativa, permiso, retención, timezone y qué campos personales/infraestructura se excluyen de `LiveSessions` | Métrica o vista de sólo lectura con denominador y actualización visible; nunca almacena recordings ni `RawProperties` sin decisión explícita |
| `PLAT-002` | Listo | Política CPM/workflow por plataforma destino | — | Probe 2026-09-10: `GET /API/platforms/targets/` → `{Platforms:[{ID,Name,Active,AllowedSafes,CredentialsManagementPolicy:{Change,Reconcile,Verification,SecretUpdateConfiguration},PrivilegedSessionManagement:{PSMServerId,PSMServerName},PrivilegedAccessWorkflows:{...}}], Total}` (73 plataformas en el tenant). **Corrección post-implementación:** `ID`/`Name` de este catálogo no siempre coinciden con el `PlatformID` de `/API/Platforms` (sólo ~36/73 por nombre); se modeló como `object_type='platform_target'` independiente en vez de fusionarlo por join de nombre |
| `PLAT-003` | Listo | Catálogos de plataformas dependent / group / rotational | — | Probe 2026-09-10: `GET /API/platforms/dependents/` → `{Platforms:[{ID,Name,LinkedAccounts,NumberOfLinkedTargetPlatforms,...}],Total}` (12); `.../groups/` → `{Platforms:[{ID,Name,Active,PlatformID}],Total}` (2); `.../rotationalGroups/` → mismo shape, 0 resultados en este tenant (endpoint válido, sin datos) |
| `SAFE-PLAT-001` | Bloqueado | Safes asociadas a una plataforma | Probe 2026-09-10 confirmó `GET /API/Platforms/{PlatformID}/Safes/` → `{count, value:[safeName,...]}`, pero al probar 5 plataformas distintas todas devolvieron el mismo `count` (el total de Safes del tenant): el endpoint no filtra por plataforma en este tenant, no sirve como drill plataforma→Safes. No se ingiere ninguna relación desde este endpoint (`pam_source.py` documenta el hallazgo) | Requiere reabrir sólo si CyberArk confirma un comportamiento de filtrado distinto (versión/config del tenant) o un endpoint alternativo |
| `PAM-USR-001` | Listo | Estado operativo de usuarios PAM (`enabled`, `suspended`, `componentUser`, `vaultAuthorization`, grupos Vault) | — | Probe 2026-09-10: `GET /API/Users?ExtendedDetails=true` → por usuario `{id,username,source,userType,componentUser,enableUser,suspended,vaultAuthorization,groupsMembership,location,personalDetails,UUID}`. Confirma que `personalDetails` viaja en la respuesta y debe excluirse explícitamente en el mapeo, junto con cualquier email/teléfono anidado |
| `ONB-001` | Bloqueado | Reglas de onboarding automático | Probe 2026-09-10: `GET /API/AutomaticOnboardingRules/` responde `501 {"ErrorCode":"CAWS00001E","ErrorMessage":"Feature has been turned off"}` — deshabilitada en este tenant | Inventario de reglas con precedencia y `LastOnboardedTime`; revalidar sólo si el tenant habilita la funcionalidad |
| `REQ-001` | Bloqueado | Cola dual control de Privilege Cloud (incoming requests PAM, no Access Requests) | Confirmar GET de Incoming requests en el tenant, permiso y allowlist; excluir por defecto textos de motivo (`Reason`) | Cola operativa de sólo lectura; confirmar/rechazar queda fuera de DS Hub |
| `AIM-001` | Listo | Inventario AIM de aplicaciones | — | Probe 2026-09-10: `GET {PVWA}/WebServices/PIMServices.svc/Applications/` → `{application:[{AppID,Description,Disabled,ExpirationDate,Location,AccessPermittedFrom,AccessPermittedTo,AllowExtendedAuthenticationRestrictions,BusinessOwnerEmail,BusinessOwnerFName,BusinessOwnerLName,BusinessOwnerPhone}]}` (108 apps). `BusinessOwner*` viaja y debe excluirse; persistir sólo `AppID/Description/Disabled/ExpirationDate/Location` |
| `LDAP-001` | Bloqueado | Directorios y mappings LDAP del Vault | Probe 2026-09-10: `GET /API/Configuration/LDAP/Directories/` responde `500 {"ErrorCode":"ITATS170E","ErrorMessage":"Failed to execute the transaction."}` en este tenant | Sin evidencia de que el endpoint esté soportado en esta instancia Privilege Cloud SaaS; no reintentar sin confirmar con soporte de CyberArk |
| `ACC-GRP-001` | Bloqueado | Grupos de cuentas (reconcile/change conjunto) | Probe exhaustivo 2026-09-11 contra las **436 Safes reales del tenant** (no una muestra): `GET /API/AccountGroups?Safe={safeName}` responde `200` con array para las 436, y ninguna tiene un grupo configurado. La corrida anterior (25 Safes, 2026-09-10) ya lo sugería; esta corrida cubre el 100% del inventario y confirma que el tenant simplemente no usa esta feature, no que la muestra fue mala suerte. No reabrir sin un tenant/entorno distinto que sí tenga grupos poblados | Falta un ejemplo poblado para confirmar las keys de cada grupo antes de mapear |
| `LINK-001` | Bloqueado | Cuentas vinculadas (logon / reconcile) | Probe 2026-09-10: `GET /API/Accounts/{id}/LinkedAccounts/{logon,reconcile}` (y variantes de casing/slash) responde `404` de IIS en este tenant | Sin evidencia de que la ruta exista en esta instancia Privilege Cloud Standard; no reintentar sin confirmar con soporte de CyberArk |
| `DEP-ACC-001` | Bloqueado | Dependientes CPM (servicios/tareas Windows) | Probe 2026-09-10: `GET /API/accounts/{id}/account-dependents/` (y variantes) responde `404` de IIS en este tenant | Misma situación que `LINK-001`: confirmar con soporte de CyberArk antes de reintentar |

## P2 — ampliaciones que requieren contrato de CyberArk

| ID | Estado | Trabajo | Validación previa | Criterio de cierre | Fuente |
|---|---|---|---|---|---|
| `CONN-002` | Bloqueado | Inventario manual de connectors PSM/SIA y su capacidad operativa | Revisado 2026-09-11: no hay ningún contrato de Connector Manager configurado en este repo (sin `CA_CONNECTOR_MANAGER_*`, sin cliente, sin probe realizado) y el propio alcance descrito ("inventario **manual**") implica datos cargados a mano en DS Hub, no sincronizados desde una API de CyberArk — eso requiere antes una decisión de producto que no puede inferirse de este pedido: qué campos operativos se cargan (¿sólo notas de texto? ¿capacidad estimada? ¿quién la carga?), quién es el dueño del dato, y si alguna vez se conecta a una fuente real de Connector Manager o queda 100% manual. Sin esa definición, cualquier esquema que se implemente ahora sería una apuesta de diseño, no una implementación confirmada | Migración aditiva y workspace separado sólo después de esa decisión; CPU/RAM nunca se presentan como dato de CyberArk ni como telemetría | Pendiente de decisión de producto |
| `SIA-001` | Verificar | Workspace **Recursos SIA** conectado a Cadenas, separado de PAM | La precondición original ("estabilizar primero políticas, paginación y rate limits; confirmar catálogo de targets, workspaces y conectores") ya está cumplida: `SIA-POL-001` (paginación), `SIA-CONN-001`, `SIA-RES-001` y `SIA-STRONG-001` están todos `Hecho`, con workspaces propios (`/pam/sia`, `/pam/sia/connectors`, `/pam/sia/resources`, `/pam/sia/database-accounts`), aislados por `source_system = 'sia'` y sin mezclar objetos PAM por nombre. Lo único no resuelto es el "segundo botón propio" que describe este ticket: hoy SIA vive agrupado dentro del dominio `pam` (categoría `identity_sia` del selector), no como un dominio de nivel superior separado (como `admin`/`pam`/`dlp`/`dspm` en `domains.ts`). Promover SIA a dominio propio es un cambio de arquitectura de navegación (nuevo `Domain`, permisos `domain:sia`, migración) que no se hizo sin una decisión explícita sobre si corresponde ahora o si la agrupación actual ya cumple el objetivo de aislamiento | Segundo botón propio: navegación SIA aislada con pestañas Recursos, Conectores y Políticas; nunca mezcla objetos PAM por nombre |
| `SIA-DIAG-001` | Bloqueado | Diagnóstico de sesiones SIA (errores de usuario/sistema, warnings y sesiones) | Búsqueda 2026-09-11 en la documentación pública de SIA (`secure-infra-access`, todas sus specs) no encontró ningún endpoint de diagnóstico o sesiones — sólo Connectors, HTTPS Relays, VM infrastructure, DB Strong Accounts, Settings, SSH/MFA keys. Reintentado 2026-09-11 (segunda pasada): se revisó de nuevo el índice de documentación pública buscando términos alternativos (session/diagnos/audit/monitor/log); el único hit (`catalog-reporting`) es un feature flag del portal de documentación, no una API. Puede vivir bajo Audit and Reports (`AUD-EXT-001`) en vez de SIA; no reabrir sin una fuente pública o un probe que confirme el endpoint | Resumen por estado y ventana de tiempo; el detalle excluye usuario, target/IP, Session ID, texto libre y recordings salvo decisión explícita |
| `SIA-POL-001` | Verificar | Inventario de recurring access policies SIA | Paginación real ya no bloquea (ver `INT-002`, 2026-09-10). Probe de throttling escalado 2026-09-11: 60 requests **concurrentes** (no secuenciales, ~4.5 req/s sostenido) a `/api/access-policies` → 200 en las 60, sin ningún header `Retry-After`/`X-RateLimit-*`, sin `429`. Sigue sin confirmar el límite real: una ráfaga mayor (cientos de requests o paralelismo más alto) ya se acerca a un test de stress contra producción y requiere autorización explícita adicional antes de intentarse, más allá de lo ya cubierto aquí | Pestaña Políticas con tipo de target, plataforma y reglas; sin crear/editar políticas desde DS Hub |
| `REL-001` | Bloqueado | Relaciones normalizadas entre Identity, SIA y PAM | Demostrar que los IDs cruzan de forma estable. Investigado 2026-09-11 contra datos reales ya sincronizados: los `granted_roles`/`granted_groups` de `access_policy` (SIA) coinciden por **nombre** con roles reales de Identity Administration (2/2 nombres distintos observados en todo el tenant cruzan exactos), pero el objeto crudo de SIA (`userAccessRules[].userData.roles[]`) sí expone un campo `sourceId` en su schema — se probó explícitamente y **ambas** entradas reales lo devuelven `null` (junto con `source`), así que no hay un ID utilizable detrás del nombre, no es que el campo no exista. Ningún otro par de fuentes (SIA↔PAM más allá del join sancionado por IP literal, PAM↔Identity más allá del puente por UUID ya implementado) tiene un ID compartido observado | Las coincidencias por nombre dejan de ser referencias solo cuando existe evidencia de ID | [contratos](architecture/integration-contracts.md) |
| `AIM-002` | Bloqueado | Métodos de autenticación AIM (`AuthType`/`AuthValue`) | Decisión de privacidad ya tomada (si se usa: allowlist `AuthType`/`authID`, nunca `AuthValue`), pero probado 2026-09-11 contra **las 108 aplicaciones AIM reales** (`GET /WebServices/PIMServices.svc/Applications/{AppID}/Authentications/`): **0 de 108** tienen algún método de autenticación configurado. No hay un solo objeto real para confirmar el shape (`AuthType`/`authID` fuera de la doc pública) antes de mapear — implementar contra cero ejemplos poblados repetiría el error que el proyecto evita en todos los demás catálogos (mapear a ciegas desde la doc pública sin confirmar contra el tenant). No reabrir sin al menos una aplicación con autenticación configurada | Si se aprueba, allowlist de `AuthType` y `authID` sin `AuthValue` | [contratos](architecture/integration-contracts.md) |
| `REC-001` | Bloqueado | Metadatos de recordings PSM (sin reproducción) | Misma decisión de privacidad/RBAC/retención que `SESS-001`; `GET /API/recordings` incluye User, IPs, RiskScore, IncidentDetails | Nunca `Play recording` ni archivos; si entra, allowlist de SessionID/tiempos/protocolo/plataforma | [contratos](architecture/integration-contracts.md) |
| `PAM-USR-002` | Bloqueado | Detalle PAM por usuario (`GET /API/Users/{id}`: last login, emails, teléfonos, dirección) | Decisión explícita de PII; el detalle documenta `internet`, `phones`, `businessAddress` y `personalDetails` | Fuera de inventario; `PAM-USR-001` cubre el estado sin PII | [contratos](architecture/integration-contracts.md) |
| `ACC-FAIL-001` | Bloqueado | Cuentas con fallo de política/CPM vía `savedFilter` | Depende de `CPM-001`; `GET /API/Accounts?savedFilter=` documenta `PolicyFailures`, `FailedChange`, `FailedVerify`, `FailedReconcile`, `ScheduledFor*` | Hallazgos con denominador y filtro al inventario; no secretos ni `platformAccountProperties` | [contratos](architecture/integration-contracts.md) |
| `ACCESS-001` | Listo | Catálogo transversal de assets accesibles en Access space | — | Probe 2026-09-11 (dos rondas): `GET https://{tenant}-userportal.cyberark.cloud/api/assets` (reusa el token OAuth `oauth2/platformtoken` ya compartido con PVWA/SIA) → `200 {assets:[{accessMethod,address,assetCategory,assetId,assetType,connectionComponents,customProperties,fileCategories,isFavorite,platformId,platformSubtype,platformType,protocol,username,workflowStatus}], diagnostics, nextToken, size}` (7 assets en el tenant). Shape interno: `customProperties = {port, logon_domain}`, `connectionComponents` es `list[str]` (nombres de conector, mismo tipo de dato que `PSM-001`), `fileCategories` casi siempre `{}`, salvo un caso con `{LogonDomain: str}`. Persistir `assetId/assetType/assetCategory/platformType/platformSubtype/protocol/accessMethod/workflowStatus/isFavorite/connectionComponents`; excluir `address`, `username`, `customProperties.logon_domain` y `fileCategories.LogonDomain` (dato de dominio AD, mismo criterio que host/infra). `platformId` **sí** cruza con el `PlatformID` de PAM: los 2 valores distintos observados en los 7 assets coinciden exactamente con `PlatformID` ya ingerido (muestra chica, a diferencia de `PLAT-002` donde la mayoría no coincidía); crear la relación sólo cuando haya match exacto, sin asumir para IDs no vistos | Vista de activos con método de acceso, dual control/exclusive access y diagnóstico; no consulta `POST Get Secret` ni crea un join por nombre sin evidencia de ID compartido | Access space (licenciado) |
| `RISK-001` | Bloqueado | Postura de riesgo de CyberArk junto a los hallazgos locales | Probado contra el tenant real 2026-09-11: **host confirmado** — `https://{tenant}.compass.cyberark.cloud` (patrón documentado antes sin confirmar) responde con un JSON de error estructurado (no un 404/timeout de host inexistente) reusando el mismo token OAuth ya autorizado para SIA/PVWA. Los 5 endpoints probados (`/risks/summary`, `/risks/findings`, `/risks/risk-types`, `/recommendations`, `/remediations`) devuelven **401** consistentemente; la primera respuesta observada incluyó una `description` mencionando un feature flag deshabilitado (mismo patrón que `ONB-001`/`LDAP-001`: la feature/módulo no está habilitado para este usuario de servicio, no un error de credenciales). Bloqueado en un punto distinto al anterior: ya no es "host desconocido", es "módulo Detect and Respond sin la autorización/licencia habilitada para este client id" — requiere que alguien con acceso al tenant confirme si el módulo está licenciado y, si lo está, otorgue el scope/rol correspondiente al usuario de servicio antes de reintentar | Workspace de sólo lectura con fuente explícita, severidad y drill-down; el estado local de hallazgos no se sobrescribe ni se hacen snooze/remediaciones remotas | Detect and Respond (licenciado) |
| `AUD-EXT-001` | Bloqueado | Sesiones históricas y eventos de plataforma desde Audit and Reports | Definir RBAC, privacidad, retención y allowlist antes de probar `https://{tenant}.sessionmonitoring.cyberark.cloud/api/sessions` o la integración SIEM | Timeline/filtros de actividad con IDs, tiempos, protocolo, estado y códigos; excluir usuario, target, source, recordings y textos libres por defecto | Audit and Reports (licenciado) |

## Barrido REST Privilege Cloud Standard (2026-09-10)

Fuente: árbol oficial
[REST APIs](https://docs.cyberark.com/privilege-cloud-standard/latest/en/content/webservices/implementing%20privileged%20account%20security%20web%20services.htm)
(`PasswordVault/API` Gen2 y `PasswordVault/WebServices` Gen1). No se inventaron
endpoints de SIA ni de Identity Administration a partir de este árbol.

**Ya cubierto por DS Hub (no reabrir como feature):** Get all Safes, Get Safe
details, Search for a Safe, Get all Safe members, Get accounts (inventario
delgado), Get platforms (mapeo `general` + PSM), Get users / Get groups /
Get group details (objetos PAM), throttling `429` en transporte PAM.

**Descartado a propósito (no entra al tracker como implementación):**

- Mutaciones: Add/Update/Delete Safe, member, user, group, account, platform
  (activate/deactivate/duplicate/import/export), onboarding rules, AIM add/delete.
- Secretos y material criptográfico: Get secret versions, Reset user password,
  Generate/Delete MFA caching SSH keys, `platformAccountProperties`,
  `manualManagementReason`, payloads completos de cuenta.
- Ticketing custom (import / export logs): no es inventario CMDB.
- Server Verify / Logo / Server: conectividad y branding, no workspace.
- Play recording y Session actions (terminate/suspend): fuera de un CMDB de lectura.
- Usage examples y Create extensions.

**Hallazgo transversal documentado:** la REST PAM declara throttling `429`; el
cliente PAM ya reintenta. SIA sigue en `INT-002`. `Features.CredentialRotation`
en Verify no autoriza persistir `secretManagement`.

## Alcance de licencia del tenant (2026-09-10)

Confirmado en el launcher de CyberArk (Spaces / Services). **Solo estos
productos entran al backlog.** El hub [api-docs.cyberark.com](https://api-docs.cyberark.com/)
lista muchos más; si el Space o Service no aparece abajo, no se documenta como
candidato ni se implementa.

**Spaces:** Access · Manage · Detect and Respond · Audit and Reports · Setup

**Services:** Flows · Identity Administration · Privilege Cloud · Secure
Infrastructure Access

## Catálogo de fuentes API (solo lo licenciado)

Este índice sirve para futuras iteraciones. **No habilita integraciones por sí
solo**: cada fuente requiere tenant URL aprobada, OAuth/rol efectivo, probe
anonimizado, allowlist y pruebas. DS Hub centraliza visibilidad autorizada;
no reemplaza la licencia ni los controles de CyberArk; no solicita ni
conserva secretos, tokens, claves, recordings o payloads completos.

| Dominio | Fuente oficial | Qué aporta al CMDB / dónde profundizar | Límite vigente |
|---|---|---|---|
| Índice API | [CyberArk API docs](https://api-docs.cyberark.com/) | Mapa general y auth/rate limit. **Filtrar** por la licencia de arriba; ignorar tarjetas de productos no contratados | No tratar el hub como inventario de features del tenant |
| Access | [Access API](https://api-docs.cyberark.com/secure-access/docs/secure-access-api) | `GET /api/assets`: activos, protocolo, workspace y workflow; candidato `ACCESS-001` | Distinto de Access Requests. `POST Get Secret` prohibido |
| Manage / PAM | [Manage REST](https://docs.cyberark.com/manage/latest/en/content/automation/rest-apis.htm) y [Privilege Cloud REST](https://docs.cyberark.com/setup/latest/en/content/privilege-cloud/webservices/implementing%20privileged%20account%20security%20web%20services%20.htm) | Safes, cuentas, plataformas, CPM/PSM, discovery PAM, health; candidatos `SYS-*` a `DEP-ACC-*` | En Manage, usar sólo APIs de Privilege Cloud / Identity / SIA. Ignorar CDS, SCA y Secure AI agents de esa misma página |
| Identity Administration | [Identity APIs](https://api-docs.cyberark.com/identity-docs-api) | Complemento del SCIM ya ingestado (`ID-001`) | Contrato SCIM del repo manda; PII mínima; sin joins por nombre |
| SIA | [SIA developer](https://docs.cyberark.com/setup/latest/en/content/privileged-access/hometileslps/dpa-lp-tile6.htm) y [SIA API docs](https://api-docs.cyberark.com/secure-infra-access) | Policies, targets, connectors, settings; contrato actual `/api/access-policies` | Primero `INT-002`; no inventar endpoints ni unir por nombre/email |
| Detect and Respond | [Risk Management API](https://api-docs.cyberark.com/risk-management-api/docs/risk-management-api) | Summary, tipos, lista, progreso, recomendaciones y riesgo por entidad; `RISK-001` | Sólo GET; no snooze ni remediaciones remotas |
| Audit and Reports | [Developer reference](https://docs.cyberark.com/audit-and-reports/latest/en/content/hometileslps/lp-tile5.htm) | Session Monitoring `/api/sessions` y SIEM query/events; `AUD-EXT-001` | Nunca pedir ni guardar URLs/archivos de recordings |
| Setup | [API authentication ISPSS](https://docs.cyberark.com/setup/latest/en/content/ispss-deployment/ispss/ispss-api-authentication.htm) | Token del plano compartido; Connector Management si el rol existe (`CONN-002`) | No copiar tokens. CCE / Connect cloud environments no está en Services |
| Flows | Servicio visible en el launcher; no hay candidato CMDB todavía | Automatización, no inventario | No inventar endpoints ni tratar Flows como fuente de cobertura |

**Fuera de licencia (no reabrir, aunque aparezca en api-docs):** Access
Requests, Cloud Discovery Service, Secure Cloud Access, Secure AI Agents,
Secrets Hub, Secrets Manager SaaS, Workspace delegation, Remote Access
(producto aparte de Access space), Discovery Context GraphQL (secrets /
workloads / AI agents), BYOK. `REQ-001` (cola dual control de Privilege
Cloud) no es Access Requests y sigue en el tracker PAM.

## Evidencia de UI SIA observada (2026-09-10)

El tenant muestra: políticas recurrentes para VMs/Databases; recursos de base
de datos con servicio, método de autenticación, ubicación, strong account y
certificado; Strong accounts para VM/Database; y Session diagnostics con
conteos de errores y sesiones. Esta evidencia valida el **caso de uso**, no
contrata endpoints ni autoriza persistir campos. Los candidatos
`SIA-RES-001`, `SIA-CONN-001`, `SIA-STRONG-001`, `SIA-DIAG-001` y
`SIA-POL-001` son su desglose para evitar una vista SIA monolítica.

`DISC-001` (Pending discovered accounts PAM) baja a backlog diferido: no
priorizar sobre plataformas, PSM y recursos/conectores SIA.

## Operaciones y publicación

Sin pendientes activos. `DEP-001` y `DEP-002` (Cloudflare Tunnel/Access y
hostname productivo) quedaron cerrados por confirmación operativa el 2026-09-10.

## Arquitectura modular de despliegue

La dirección recomendada es modularizar por responsabilidad y contrato de
integración, no por herramienta comercial. `frontend`, `backend` y `migrate`
ya son separaciones útiles. Un conector de CyberArk PAM, SIA, Identity
Administration o Netskope sólo debería convertirse en un servicio Docker
independiente cuando necesite permisos de red distintos, ciclo de despliegue
propio, escalado independiente o aislamiento de fallos. Cada módulo debe
exponer un contrato interno mínimo, no compartir secretos por volumen y
persistir a través de la capa de repositorios definida por DS Hub.

| ID | Estado | Trabajo | Condición de entrada | Criterio de cierre |
|---|---|---|---|---|
| `MOD-001` | Bloqueado | Separar la ingesta por fuente (CyberArk, Netskope, BigID, etc.) en imágenes/servicios Docker propios, cada uno con su contrato interno mínimo y sus secretos, persistiendo por la capa de repositorios de DS Hub | Que una fuente concreta cumpla al menos uno de los criterios reales de corte: permisos de red distintos, ciclo de despliegue propio, escalado independiente o aislamiento de fallos. Antes de eso, mantener un solo backend y solo aislar los *entrypoints* de sync por fuente (ya parcial: `identity_admin_sync.py`, `sia_sync.py`) | Cada módulo se despliega y reinicia sin afectar a los demás; comparte esquema pero no secretos por volumen; el despliegue externo documentado en `docs/operations/deployment.md`; una caída de sync de una fuente no degrada las lecturas de otra | idea de sesión `1168724`; ver criterio arriba en esta sección |

## Backlog diferido: no priorizar todavía

Estas ideas pueden ser valiosas, pero hoy agregarían complejidad sin mejorar la
decisión diaria de un manager. Solo deben volver al roadmap cuando exista un
contrato de datos y una pregunta operativa concreta.

- Licencias: no inferir consumo desde usuarios, miembros o cuentas. El conteo
  de `safe_members` no es un KPI de asientos. La conciliación Standard vigente
  está en `docs/product/privilege-cloud-standard-seats.md` y se muestra como
  “Licencia Standard” en Cadenas → Usuarios PAM y en Identidades → Usuarios
  (este último sólo por UUID coincidente). No presentarla como facturación.
- Rotación de credenciales: no presentar frescura de inventario como rotación.
- CPU, RAM, disco, servicios o certificados: enlazar observabilidad existente;
  no crear un segundo inventario de hosts en DS Hub. `CONN-002` sigue bloqueado
  hasta acordar un caso de uso y una fuente para capacidad de connectors.
- Targets/workspaces/conectores SIA, Connector Health y Session Intelligence:
  esperar contrato, permisos, retención y caso de uso aprobado.
- Renombrado de Safes y traducción de nomenclatura: soporte va a entregar el
  mapeo de nombres. Al llegar, evaluar un nombre de display sobre
  `cyberark_safe_metadata` (sin tocar `safe_name` de CyberArk, para no romper
  joins por nombre) más una capa de nomenclatura reutilizable sobre
  `lib/format.ts` + `status-glossary.tsx`. No es una capa i18n completa.
- PDF, animaciones complejas y nuevos gráficos: priorizar primero filtros,
  denominadores, fecha de actualización y navegación al dato fuente.
- Orquestación remota desde DS Hub (idea, 2026-09-12): disparar acciones sobre
  el servidor destino de un PSM (ej. "actualizar Windows en el puerto tal")
  sin login manual, posiblemente vía un agente instalado en el endpoint.
  Es un dominio distinto al de un CMDB de solo lectura: requeriría agente en
  cada host, canal de control autenticado, cola/orquestador de jobs, RBAC de
  "quién puede ejecutar qué en qué máquina", logging de ejecución remota y
  modelo de amenaza propio (un agente que ejecuta comandos remotos es un
  vector de ataque mayor si se compromete el control plane). Antes de
  diseñar nada custom, revisar qué expone CyberArk PSM/SIA en materia de
  ejecución remota para reusar en vez de reinventar. No tocar sin decisión de
  producto explícita y sin tratarlo como una fase separada de "DS Hub Ops".

## Criterio simple para nuevas métricas

Una métrica nueva entra al producto solo si responde una pregunta de decisión,
tiene fuente verificable y permite abrir el inventario que la compone. Debe
mostrar como mínimo: valor, denominador, filtros aplicados, última actualización
y estado de dato (`confirmado`, `pendiente` o `no disponible`).

## Límites transversales

El detalle histórico de cierres se conserva en [IMPLEMENTED.md](IMPLEMENTED.md); esta lista sólo contiene trabajo pendiente o bloqueado.

- No almacenar secretos, tokens, credenciales ni payloads completos.
- Mantener PAM, Identity Administration y SIA separados por `source_system`.
- No inventar endpoints, relaciones, KPIs ni estados a partir de nombres.
- Toda lógica nueva necesita prueba focalizada y contratos anonimizados.
- Las migraciones aplicadas no se editan; los cambios de esquema son aditivos.
- `npm run verify` debe pasar antes de cerrar una tarea de implementación.
