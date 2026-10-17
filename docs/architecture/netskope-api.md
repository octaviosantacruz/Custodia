---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-06
---

# API de Netskope: superficie, cobertura y reglas

**Fuente:** exportación completa de la documentación de la API del tenant (2026-10-04): **1.302 operaciones en 49 familias**: GET 612, POST 336, PUT 101, PATCH 117, DELETE 136. La lista cruda se conserva localmente en `docs/history/FULL_API_NSK_LIST.MD` (ignorada por Git; se vuelve a exportar desde `apidocs` del tenant si hace falta).
**Estado:** referencia, **no un backlog**: el trabajo vive en [`TO_IMPLEMENT.md`](../tracking/TO_IMPLEMENT.md) y los contratos aprobados en [`integration-contracts.md`](integration-contracts.md). Que una ruta figure aquí no la habilita.

## Qué es consultable

- **GET (612):** las 611 rutas del catálogo anterior más `marketplace/agent-entitlements/employee-counts` (sin triage). Estado por ruta: ver las marcas y la tabla por familia.
- **Consultas por POST (69):** 4 ya usadas (`users/getusers`, `users/getgroups`, ADEM `device/getlist` y `device/getdetails`) y 65 candidatas por heurística de nombre (último segmento `get*`, `/query/`, `criteria/schema`, `estimate`). Es una aproximación: `nsiq/urllookup` (envía URLs a Netskope), `atp/*` (suben archivos), `dspm/.../startscan|abortscan`, `analysis/npa` y similares **no** se tratan como lectura aunque parezcan consultas. Cada candidata se revisa a mano antes de un probe.
- **Escritura, acción o despliegue (621):** crear, reemplazar, borrar, desplegar, revertir, subir, escanear, rotar o resetear. Fuera de alcance: Custodia es de sólo lectura hacia Netskope.

## Reglas no negociables antes de promover una tarea

1. **Ninguna ruta se habilita por existir.** Requiere licencia/feature flag del tenant, permiso/scope efectivo, probe read-only anonimizado y allowlist de campos.
2. **Nada se persiste sin contrato aprobado.** El probe observa; no autoriza persistencia. La evidencia de shape se documenta en [`integration-contracts.md`](integration-contracts.md).
3. **Nunca persistir ni mostrar:** contenido de archivos/emails/adjuntos/chat/calendario, forense, screenshots, pcap, artefactos, malware, diccionarios descargables, certificados, tokens/JWT/OTP/claves, ubicación exacta, IPs/hostnames, filas por usuario ni textos libres.
4. **DLP individual sólo con la allowlist de `NSK-DLP-001`**: conteos agregados primero y drill-down a una alerta mínima (ID opaco, tiempo UTC, estado, severidad, política, acción e ID opaco de usuario); nunca archivo, contenido, hash, URL, IP ni email del evento.
5. **Sólo lectura.** Ninguna ruta de este catálogo habilita escritura remota, acciones de prueba ni cambios de configuración en Netskope.
6. **Sin duplicar pendientes:** una ruta marcada `registrado` ya tiene tarea; se amplía esa tarea, no se crea otra. Un candidato nuevo se registra en `TO_IMPLEMENT.md` con ID `NSK-*` antes de escribir código.
7. **Los probes versionados son la única vía de inspección:** [`scripts/probe_netskope_api.sh`](../../scripts/probe_netskope_api.sh) (allowlist) y los probes DLP. Extender la allowlist es parte de la tarea, no un atajo.

## Marcas de este catálogo

| Marca | Significado |
|---|---|
| `usado` | El cliente/sincronización actual ya la consume (con su variable de entorno). |
| `probado` | Ya consultada en el tenant; el resultado está en `integration-contracts.md`. |
| `registrado` | Ya existe una tarea `NSK-*` en el tracker; no duplicar. |
| `candidato` | Superficie nueva: requiere probe, permiso/licencia, allowlist y decisión. |
| `sensible` | Candidata con riesgo de privacidad/alcance: requiere decisión explícita antes de cualquier diseño. |
| `excluido` | Prohibida por diseño (contenido/forense/credenciales/descargas) o fuera del alcance del CMDB. |
| `deprecado` | La propia ruta se declara deprecada; no promover sin un motivo concreto. |

## Cobertura actual de Custodia (rutas usadas o probadas)

| Ruta | Estado |
|---|---|
| `/api/v2/events/dataexport/alerts/dlp` | configurado, no consumido · `NETSKOPE_DLP_ALERTS_PATH` · `NSK-ALR-001` (agregados) |
| `/api/v2/events/datasearch/alert` | usado (count-only) · `NETSKOPE_ALERT_PATH` · registrado `NSK-ALR-001` |
| `/api/v2/events/datasearch/clientstatus` | usado · `NETSKOPE_DEVICE_STATUS_PATH` (sync de dispositivos) |
| `/api/v2/users/counts` | usado · `NETSKOPE_USER_COUNTS_PATH` |
| `POST /api/v2/users/getusers` | usado · `NETSKOPE_USERS_PATH` (usuarios y, desde `NSK-GRP-001`, `accounts[].parentGroups`) |
| `POST /api/v2/users/getgroups` | usado · `NETSKOPE_GROUPS_PATH` (`NSK-GRP-001`, opt-in) |
| `/api/v2/events/dataexport/events/incident` | usado · `NETSKOPE_DLP_INCIDENTS_PATH` (`NSK-DLP-001`, iterator) |
| `/api/v2/dem/config/sites` | usado · `NETSKOPE_DEM_SITES_PATH` (`NSK-DEM-INV-001`, opt-in) |
| `/api/v2/adem/poplist`, `POST /api/v2/adem/users/device/getlist`, `.../getdetails` | usado · Experiencia digital (consulta en vivo, sin persistir) |
| `/api/v2/scim/Groups`, `/api/v2/scim/Users` | probado 200 · `NSK-GRP-001` leyó grupos con `getgroups` |
| `/api/v2/devices/supportedos` | probado 200 · familia `NSK-CFG-001`/`NSK-DEV-001` |
| `/api/v2/events/data/audit` | probado 403 · registrado `NSK-AUD-001` |
| `/api/v2/events/datasearch/application` | probado 200 · registrado `NSK-APP-001` |
| `/api/v2/events/datasearch/incident` | probado 400 · `NSK-DLP-001` usa `dataexport/events/incident` |
| `/api/v2/events/datasearch/page` | probado 200 · registrado `NSK-WEB-001` |
| `/api/v2/infrastructure/lbrokers` | probado 403 · registrado `NSK-NPA-001` |
| `/api/v2/infrastructure/publishers` | probado 403 · registrado `NSK-NPA-001` |
| `/api/v2/infrastructure/publisherupgradeprofiles` | probado 403 · registrado `NSK-NPA-001` |
| `/api/v2/policy/npa/policygroups` | usado · `NETSKOPE_POLICY_GROUPS_PATH` (`NSK-POLICY-002`, opt-in; ver «Grupos de políticas») |
| `/api/v2/policy/npa/rules` | probado 403 · registrado `NSK-NPA-002` |
| `/api/v2/policy/urllist` | probado 200 el 2026-10-12 (antes 403): 23 listas con `id`, `name`, `data.type` (`exact`/`regex`), `data.urls`, `modify_by`, `modify_time`, `pending` · registrado `NSK-CFG-001` |
| `/api/v2/services/cci/app` | probado 200 (error funcional del servicio) · registrado `NSK-APP-001` |
| `/api/v2/steering/apps/private` | probado 403 · registrado `NSK-NPA-002` |

## Cómo promover un candidato

1. Elegir **una familia** y verificar licencia/feature flag con el dueño del tenant.
2. Confirmar el permiso/scope del token read-only para esa familia (sin pedir scopes de escritura).
3. Extender la allowlist de `scripts/probe_netskope_api.sh` y correrlo: registrar sólo status, forma, nombres/tipos de campos, conteos, paginación y headers de rate limit.
4. Documentar el contrato anonimizado en `integration-contracts.md` (allowlist de campos, exclusiones, paginación, límites).
5. Registrar la tarea en `TO_IMPLEMENT.md` con ID `NSK-*`, estado, validación previa y criterio de cierre; enlazar este documento como fuente.
6. Recién entonces implementar (cliente → mapping con allowlist → repositorio → ruta → UI), con tests de exclusión de campos.

## Por familia

Marcas de las rutas GET según el triage del 2026-09-26. «Escr.» agrupa PUT, PATCH y DELETE.

| Familia | GET | POST | Escr. | Marcas GET | Qué es y qué hacer |
|---|---:|---:|---:|---|---|
| `services` | 57 | 49 | 46 | 29 candidato, 13 sensible, 11 registrado, 3 excluido, 2 probado | Configuración de servicios: CCI ya registrado; bandwidth control, cloudtap y EDM/fingerprints son candidatos; certificados y descargas fuera. |
| `profiles` | 46 | 44 | 30 | 37 candidato, 9 registrado | Inventario de perfiles de configuración (red, DNS, destinos, categorías, service objects, listas): alto valor de postura; el contenido de listas se limita a nombre/ID/conteo. |
| `policy` | 40 | 34 | 30 | 23 registrado, 14 candidato, 6 probado | Políticas: NPA y URL list ya registradas; fastpath/internetaccess/domainfrontings son candidatos nuevos. |
| `nsbrowser` | 25 | 12 | 28 | 19 registrado, 5 excluido, 1 sensible | Enterprise Browser: familia `NSK-EB-001`; descargas, imágenes y plantillas de email quedan fuera. |
| `dspm` | 31 | 13 | 15 | 27 sensible, 4 excluido | Postura DSPM: alto valor y alta sensibilidad; requiere decisión de privacidad y allowlist antes de cualquier persistencia. |
| `dem` | 26 | 9 | 19 | 26 registrado | Familia ya registrada en el tracker (`NSK-DEM-*`); el probe read-only es el próximo paso (`NSK-DEM-PROBE-001`). |
| `events` | 42 | 3 | 3 | 26 sensible, 8 probado, 6 usado, 3 registrado, 3 candidato, 2 excluido, 1 configurado | Familia más grande: los caminos aprobados son `datasearch` count-only y la matriz de probes; los exports crudos requieren contrato separado. |
| `platform` | 24 | 8 | 14 | 11 candidato, 6 deprecado, 5 excluido, 2 registrado | Mixto: contratos, settings, IdP SSO y roles deprecados son candidatos; IPs de DNS resolver y MFA por usuario quedan fuera. |
| `ui` | 29 | 6 | 9 | 29 excluido | API interna de la UI de Netskope; no es la superficie de integración. Los exports PDF/CSV y las notificaciones quedan fuera del CMDB. |
| `steering` | 17 | 8 | 18 | 10 sensible, 4 registrado, 2 probado, 1 candidato, 1 excluido | Infra de steering (GRE/IPSec/Express Connect/private apps): sólo IDs/estado, sin IPs; tokens fuera. |
| `aig` | 16 | 7 | 13 | 12 registrado, 4 excluido | Inventario AI Gateway: proveedores, appliances, MCP servers, rate limits. Ya registrado como `NSK-AI-001`; tokens fuera. |
| `adem` | 4 | 30 | 0 | 2 sensible, 2 excluido | Experiencia de usuario agregada; las listas de IPs/usuarios individuales están excluidas. |
| `casbapi` | 25 | 5 | 3 | 12 excluido, 8 sensible, 4 registrado, 1 candidato | Next-Gen CASB: sólo configuración (perfiles eDiscovery) y dominios son candidatos; emails/archivos/chat/usuarios están excluidos. |
| `marketplace` | 20 | 10 | 3 | 19 excluido | Entitlements comerciales de agentes: fuera del alcance del CMDB salvo decisión de licenciamiento. |
| `airt` | 20 | 5 | 7 | 18 sensible, 2 deprecado | AI Red Teaming: resúmenes y rounds son candidatos sensibles; prompts/casos requieren decisión. |
| `infrastructure` | 12 | 8 | 11 | 9 registrado, 6 probado | NPA: publishers, brokers y upgrade profiles ya registrados; alerts config y broker config son candidatos de familia. |
| `vpe` | 12 | 4 | 13 | 11 candidato, 1 excluido | VPE: nodos, templates y grupos. Alias de `vpemanager`; sin imágenes ni tokens. |
| `vpemanager` | 12 | 4 | 13 | 11 candidato, 1 excluido | Alias de `vpe`: nodos, templates y grupos; sin imágenes ni tokens. |
| `incidents` | 12 | 9 | 5 | 9 excluido, 3 sensible | Incidentes individuales, forense y malware: excluidos. Watchlists/escenarios: candidatos sensibles. |
| `rbi` | 12 | 6 | 6 | 11 candidato, 1 excluido | Remote Browser Isolation: configuración (CDR, cloud storage, plantillas, categorías). Nunca contenido; `testconfig` es acción. |
| `analysis` | 10 | 7 | 5 | 10 registrado | Recomendaciones y generación NPA: familia `NSK-NPA-002`; sólo lectura. |
| `deviceclassification` | 10 | 3 | 9 | 10 candidato | Clasificación de dispositivos: reglas, tags y detección on-prem; enlaza con `NSK-DEV-001` y `NSK-CFG-001`. |
| `forwardproxy` | 10 | 4 | 7 | 8 candidato, 2 excluido | Forward proxy: settings e IdP accounts (SAML/OIDC) y grupos SAML; certificados y metadata fuera. |
| `scim` | 9 | 2 | 9 | 5 candidato, 4 registrado | SCIM de grupos/usuarios: `NSK-GRP-001` y `NSK-RBAC-001`; los schemas/ResourceTypes son candidatos de bajo valor. |
| `reporting` | 14 | 4 | 0 | 14 sensible | Reportes y widgets (aa/er): candidato sensible; requiere filtros y allowlist. |
| `streamingclient` | 8 | 3 | 6 | 6 sensible, 2 excluido | Clientes, destinos y formats de streaming: candidatos; installer y JWT fuera. |
| `ips` | 7 | 2 | 6 | 7 candidato | Estado y configuración IPS: candidato de postura, sin firmas ni textos de plantillas. |
| `rbac` | 8 | 2 | 5 | 8 registrado | RBAC v2 (roles/labels/api groups): ya registrado como `NSK-RBAC-PROBE-001`. |
| `devices` | 2 | 10 | 2 | 2 probado, 1 excluido | `supportedos` ya probado; `otp` excluido. |
| `enrollment` | 4 | 2 | 7 | 3 candidato, 1 excluido | Estado de enrollment y notificaciones: candidatos; `tokenset` excluido. |
| `atp` | 8 | 4 | 0 | 8 excluido | Malware analysis (sandbox/URL scan): forense descargable, excluido por diseño. |
| `nsiq` | 7 | 3 | 0 | 7 candidato | Threat intelligence: reputación y recategorización de URL; sin URLs individuales por defecto. |
| `epdlp` | 4 | 3 | 3 | 4 candidato | Endpoint DLP: health, constraint profiles y exclusiones de linaje (configuración). |
| `datalineage` | 6 | 1 | 2 | 6 sensible | Linaje de archivos: sólo la configuración (`stance`, `md5exclusions`) es candidata; el grafo por archivo es sensible. |
| `aiguardrails` | 5 | 2 | 2 | 5 registrado | Guardrails de IA: evaluaciones y settings; familia `NSK-AI-001`. |
| `proxyagentapi` | 2 | 3 | 1 | 2 excluido | Historial de chat del agente: contenido personal, excluido. |
| `users` | 3 | 2 | 0 | 2 usado, 2 sensible | `counts` ya se usa; `attributes` es candidato sensible (posible PII). |
| `appaccess` | 4 | 0 | 1 | 4 sensible | Conexiones de apps para Malware Retention: candidato sensible. |
| `spm` | 2 | 0 | 2 | 2 registrado | SSPM: instancias desconectadas y permisos privilegiados por app; familia `NSK-SPM-001`. |
| `drm` | 1 | 0 | 1 | 1 candidato | Labels por vendor/instancia: configuración candidata. |
| `ubadatasvc` | 0 | 2 | 1 | `user/uci` | Sin GET, pero `POST user/uci` es una consulta de lectura (contrato verificado, ver «Probe v3»). La heurística por nombre lo había marcado como escritura. |
| `deepfakedetection` | 0 | 2 | 0 | — | Sólo operaciones de escritura o acción; sin GET. |
| `casb` | 1 | 0 | 0 | 1 candidato | Instancias de apps CASB: candidato de inventario (una ruta). |
| `discovery` | 1 | 0 | 0 | 1 excluido | Token de upload: excluido. |
| `smtpproxy` | 0 | 1 | 0 | — | Sólo operaciones de escritura o acción; sin GET. |
| `templates` | 1 | 0 | 0 | 1 candidato | Plantilla de notificaciones de usuario: candidato de configuración. |
| `aisecurity` | 1 | 0 | 0 | 1 candidato | Uso de AI Security: candidato de agregados. |
| `integrations` | 1 | 0 | 0 | 1 candidato | Conexiones Microsoft Purview: candidato de inventario. |
| `clientconfiguration` | 1 | 0 | 0 | 1 sensible | POPs GSLB Elite: candidato; excluir IPs. |

Candidatas a lectura por POST por familia: `adem` 28, `services` 9, `dem` 4, `incidents` 4, `devices` 3, `policy` 3, `profiles` 3, `steering` 3, `ui` 2, `airt` 1, `analysis` 1, `datalineage` 1, `dspm` 1, `ips` 1, `nsiq` 1.

## Alias y solapamientos

- `vpe` y `vpemanager` exponen las mismas rutas de nodos, templates y grupos.
- `scim` y `platform/administration/scim` duplican ResourceTypes, Schemas y Users (los usuarios SCIM sincronizados no son los administradores del tenant).
- `ui/casbapi` es la API interna de la UI; `casbapi` es la API pública de Next-Gen CASB.
- `aig`, `policy/aig`, `profiles/aiguardrails` y `aiguardrails` se solapan en la superficie de IA.

## Excluido por diseño

Aunque la operación sea GET: contenido de archivos, correos, chat o calendario; forense, pcap, capturas, artefactos y malware; diccionarios y archivos descargables; certificados, tokens, JWT, OTP y claves; imágenes de VPE; instaladores; ubicación exacta, IPs, hostnames y filas por usuario; historial de chat del agente; entitlements comerciales (`marketplace`) salvo decisión de licenciamiento. Familias enteras excluidas: `ui` (API interna de la UI), `atp`, `proxyagentapi`, `marketplace` y la mayor parte de `incidents` y `casbapi`.

## Posibles líneas de trabajo

Agrupaciones de candidatos para que otra sesión las convierta en tareas `NSK-*` con probe y decisión, o las descarte con motivo:

- **`deviceclassification`, `profiles`:** postura de configuración (reglas, tags, red, DNS, destinos, categorías, service objects); de las listas sólo nombre, ID y conteo.
- **`ips`, `rbi`, `epdlp`, `drm`:** controles de endpoint y aislamiento; sólo configuración, nunca contenido ni acciones de prueba.
- **`policy` (fastpath, internetaccess, domainfrontings):** políticas configuradas no NPA, complemento de las políticas observadas (`NSK-POL-001`).
- **`steering`, `clientconfiguration`, `infrastructure`:** túneles GRE/IPSec, Express Connect, POPs; sólo IDs, estado y nombre, sin IPs.
- **`spm`, `dspm`, `aisecurity`, `aiguardrails`, `airt`:** postura SaaS, datos e IA. `dspm` es la más sensible: requiere decisión de privacidad, allowlist y agregación, nunca muestras ni linaje por archivo.
- **`reporting`:** reportes y widgets agregados (aa/er); útil con filtros y allowlist acordados; no reemplaza las métricas propias.
- **`forwardproxy`, `enrollment`, `templates`, `streamingclient`, `nsiq`, `analysis/npa`, `casb`, `integrations`:** configuración de autenticación, enrollment, destinos de streaming y capacidades satélite; probar disponibilidad antes de diseñar.

## Probe v3 (2026-10-04)

`scripts/probe_netskope_api.sh` (`NSK-API-001/v3`) cubre 94 GET y 14 consultas POST de sólo lectura; sólo informa forma de respuesta. Resultado contra el tenant:

- **`200` útiles:** `users/counts`, `nsbrowser/licensesettings`, `nsbrowser/licenses`, `nsbrowser/policies`, `steering/ipsec/{pops,tunnels}`, `steering/gre/{pops,tunnels}`, `dem/alert/{rules,receivers}`, `POST dem/alerts/getalerts`, `reporting/er/reports` (53), `spm/stats/disconnectedinstances`, `rbac/roles/me`, `ips/{status,allowlist,alertonlymode}`, `forwardproxy/auth/globalsettings`, `enrollment/{secure-enrollment,tenantnotifications}`, `casbapi/accessreviews` (0), `epdlp/constraints` (0), ADEM `getinfo`, `getapplications`, `getlocations`, `getsummary`, `getentities`, `device/getaggregatedscores`, `metrics/getexpscore`, `device/getrca`, y UBA `incidents/users/getanomalies`.
- **UCI:** `POST ubadatasvc/user/uci` con `{user, fromTime, toTime}` (no `username`, como envía el SDK) devuelve `confidences[{start, confidenceScore}]`; `POST incidents/uba/getuci` con `{users[], fromTime, toTime}` devuelve `usersUci[]` en lote. Segundos y milisegundos dan densidades distintas (359 vs 22 puntos en 30 días).
- **`403` (falta scope):** `auth/tokens`, `enrollment/tokenset`, `dem/query/definitions`, `dem/apps`, `dem/appprobes`, `aig/*`, `airt/*`, `casb/appinstances`, `analysis/npa/jobs`, `services/dlp/profiles`, `policy/internetaccess/*`, `profiles/networks`, `ips/threathuntingconfig`, `events/logstreaming/list`, `steering/expressconnect/sites`. `events/metrics/transactionevents` da `401`.
- **`404` (sin licencia o ruta inexistente en el tenant):** `spm/{apps,policy/rules,saas_posture_score,inventory}`, `devices/tags`, `steering/devices`, `steering/globalconfig/clientconfiguration`, `users/getgroups` por GET (es POST).
- **`400` por parámetros:** `incidents/users/scenarios`, `aisecurity/usage`, `adem/{userlist,poplist,deviceoslist}`, `adem/tenant/getusage`, `adem/users/metrics/getexpscores`, `events/datasearch/incident`, `events/data/audit` e `infrastructure`; esquemas por capturar.

## Contratos verificados de Netskope

### Steering IPsec y GRE (`NSK-IPSEC-001`, `NSK-GRE-001`) — retirado 2026-10-10
La vista "Túneles de steering", la tarea `netskope_steering` y la ruta `GET /api/cmdb/netskope/steering` se retiraron: el catálogo de POPs es el mismo para todos los clientes de Netskope y el tenant no tiene túneles IPsec/GRE, así que no aportaba información del tenant. La migración 092 elimina `netskope_steering_pops` y `netskope_steering_tunnels`; `NETSKOPE_STEERING_PATH` ya no se lee. El método de encaminamiento útil es por dispositivo y se evalúa dentro de la postura de equipos (`NSK-GRAPH-DEV-001`).

### Experiencia digital: descubrimiento (`NSK-EXP-DISCOVERY-001`, 2026-10-10)
Probe `scripts/probe_netskope_experience.py` (sólo lectura; informa forma y clase de cada campo, nunca IPs, correos ni identificadores). Resultados del tenant:
- **On-Premises Detection ya viene en `clientstatus`** (la ruta que sincronizamos, hoy sin guardar): `onpremises_status` (`on-prem`, `off-prem`, `unconfig`, `Unknown`), `onprem_status.{status,method,match_ip}` (`method` `Egress_IP` o `HTTP`), `last_connected_from_public_ip` / `_private_ip`, `netskope_pop`, `pop_pinned`, `zipcode`, `host_info.client_config` y `host_info.steering_config` (nombre de la configuración aplicada). Netskope decide oficina o remoto; Custodia no necesita la lista de IPs de egreso (`clientconfiguration` sigue en 404).
- **Equipos con señal en 7 días (4495):** 397 `on-prem`, 4064 `off-prem`, 34 `Unknown`. Contra la lista de egreso de una configuración (8 IPs): 371 de los 388 equipos con esa IP pública figuran `on-prem` (14 `off-prem`, 3 `Unknown`); 26 `on-prem` no están en esa lista porque otras client config tienen otras. Sobre los 8985 registros, `unconfig`, vacío y `Unknown` son registros viejos o sin detección configurada.
- **Client config aplicada:** `Default tenant config` 4388, `TestCiber` 79, `Client Default` 22, `Test AI Homologacion` 6; steering: `Default tenant config` 4308, `Vmedia tenant config` 162.
- **ADEM, nivel tenant:** `getsummary` da `totalUsersCount` (~3470), `activeDevicesCount`, `userCountPoorExp`, `appsImpactedCount` y la lista de apps. `getentities` **ignora `offset` y `limit` > 100**: devuelve siempre los 100 usuarios de peor puntaje (`expScore` 42–75), cada uno con `location` en texto de ciudad, `devices`, `applications` y `userGroups`. No hay distribución del tenant completo por esta vía.
- **ADEM, por usuario:** `getinfo` (puntaje, `lastKnownLocation`, `organizationUnit`, `userGroup`), `getlocations` (ciudad, región, país, lat/long), `device/getdetails` (**`publicIp`, `privateIp`, `gateway`, `pop`, `geo`, `clientStatus`**, CPU, memoria), `device/getrca` (`rootCause` y `scoreSummary` con cpu, disco, memoria, red, Wi-Fi), `getaggregatedscores`, `getexpscore` (serie). Cada llamada ~0,5 s.
- **UEBA:** `incidents/users/getanomalies` acepta varios usuarios, `timeframe` máximo 30 días y devuelve hasta 1000 filas (25 usuarios con UCI bajo: 4922 en 30 días; mediana 9,5 por usuario, máximo 743) con escenario, subescenario, regla, actividad, severidad, `score`, aplicación, método de acceso e IPs. Catálogo `GET incidents/users/scenarios?lastxdays=` (requiere ese parámetro): `Compromised credential`, `Compromised device`, `Insider threat`. En la muestra dominó `Insider threat` › `DLP violation`. `ubadatasvc/user/uci` da la serie de UCI (277 puntos en 30 días) y `incidents/watchlists` las listas con usuarios.
- **Decisión (2026-10-10, `NSK-EXP-ONPREM-001`):** el sync de equipos guarda sólo categorías en los atributos del dispositivo (`onprem_status`, `onprem_method`, `client_config`, `steering_config`); **no** guarda IPs públicas ni privadas, `match_ip`, POP ni código postal. `GET /api/cmdb/netskope/experience/presence` cuenta equipos activos con señal en 7 días por estado, `client_config` y empresa; el detalle usa los filtros `onprem_status` y `client_config` de `GET /api/cmdb/netskope/devices`. Un equipo sin el dato (sincronizado antes) cuenta como "Sin dato", nunca como remoto. Mostrar `match_ip` queda fuera hasta confirmar con el responsable del tenant que es la lista de egreso corporativa.
- **Decisión (2026-10-11, `NSK-FLEET-001`):** la vista Equipos lee `GET /api/cmdb/netskope/devices/fleet-groups?group_by=company|os|client_config|device_make`, una sola lectura agrupada sobre la población por defecto del inventario (equipos activos con evento en 7 días): equipos, con evento en 24 h, cliente al día (sobre versiones reconocidas), SO en el mínimo (sobre SO con mínimo configurado) y en oficina (sobre los que Netskope clasificó). Sin línea base, la columna no se evalúa; nunca es cero. Cada celda equivale a la lista de `GET /api/cmdb/netskope/devices` con los mismos filtros (test de integración). `experience/presence`, `devices/freshness`, `devices/client-compliance` y `devices/fleet` quedan publicados pero la interfaz ya no los usa.

### Postura Netskope (`NSK-POSTURE-001`)
No consulta Netskope: `GET /api/cmdb/netskope/posture` evalúa al leer chequeos sobre el inventario ya sincronizado (eventos de desinstalación/deshabilitación, sin señal > 30 días sin diagnóstico, hostname duplicado y, sólo con `netskope:uba_read`, UCI Poor/Moderate). Cada chequeo es la misma consulta que `GET /api/cmdb/netskope/devices` con sus filtros sobre todo el inventario activo; sin permiso queda pendiente, nunca cero. Los chequeos de releases golden y de mínimos de SO están diferidos hasta definir esa política (`NSK-POLICY-001`): no se evalúan ni se muestran. No persiste hallazgos ni estados.

### UCI de usuarios (`NSK-UBA-002`)
`NETSKOPE_UCI_PATH=/api/v2/incidents/users/getactiveuci` (único valor aceptado). `POST {ratingRank: Poor|Moderate}` → `results[{user, startTime (ms), uciScore}]` + `totalCount`; cada calificación debe llegar completa (`len(results) == totalCount`) o la corrida falla; `Good`/`All` se truncan en 1.000 filas y no se piden. El historial de una semana sale de `POST incidents/uba/getuci {users[], fromTime, toTime}` en lotes de 250 (sólo para leer el puntaje anterior; la serie no se guarda). Escala 0–1000. Tabla `netskope_user_uci`, reemplazo completo, permiso `netskope:uba_read`.

Evidencia de forma y allowlists por caso de uso. Un `200` o un probe **no** habilita persistencia: cada ruta pasa por los estados *referenciada → accesible → contratada → implementada* (método, request, respuesta, paginación, límites, allowlist y exclusiones aprobados; cliente y superficie con pruebas). Los probes versionados (`scripts/probe_netskope_api.sh`, `probe_netskope_dlp_*`, `probe_netskope_aa.py`) leen los secretos de `.env.local` o de un archivo, exigen `curl` y `jq`, usan HTTPS, no aceptan rutas fuera de su allowlist, no ejecutan escritura y emiten sólo estado, claves, tipos, conteos y headers de rate limit (`PROBE_RAW=1` queda para inspección local controlada). Publican límites de 4, 30, 50 y 100 req/s según el endpoint (DEM: 4 req/s).

### Autenticación

El cliente (`netskope/sse/integrations/netskope.py`) envía `Netskope-API-Token` desde `NETSKOPE_API_TOKEN` o `NETSKOPE_API_TOKEN_FILE`; no obtiene ni renueva tokens OAuth. Que la consola muestre `View` no confirma el acceso de cada endpoint para Custodia: los permisos se comprueban con esa credencial. `POST /api/v2/platform/oauth2/token` está referenciado, pero no se confirmó `client_credentials`, scopes, audiencia, expiración ni compatibilidad con las rutas actuales; no se reutiliza el transporte OAuth de CyberArk ni se sustituye el header por `Bearer`. Cambiarlo exige documentación/OpenAPI del tenant y confirmar grant no interactivo, permisos mínimos de lectura, ciclo de vida del token y manejo de `401`/`403`. Un token no elimina las credenciales (API token, access token, refresh y client secret lo son): se proveen al proceso por un gestor de secretos o montaje restringido y nunca se persisten en PostgreSQL, exportaciones, frontend, logs ni documentación.

### Permisos y accesibilidad del tenant

Matriz del 2026-09-24 (token read-only), actualizada el 2026-10-01 (11:56–11:58 UTC, credencial de Custodia, sólo GET, 17 rutas de desbloqueo y 15 de DEM):

| Resultado | Rutas |
|---|---|
| `200` | `events/datasearch/{alert,application,page}` (10.000 filas de eventos por respuesta), `policy/npa/policygroups`, `policy/npa/rules` (vacío), `devices/supportedos`, `rbac/roles` (25 filas), `platform/administration/scim/Users` (25 por página), `scim/Groups` (718), `infrastructure/{publishers,publisherupgradeprofiles}` y `steering/apps/private` (envoltura `data`/`status`/`total`), `infrastructure/lbrokers` (vacío), `policy/urllist` (23 objetos; excluir `data`), `profiles/destinations` y `profiles/serviceobjects` (páginas de 10; no persistir `values`) |
| `400` | `events/datasearch/incident` (la captura usa `dataexport/events/incident`), `events/data/audit` (antes `403`; faltan parámetros/schema), `dem/alert/rules/entities` |
| `403` | `policy/internetaccess/{rules,rules/applied,groups}`, `profiles/networks`, `dem/query/definitions`, `dem/apps`, `dem/appprobes`; `services/cci/app` responde `200` con un error funcional del servicio |
| `404` (GET, 2026-09) | `users/getgroups` (el contrato real es POST; ver grupos), client configuration, steering devices, SSPM score y UCI |

DEM repitió **11 `200`, 3 `403` y 1 `400`** (límite 4 req/s). El bloqueo observado para métricas DEM es `dem/query/definitions`; los POST `dem/query/getdataset`, `getentities`, `alerts/getalerts` y `adem/users/metrics/getexpscore` no se ejecutaron y no se clasifican como denegados por extrapolación. Los `403` los resuelve el dueño del tenant contrastando la cuenta y el token efectivos de Custodia con las rutas exactas; nunca se pide escritura para arreglar lecturas denegadas.

### DEM: sitios (`NSK-DEM-INV-001`)

`config/applications` y `config/gateways` responden vacíos (sin campos de ítem); `config/sites` devuelve un **array JSON directo** (3 objetos, sin envoltura ni paginación documentada); `networkprobes` sólo trae `totalCount`; `operatingsystems`, `monitoredapps` (47 pares nombre sin ID) y `globalsettings*` son catálogos o configuración fuera del inventario; receivers y reglas vienen vacíos. Captura opt-in con `NETSKOPE_DEM_SITES_PATH=/api/v2/dem/config/sites` durante una corrida Netskope completa; se persisten sólo `id`, `name`, `revision`, `date_create`, `date_modify`, `num_gateways`, `num_runners` y de `pop_tracing` `gslb`, `method` y `period`. Se descartan ubicación, subnets, gateways, runners, tunnels y campos desconocidos; un payload inválido falla antes de persistir o reconciliar y, si la opción se apaga, los sitios previos no se retiran ni se presentan como captura vigente. `monitoredapps` no es una identidad estable ni permite joins por nombre. `GET /api/cmdb/netskope/dem/sites` (`netskope:read`).

### Grupos y membresías (`NSK-GRP-001`)

Verificado el 2026-10-04 con consultas de lectura de 1–2 registros: `POST /api/v2/users/getgroups` responde `200` con el sobre de `getusers` (`counts.totalResults/offset/itemsPerPage` y `data[]`; 718 grupos en una página de `limit=1000`). Cada grupo trae `id`, `scimId`, `displayName`, `deleted`, `provisioner` (`AD`, `SCIM`, `Local`) y metadata de modificación; `userCount` **no siempre viene** (ausente en 296) y no se trata como cero; `displayName` se repite (11 casos), así que la identidad es `id`. La membresía no se pide grupo por grupo: `getusers` ya devuelve `accounts[]` con `parentGroups`, una lista de **`id` de grupo** (385 de 385 coinciden con `id`, ninguna con `scimId`, 160 con `displayName`); el tenant ignora la proyección y devuelve `accounts` igual, y la corrida la pide explícitamente con el grupo habilitado.

Opt-in con `NETSKOPE_GROUPS_PATH=/api/v2/users/getgroups` (otro valor es inerte o rechazado), dentro de la corrida `netskope_inventory`. Se persisten como `netskope_group` sólo `id`, `displayName`, `provisioner`, `scimId` y `userCount` (si se informa), y aristas `user —member_of→ netskope_group` (las cuentas `deleted` no cuentan; una referencia a un grupo ausente se cuenta como no resuelta y no se enlaza). Capa opcional: una lectura fallida o incompleta (sin `totalResults`, offset incorrecto, página vacía antes del total), usuarios sin `accounts[]` o referencias con un listado vacío dejan la corrida `partial`, escriben usuarios y equipos y **no reconcilian** grupos ni membresías; una corrida completa retira grupos ausentes o `deleted` y aristas caídas. `GET /api/cmdb/netskope/groups` (búsqueda, origen, paginación; conteo **observado** junto al **informado**) y `.../groups/{id}/members`, bajo `netskope:read`. Prueba de extremo a extremo en lectura (2026-10-04, sin escribir): 10 requests y 4,9 s para 718 grupos y 8.923 usuarios; 16.632 membresías en 7.746 usuarios y 422 grupos con miembros (los mismos 422 que informan `userCount` > 0), 0 no resueltas; la suma de `userCount` es 16.782 y la diferencia de 150 no se explica con los datos, por eso las dos cifras se muestran separadas.

### Experiencia digital: ADEM

- **POPs:** `GET /api/v2/adem/poplist` exige `starttime` y `endtime` en segundos Unix (ventana máxima 48 h dentro de los últimos 30 días; `prefix` opcional) y responde `{pops: [...], totalCount}`. Custodia consulta ventanas de 2, 24 o 48 h bajo `netskope:read`, valida la forma y expone sólo códigos de POP, cantidad y período; no persiste ni mezcla con los sitios DEM, y no infiere usuario, dispositivo, volumen, sesiones, latencia ni IP de egreso (probe 2026-09-30: 18 códigos en 2 h).
- **Por usuario/dispositivo (`NSK-ADEM-USERPOP-001`, probe 2026-09-30):** `POST adem/users/device/getlist` con `{user, starttime, endtime, userLocation: []}` devuelve `[{deviceId, deviceName, deviceOs}]`; `POST adem/users/device/getdetails` con `{user, deviceId, starttime, endtime}` devuelve `pop` y `lastActivity` (entero de segundos Unix). La fecha observada quedó ≈24 minutos **después** del reloj de consulta: la semántica de frescura no está confirmada y no se corrige ni recorta (`NSK-ADEM-TIME-001`, externa).
- Custodia ofrece `GET /api/cmdb/netskope/users/{object_id}/experience/devices?hours=2|24|48` y `.../devices/{device_id}` bajo `netskope:read`: resuelve sólo usuarios activos de `source_system = netskope` (su correo persistido es el parámetro `user`), verifica que el dispositivo pertenece al listado de ese usuario y ventana, y expone ID/nombre/SO, POP, actividad informada, procedencia y período (`activity_status`: `in_window`, `outside_window`, `unknown`). No persiste nada, excluye IP, gateway, geo, coordenadas y score, reemplaza errores remotos por un mensaje controlado y no vincula `deviceId` ADEM con dispositivos SSE por semejanza. **Única excepción (ADR 006, 2026-10-11):** en la ruta de puntaje de un usuario, un equipo ADEM se une al equipo del inventario de ese usuario por nombre **exacto y único** en ambos lados (`services/netskope_device_link.py`), devuelto como `inventory_device_id`; sin coincidencia única cada lado queda por separado. `getentities` y los agregados por POP siguen pendientes de schema `200` y paginación.

### UCI por empresa (`NSK-EXP-UEBA-001`, fase 2)
`GET /api/cmdb/netskope/uci/companies` (`netskope:uba_read`, auditada con conteos): por empresa (`company` o dominio del correo), usuarios activos **con correo** y cuántos tienen UCI Poor o Moderate. Es una **proporción**, no un promedio de puntaje: los usuarios Good no se guardan (`netskope_user_uci` solo conserva Poor y Moderate), así que promediar sesgaría hacia las empresas sanas. Los usuarios sin correo no entran al denominador porque el correo es la única clave que los une al UCI. Ordenada por proporción en riesgo, 25 empresas como máximo (el resto suma en `omitted_users`). **Tendencia semanal:** cada sincronización de UCI guarda en `netskope_uci_company_history` (migración `093`) los conteos por empresa y semana (`users`, `poor`, `moderate`; la última lectura de la semana gana; solo cantidades, nunca usuarios, correos ni puntajes; se purga a las 26 semanas). La respuesta incluye `previous` (conteos de la última semana anterior guardada, o `null`) y `previous_week`; la UI muestra la variación en puntos porcentuales y «Sin dato» sin foto previa. Si registrar la foto falla, la captura de UCI igual termina.

### Experiencia digital: puntaje por usuario (`NSK-EXP-UEBA-001`, fase 1)
`GET /api/cmdb/netskope/users/{object_id}/experience/score?hours=2|24|48` (`netskope:read`, lectura en vivo, nada persistido). Probe 2026-10-10: `adem/users/getinfo` da `expScore` (0–100) y `adem/users/device/getaggregatedscores` da, por equipo, `metrics.{expScore, deviceScore, networkScore, appScore}`. La ruta lee `getinfo`, el listado de equipos (`getlist`) y los puntajes de **hasta 5** equipos (`devices_total` informa el total); `weakest` es el componente más bajo observado (equipo, red o aplicaciones) y un puntaje ausente es "Sin dato", nunca 0. No expone ubicación, IP ni gateway. La causa raíz de `device/getrca` **no** se consume todavía: sus nombres (`rootCause.name`) no tienen valores verificados en el probe. **Serie `getexpscore` descartada (probe 2026-10-10):** con `user` solo responde, pero la ventana máxima es de 48 h (7 y 30 días se rechazan) y la muestra trae 30 intervalos de los que solo 1 tiene `expScore`; una gráfica de evolución quedaría casi vacía, por eso no se construye. Fases siguientes: causa raíz (`getrca`, nombres por verificar) y anomalías UEBA.

### UEBA por usuario y cola del operador (`NSK-EXP-UEBA-001`, fases 3 y 4)
- `GET /api/cmdb/netskope/users/{object_id}/anomalies` (`netskope:uba_read`, lectura en vivo, nada persistido): `incidents/users/getanomalies` con `{users:[correo], timeframe:30, limit:1000}`; devuelve conteos por severidad (normalizada: `High`/`high`, `low`/`Low`… → minúscula; otro valor es «Sin dato»), por escenario y subescenario, las reglas más frecuentes y las 10 más graves y recientes con `severity`, `scenario`, `sub_scenario`, `rule`, `activity`, `app`, `score` y `time`. **Nunca** salen IP de origen o destino, `alertId`/`eventId`/`anomalyId`, `anomalyData.featureValue` ni `additionalProperties`. Si `totalCount` supera las filas devueltas, `truncated`. Probe 2026-10-10: 30 días y 1000 filas es el tope; el usuario más cargado de la muestra tenía 781.
- `GET /api/cmdb/netskope/experience/attention` (`netskope:uba_read`): cola de hasta 50 usuarios que une el UCI bajo/moderado guardado con los 100 de peor puntaje de `adem/users/getentities` (24 h; Netskope ignora `offset` y no pasa de 100, así que **no** es la distribución del tenant). Orden: primero los que figuran en ambas fuentes, luego Poor, Moderate y solo ADEM. El puntaje de una fuente que no listó al usuario es `null` («Sin dato»), nunca 0. Si ADEM falla devuelve solo UCI con `adem_available=false`.

### Alertas agregadas (`NSK-ALR-001`) y políticas observadas (`NSK-POL-001/002`)

Las alertas se consultan como agregados count-only con `fields=count_total:count(id)` por `datasearch/alert` (`NETSKOPE_ALERT_PATH=/api/v2/events/datasearch/alert`); nunca se descargan ni persisten eventos, usuarios, IPs, archivos, URLs ni forense. Cada sync toma ventanas móviles de **7, 30 y 90 días** y guarda total, Top de `alert_type` y `action` y los nombres de `policy` observados con su conteo (la severidad se lee de AA, sin snapshot local); la API sólo expone las diez claves más frecuentes por dimensión, los ceros también se guardan y las dimensiones fuera de la allowlist se rechazan. La retención es de 180 días (`ALERT_AGGREGATE_RETENTION_DAYS`).

**El endpoint no es exclusivo de DLP:** el total cuenta todos los tipos del tenant (2026-09-25, 7 días: `policy` 27.035.528, 99,9 %, frente a `DLP` 24.575; 30 días 127.408.129 frente a 141.173; 90 días 336.957.366 frente a 417.528), por eso la UI lo rotula «Alertas Netskope agregadas» y muestra aparte el corte DLP. Filtrar por `alert_type` exigiría un contrato nuevo. `NETSKOPE_DLP_ALERTS_PATH` (`dataexport/alerts/dlp`) es un iterator de exportación cruda (`index`/`operation`) que no acepta el contrato agregado y puede devolver datos personales y forenses: Custodia informa si está configurada pero no la consume.

**Políticas observadas.** `dimension = policy` (migración `075`) es sólo **observada**: una política aparece si disparó en la captura; el catálogo configurado no se importa y una ausente no se marca deshabilitada. Por política se expone nombre, volumen por ventana y primera/última captura (`captured_at` de los snapshots, nunca la fecha de un evento); no hay dimensión cruzada `policy × action`, así que la «acción dominante» es siempre «Sin dato», y un dato ausente es «Sin dato», nunca `0`. **Veracidad de la ventana (`NSK-POL-002`, migración `081`):** la tarea de alertas escribe por ventana una fila marcadora `policy_capture` cuando todas sus consultas tuvieron éxito; cada ventana de la API trae `policy_capture` = `captured` (el cohorte incluyó filas `policy` o el marcador) o `missing`. Sólo `captured` con lista vacía significa «ninguna política disparó»; `missing` es «Sin captura de políticas» y los cohortes anteriores a la `081` quedan `missing` hasta la próxima sync, sin heredar políticas de una corrida previa. `first_captured_at` es el mínimo entre los snapshots conservados (no la primera aparición real; la UI rotula «Desde (retención 180 d)»). `GET /api/cmdb/netskope/observed-policies` (`netskope:read`, aislado por `source_system`) no devuelve usuarios ni eventos y no tiene drill-down (decisión al aceptar `NSK-POL-001`).

### Grupos de políticas de Real-time Protection (`NSK-POLICY-002`, 2026-10-12)

`GET /api/v2/policy/npa/policygroups` (aprobada con `NETSKOPE_POLICY_GROUPS_PATH`; otro valor se rechaza) devuelve, pese a su segmento `npa`, **los grupos de políticas de la consola**: en este tenant `Header Policies`, `Default`, `Footer Policies`, `Utility`, `Cloud Apps and Data Protection`, `Web and Isolation`, `DLP for E2E apps` y `Enterprise Browser`, los mismos 8 de «Policies → Real-time Protection». Forma: `{status, data[]}` con `group_id`, `group_name`, `group_type`, `can_be_edited_deleted`, `created_by`, `modify_by`, `modify_time`, `modify_type`.

**Allowlist persistida** (tipo `netskope_policy_group`, migración `099`): `group_id` (texto), `group_name`, `group_type` y `can_be_edited_deleted`. Nunca `created_by`, `modify_by` (identidades de administradores) ni `modify_time`. La lectura es opcional dentro de `netskope_inventory`: si falla, la respuesta no tiene `data[]`, viene vacía, alcanza el tope de 500 o trae un grupo sin id o nombre, los grupos almacenados no se tocan y la corrida queda parcial (`policy_groups_error`). Como la respuesta no trae total, no se puede probar que esté completa: sólo una lectura válida y no vacía reconcilia (y retira lo ausente). Lectura: `GET /api/cmdb/netskope/policy-groups` (`netskope:read`).

**Las reglas no están ahí.** `policy/npa/rules` responde `200` con 0 reglas (sólo Private Access). Las rutas de reglas, `GET policy/internetaccess/rules` (confirmada en el Swagger: filtro `jql` por `id`, `group_id`, `name`, `enabled`, `status`; `limit` máx. 1000), `internetaccess/groups`, `internetaccess/rules/applied` y `services/dlp/profiles`, siguen en `403` (probe del 2026-10-12). El Swagger las describe como *«still under development and not ready for use. Please work with your account team to learn about them and request access»*, el mismo mensaje en todas las que fallan: el acceso lo habilita Netskope, no un scope del token. Hasta tenerlo (`NSK-POLICY-003`), Custodia no sabe qué cubre cada grupo.

### DLP: captura mínima (`NSK-DLP-001`)

Dos contratos separados: la colección de alertas DLP (`dataexport/alerts/dlp`) y los eventos que alimentan incidentes (`dataexport/events/incident`, `NETSKOPE_DLP_INCIDENTS_PATH`, la única ruta de captura; cualquier otra queda inerte). **Historia:** el 2026-09-25 se postergó todo almacenamiento de incidentes individuales (rutas `410 Gone`, loop de cache eliminado, vista Investigación retirada; las tablas `netskope_dlp_event_cache` y `netskope_dlp_cache_state` se conservan sin captura ni purga, y borrarlas exige una autorización separada). El 2026-09-27 `NSK-DLP-001` la superó con una allowlist mínima.

**Allowlist capturada** (con `netskope:dlp_read`, retención de 30 días y lecturas auditadas): ID opaco del incidente (`dlp_incident_id`), timestamp UTC (una fila sin timestamp plausible se descarta), `status`, `severity`, política y acción (primer valor no vacío de `dlp_match_info[]`) y el ID opaco de usuario (`user_id`), usado **sólo** para resolverlo por igualdad exacta contra el inventario Netskope (sin match: «Usuario sin resolver»; nunca por email, nombre, prefijo ni similitud). Fuera de la allowlist, la base y la API: `user`, `acting_user`, `violating_user`, `title`, `app`, `site`, `file_type`, `classification`, `dlp_file`, `file_path`, `url`, `referer`, hashes, IPs, `dlp_match_info` completo y cualquier arreglo forense; aplicación/canal, tipo de archivo y clasificación no se persisten porque el probe no demuestra que sean categóricos seguros (`site` es adyacente a URL).

**Captura y retención.** Corre dentro de la corrida Netskope (`netskope_dlp` desde `SYNC-TASK-001`), acotada a 12 páginas, con cursor persistente que reanuda una captura parcial, upsert idempotente por `dlp_incident_id` (un evento más viejo nunca pisa uno más nuevo) y purga de filas de más de 30 días. Las alertas son eventos, no inventario: ninguna corrida retira filas por ausencia. Si Netskope falla, la frescura queda vieja, nunca un cero inventado. **Vista por política (`NSK-POLICY-004`, 2026-10-12):** `/netskope/dlp` agrupa por el nombre de política que Netskope escribe en el incidente (`GET /api/cmdb/netskope/dlp/policies`: volumen de 30 días, 7 días contra los 7 anteriores, mezcla de severidad y acción, última alerta; las alertas sin nombre sólo se cuentan) y abre los 5 incidentes más recientes de una política con `/investigations?policy=`. La pantalla ya no muestra usuario. No vincula política con grupo ni regla. Desde 2026-10-13 está pausada: fuera del menú y de la guía, abierta sólo por URL, hasta que `NSK-POLICY-003` permita agrupar por ID de regla (el nombre del incidente es el vigente al momento del evento y cambia con los renombres). **RBAC:** `/investigations`, `/dlp/status` y `/dlp/policies` responden `410` sin `netskope:dlp_read` (incluido `access:manage`, que no se ensancha); `/devices/alerts/summary` sigue retirada para todos (la allowlist no tiene campo de dispositivo) y `/incidents/summary` y `/users/alerts/summary` también, desde 2026-10-13 (sin consumidor tras `NSK-POLICY-004`); `/netskope/dlp` es un workspace estricto.

**Evidencia de formas.** Probe `NSK-DLP-INCIDENTS-CONTRACT-001/v1` (2026-09-27): `200`, 4 eventos con `dlp_incident_id`, `timestamp`, `status`, `severity`, `user_id` y `dlp_match_info[].dlp_policy/dlp_action` presentes 4/4, `user` y `acting_user` iguales, `incident_id` ausente y `next=200` con 0 eventos. El probe original de alertas (2026-09-23) subestimó el esquema porque inspeccionaba sólo las claves del primer evento; `NSK-DLP-CONTRACT-001/v2` calcula presencia sobre toda la página: el evento crudo trae **≈140 campos presentes en el 100 %**, incluidos todos los forenses y de ubicación (`srcip`, `dstip`, geolocalización, `mail`, `sha256`, `file_path`, `owner`, `userPrincipalName`…), ninguno se incorpora a la allowlist. En 25 eventos, `violating_user` y `act_user` coinciden 25/25 y `user` no coincide con ninguno (0/25): no se equiparan en el código. Granularidad: 25 eventos ≠ 19 `dlp_incident_id` ≠ 21 `incident_id`; cualquier conteo debe rotular si cuenta eventos o incidentes únicos. El cruce alertas↔incidentes (2026-09-24) sólo mostró intersección por `dlp_incident_id` (2 coincidencias; `_id` e `incident_id` no equivalen). Los filtros `hostname`, `user` y `userkey` devuelven filas con un marcador imposible: se ignoran, no filtran en el servidor. `next=200` (177 y 27 eventos en la página siguiente); sin `409` ni `429` en corridas normales.

**Corrida «sin novedades» (2026-10-04).** Una corrida que lee 3 páginas seguidas sin ningún evento y con el marcador de progreso (`timestamp_hwm`) sin moverse no tiene trabajo pendiente: Netskope no tiene datos más nuevos que entregar. Termina `completed` y devuelve `dlp_idle=1` en lugar de `partial`; el cursor persistido conserva su lugar (la siguiente corrida lo reanuda) y el atraso sigue en `dlp_lag_seconds`. Con al menos un evento leído y el marcador quieto sigue siendo `partial`.

**Recuperación del iterator (2026-10-02).** `wait_time` gobierna la pausa antes de la siguiente página (medida con reloj monotónico desde la recepción; procesamiento y commit la consumen, y sólo se duerme el resto, siempre tras el commit). Si una respuesta exitosa agota `RateLimit-Remaining` se respeta `RateLimit-Reset`; `429` conserva la operación y respeta `Retry-After` (en el iterator no se recorta a 60 s). Un timeout, `5xx` o JSON ilegible puede ocurrir tras avanzar el índice: los reintentos usan `resend`, no `next`; una respuesta de control sin datos también se recupera por replay; una página con envoltura o filas inválidas falla sin checkpoint. El índice nuevo se guarda antes del primer request conservando la fecha de la última captura exitosa; datos y avance se confirman en una transacción por página; reanudar empieza con `resend` (puede repetir la última página, el upsert evita duplicados) y, sin avance confirmado, se reinicializa desde el epoch original. La memoria retiene una página y un conjunto acotado de IDs. La corrida devuelve `dlp_pages`, `dlp_requests`, `dlp_retries`, `dlp_elapsed_ms`, `dlp_lag_seconds`, `dlp_persistence_ms` y `dlp_wait_ms` (el checkpoint inicial no entra en `dlp_elapsed_ms`); `dlp_scanned_events` incluye replays y no equivale a incidentes nuevos. No se paraleliza un mismo endpoint e índice (sí entre endpoints independientes). Client status usa otro contrato (creación/status/fetch CSV, un iterator por tenant, retención de 7 días) y no sustituye el snapshot de dispositivos. Fuente: [dataexport iterators](https://docs.netskope.com/en/using-the-rest-api-v2-dataexport-iterator-endpoints); benchmark y decisiones en [`netskope-metrics.md`](netskope-metrics.md).

### Conciliación de totales con la consola (`NSK-REF-001`, `NSK-USR-001`)
Medido el 2026-10-06 contra la consola (`Devices` 22:30, `User Management` 22:29), solo lectura. **Todas las cifras cierran**; una primera
lectura de este apartado atribuyó la diferencia de usuarios a Netskope y era errónea: faltaba leer `deleted` y `active` de `accounts[]`.

| Cifra de la consola | Cómo se obtiene | Resultado |
|---|---|---|
| Dispositivos con evento en 7 días: 4.578 | misma consulta de Custodia (el tablero mostró 4.577 minutos después) | Coincide. La ventana se mide contra la hora de la consulta y los datos cambian solo con cada sync: un equipo sale de la ventana cada pocos minutos. |
| Usuarios de esos equipos: 4.454 | usernames distintos | Coincide |
| Total Users: 8.859 | filas de `getusers` (8.923, con 4 repetidas al paginar) menos 64 usuarios con **todas** sus cuentas `deleted` | Exacto |
| Enterprise Accounts Disabled: 1.987 | cuentas con `deleted` distinto de `true` y `active = false` | Exacto |
| Enterprise Accounts Enabled: 10.209 | cuentas distintas (`scimId`) activas y no borradas | Exacto |
| Total OUs: 141 | `ou` distintos de las cuentas no borradas (143 contando las borradas) | Exacto |
| Total User Groups: 718 | `getgroups`: 718, ninguno `deleted` | Exacto |
| Usuarios con Status = Enabled: 7.619 | usuarios con al menos una cuenta no borrada y activa: 7.618 | ±1 (fila repetida) |

- **Qué trae `getusers`:** cada usuario trae `accounts[]` con `scimId`, `userName`, `active`, `deleted`, `ou`, `parentGroups`, `provisioner` y
  `lastModified`, **solo si la proyección pide `accounts`**; sin ella el tenant devuelve una cuenta reducida (sin `active` ni `deleted`). La
  corrida la pide siempre desde `NSK-USR-001`. `getusers` rechaza cualquier otro campo de estado (`active`, `status`, etc. a nivel usuario).
- **Qué cuenta Custodia:** un usuario es tal si tiene al menos una cuenta no borrada; está **habilitado** si alguna de ellas está activa. Quien
  tiene todas sus cuentas borradas sale del snapshot y una corrida completa lo retira. Una cuenta sin `deleted` explícito en `true` cuenta
  como viva. Está **deshabilitado** solo quien tiene todas sus cuentas vivas con `active: false` explícito; una cuenta sin `active` o con un
  valor que no es booleano no es evidencia, y el usuario queda desconocido (sin `accounts[]` utilizable, también). Una misma id leída dos veces
  con contenido distinto, incluso una vez borrada y otra viva, falla la corrida antes de excluir a nadie. Si más del
  20 % de los usuarios aparecieran así la lectura se descarta (hoy es 0,7 %).
- **Equipos de usuarios borrados (medido el 2026-10-06, tras la primera corrida con `NSK-USR-001`):** de los 64 usuarios con todas sus cuentas
  borradas, 39 coinciden por correo exacto con 53 equipos activos (cualquier antigüedad) y 12 de ellos con 14 equipos con evento en los
  últimos 7 días. Como esos usuarios ya no son usuarios del inventario, esos equipos pasan a «sin usuario resuelto»: el efecto en las tarjetas
  es «Sin usuario resuelto» 0 → 14, «Con usuario resuelto» 4.578 → 4.564, «Usuarios sin dispositivos» 2.681 → 2.656 (−25 = 64 − 39) y
  «Usuarios con actividad reciente» 4.453 → 4.439. Es una corrección: antes esos equipos y esa actividad se atribuían a identidades que
  Netskope ya dio de baja. «Borrado» significa que todas las cuentas del usuario están marcadas `deleted`; **no prueba que la persona haya
  dejado la empresa**, y varios de esos equipos siguen reportando (`Tunnel Up`, `Dem Heartbeat`). Revisión operativa: el drill de la tarjeta
  «Sin usuario resuelto» (o el filtro de usuario observado «Sin resolver») abre los 14 equipos recientes; los 53 se ven en el inventario con
  «Incluye dispositivos sin evento en 7 días» y el mismo filtro. Se confirma si el usuario fue dado de baja y se reasigna, retira o reinstala
  el cliente; Custodia no cambia nada en Netskope. La lista nominal no se guarda en el repositorio.
- **Filas repetidas:** 4 filas de `getusers` se repiten idénticas en el borde de las páginas (posiciones 1998/1999, 3997/3998…). El mapeo da el
  mismo objeto y la deduplicación del snapshot las une; una repetición con datos distintos sigue fallando la corrida.
- **`userCount` de un grupo cuenta cuentas no borradas**, no usuarios: coincide en 420 de 422 grupos (los otros 2 difieren en 3 en total). Eso
  explica la diferencia de 150 que figura en la sección de grupos entre membresías (usuarios) y la suma de `userCount` (cuentas). 296 grupos no
  traen `userCount`; 289 no tienen miembros, pero 7 sí: la ausencia no equivale a cero.
- **Campos de grupo útiles:** `created`, `lastModified`, `lastModifiedBy`, `lastProvisioner`, `provisioner` (707 AD, 9 SCIM, 2 Local) y
  `parentGroups`. Las columnas «# User», «Provision Method», «Creation Date» y «Last Edited» de la consola salen de ahí.
- **`GET users/counts`** devuelve la cabecera de la consola (`totalUsers`, `activeAccounts`, `inactiveAccounts`, `totalGroups`, `totalOUs`,
  `lastModified`). Custodia la guarda por corrida (`netskope_reported_counts`, migraciones 086 y 088) solo como referencia.
- **SCIM** (`scim/Users`) informa `totalResults` 8.859 pero pagina 9.094 registros: no se usa.
- **Grupos:** la base no tiene grupos ni membresías porque `NETSKOPE_GROUPS_PATH` no está configurado en el servicio; con `accounts[]` pedido
  siempre, habilitarlos es solo esa variable.

### Inventario único y revisión de equipos (decisión UX 2026-10-01)

Equipos y equipos de una persona son la misma tabla: Personas abre `/netskope/inventory?observed_user_id=…&freshness=all` por el ID local del usuario Netskope, sólo si el match observado es exacto y único (un vínculo ambiguo no se atribuye). Relaciones Netskope dejó de ser entrada de menú y `/netskope/chains` abre el inventario filtrado; el contrato backend de cadenas y su historial no se eliminan. La evidencia se calcula en lectura: señal reciente hasta 7 días, sin señal reciente después de 7 y **candidato a revisión** tras más de 30 días de antigüedad del último evento válido (`NSK-HB-001`: el heartbeat dejó de intervenir, ver `netskope-metrics.md`); la última corrida `netskope-api` debe estar completa y terminada en las últimas 24 h (corridas parciales, fallidas o en curso, fechas futuras, ausentes o inválidas y fuente desactualizada dejan la evaluación en desconocido). `last_seen_at` es observación del inventario, no actividad del cliente; no se afirma propiedad, abandono, uso humano ni encendido, y no se escribe en Netskope. El total de usuarios es **identidades vigentes del último inventario completo** (no conectados); «actividad reciente» cuenta una identidad una vez cuando algún dispositivo coincide exactamente por `source_id` o correo y su `last_event_timestamp` cae en 7, 14 o 30 días.

### Advanced Analytics: descubrimiento y transporte

Detalle del flujo, el contrato y la aprobación en [`netskope-metrics.md`](netskope-metrics.md). Evidencia del descubrimiento (2026-10-02, GET acotados): `reporting/aa/reports` `200` con `{data[], msg, status}` (66 reportes; campos `folder_id`, `folder_name`, `folder_type`, `report_id`, `report_name`, `user`, `user_id`; `RateLimit-Limit=4`); `reporting/aa/widgets` `200` con 159 elementos; el primer reporte trae `data.widgets[]` (69 widgets). Resultados con `limit=1&resultFormat=json`: dos `200` en `text/csv` y un `500` JSON, sin causa atribuida ni garantía de que el parámetro de formato se respete; un resultado sin filas no es un cero de KPI. Flujo async validado: `POST .../reports/{reportId}/widgets/{widgetId}/async` (`limit`, `resultFormat`) → `201` con `query_task_id`; `GET .../tasks/{taskId}/status` → `status=complete`; `GET .../result` → CSV (también con `resultFormat=json`: 2 filas, 4 columnas). El cliente `integrations/advanced_analytics.py` valida IDs opacos, usa host HTTPS fijo sin redirects, crea una sola tarea (no reintenta un POST incierto), sondea de forma acotada (12 consultas, 90 s), respeta el rate limit, limita cada respuesta a 2 MiB, acepta JSON o CSV según el `Content-Type` real, no pagina y no interpreta una muestra como KPI completo; `429` y los demás HTTP no exitosos fallan claramente. El probe `scripts/probe_netskope_aa.py` v2 conserva GET como modo predeterminado (`--topic dlp` selecciona candidatos por título, una heurística de descubrimiento y no una allowlist; `--async-query` crea como máximo una tarea y marca `creates_query_task=true`). En el reporte DLP inspeccionado (19 widgets) una tendencia incluye una columna de identidad: el título no prueba que todas las columnas sean agregadas. No se guardan `user`, `user_id` ni payloads de reportes. Fuente: [Reporting AA v2](https://docs.netskope.com/en/rest-api-v2-reporting-endpoints-for-advanced-analytics) (async → polling → resultado; máximo documentado de 10.000 filas, sin paginación; un token de servicio accede a reportes comunes y compartidos).

### Administradores y roles de Netskope (`NSK-RBAC-001`, verificado 2026-10-14)

Lectura de forma, tipos y conteos (GET, sin valores personales). Antes respondían `403` (2026-10-01); hoy `200`.

- **`GET rbac/roles`** devuelve `{version, count, roles[]}`. **Por defecto sólo entrega 25 filas aunque `count` sea 32**: hay que pedir `?limit=100` (o paginar con `offset`; `skip` y `page` se ignoran). Campos: `roleId` (int, único), `name`, `type` (0 = 14, 1 = 18), `description`, `scoped`, `obfuscated`, `userCount`, `lastEdited`, `createdBy`, `updatedBy`, `aliasName`.
- **`GET platform/administration/scim/Users`** lista los administradores del tenant (67), de 25 en 25 por defecto; pagina con `startIndex` y `count` (`count=100` funciona). Campos: `id`, `userName`, `active`, `metadata` y la extensión `urn:ietf:params:scim:schemas:netskope:2.0:User` (`recordType` `USER`/`SERVICE_ACCOUNT`, `role {value, display}`, `lastLogin`, `isLocked`, `mfa.enabled`, `provisionedBy`, `samlAssertedRoleId`, `authType`). `scim/Users` (1405) son usuarios sincronizados, no administradores.
- **Enlace administrador → rol:** `role.value` es el `roleId` (51 de 51 resuelven contra los 32 roles). `samlAssertedRoleId` no sirve (40 de 67 coinciden) y `authType` es `API_KEY` en todos. La suma de `userCount` (51) coincide con los administradores que tienen `role`.
- **Lo que se ve:** 16 roles con administradores y 16 sin ninguno; 16 administradores sin `role` (13 activos); 15 son `SERVICE_ACCOUNT`; 17 con MFA.
- **Nunca persistir `apiAccessToken`:** la extensión lo trae como objeto en las 15 cuentas de servicio, es una credencial. Tampoco `createdBy`/`updatedBy` (identidades de administradores), igual que en `netskope_policy_group`.

**Implementación (`NSK-RBAC-001`, 2026-10-14).** Capa opcional del sync de inventario: `NETSKOPE_RBAC_PATH=/api/v2/rbac/roles` aprueba la familia completa (detalle de rol, administradores por SCIM y mapa de páginas); otro valor se rechaza. Una lectura incompleta, inconsistente o inválida conserva lo almacenado y marca la corrida como parcial: el cliente exige que las filas de roles igualen `count`, que los administradores igualen `totalResults` y rechaza listas vacías. Se guardan como tipos distintos de la fuente `netskope` (migración `100`): `netskope_role` (nombre, tipo, `userCount` informado, última edición y los grupos de API con nivel distinto de `none`), `netskope_admin` (correo, estado, tipo de cuenta, último acceso, bloqueo y MFA) y `netskope_api_group` (grupo y las páginas de la consola que abre, del mapa `pagemapping`); el enlace administrador → rol es la arista `has_role` por `role.value`. 22 de los grupos de API que traen los roles no figuran en `pagemapping` (por ejemplo `aisecurity_*`): se muestran con «Sin página asociada». Rutas: `GET /api/cmdb/netskope/admins`, `/admin-roles` y `/admin-roles/{id}`, con el permiso estricto `netskope:admin_inventory_read` (no lo otorgan `netskope:read` ni `access:manage`; lo tienen `netskope_admin` y el administrador de plataforma) y lecturas auditadas con conteos y nombres de filtro, sin valores. Vista: «Administradores» en el menú de Netskope (`/netskope/admins`).

**Ids negativos (2026-10-14).** Los 16 roles predefinidos del tenant tienen `roleId` negativo (de -17 a -1) y los administradores que los tienen lo referencian igual en `role.value`; los 16 roles personalizados usan ids positivos. El cliente, las rutas (`/admin-roles/{id}` y el filtro `role`) y los tests aceptan cualquier entero. Una primera versión rechazaba los negativos y la capa fallaba en cada sync (aviso «Con avisos» en el inventario).
