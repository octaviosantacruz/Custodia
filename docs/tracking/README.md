---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-09
---

# Cómo usar el tracking

## Triángulo de estado: dos documentos + Jira

Ya no existe un tercer documento de traducción manual para Jira
(`JIRA_BACKLOG.md` se retiró el 2026-09-26). La épica de Jira **"CMDB DS
Hub"** (`SECOPS26-807`) y sus tareas/subtareas ya están escritas en lenguaje
llano, sin códigos internos, pensadas para gente sin acceso al repositorio.
El cruce de una sesión futura es directo entre dos puntas:

| Documento | Uso | Se actualiza cuando… |
|---|---|---|
| [TO_IMPLEMENT.md](TO_IMPLEMENT.md) | Backlog canónico técnico: pendiente, bloqueado o priorizado, con IDs. | Nace, cambia de prioridad o se desbloquea trabajo. |
| [IMPLEMENTED.md](IMPLEMENTED.md) | Índice del trabajo cerrado: una línea por sección con sus IDs. El detalle (entrega, commit y evidencia) vive en [`done/`](done/), un archivo por periodo. | Se completa una entrega verificable: sección nueva en el archivo de `done/` del periodo en curso y una línea en el índice. |

Un ítem no debe estar activo en dos documentos. Al cerrarlo, retirarlo de
`TO_IMPLEMENT.md` y registrar sólo el cierre resumido en `done/` (con su línea en
`IMPLEMENTED.md`). `TO_IMPLEMENT.md` abre con un mapa por dominio: leer sólo la
sección que se va a tocar.

## Cómo cruzar contra Jira sin un tercer documento

1. Leer el estado actual de la épica y sus hijos con el MCP de Jira
   (`getJiraIssue` / búsqueda por `parent = SECOPS26-807`).
2. Usar la tabla de referencia cruzada de abajo para ubicar, por cada ticket
   de Jira, a qué ID(s) de `TO_IMPLEMENT.md`/`IMPLEMENTED.md` corresponde.
3. Comparar sólo tres cosas por ítem: estado (Hecho/En curso/Bloqueado ↔
   Done/In Progress/To Do), y si la descripción en Jira sigue siendo fiel a
   la fila del ID técnico.
4. Si un ID técnico nuevo aparece en `TO_IMPLEMENT.md` sin ticket, crear la
   tarea de Jira (agrupada por tema, no 1 a 1 con cada ID) y sumar la fila a
   la tabla de abajo.
5. Si un ticket de Jira ya no tiene ningún ID vivo en `TO_IMPLEMENT.md`
   (todos se cerraron), pasarlo a Done y mover su fila de la tabla al bloque
   "Cerrados".

**Regla de escritura para Jira:** nunca usar los códigos cortos (`PENTEST-003`,
`NSK-ALR-001`, `CHAIN-010`, etc.) en el título o la descripción visible de un
ticket — sólo en esta tabla de referencia interna. Los tickets son para gente
sin acceso al repo.

## Tabla de referencia cruzada (actualizada 2026-10-11)

### Hecho

| Ticket Jira | IDs técnicos que cubre |
|---|---|
| `SECOPS26-808` | `CORE-PAM` (inventario Safes/usuarios/roles/plataformas) |
| `SECOPS26-813` | `CORE-AUTH`, `PENTEST-001/002/004/005/006/007/008/009/010/011/012` |
| `SECOPS26-819` | `CORE-SOURCES` (`SIA-RES-001`, `SIA-CONN-001`, `SIA-STRONG-001`, `ID-001`) |
| `SECOPS26-823` | `CORE-CATALOGS` (`SYS-001`, `PSM-001`, `PLAT-002`, `PLAT-003`, `PAM-USR-001`, `ACCESS-001`) |
| `SECOPS26-827` | `CORE-UI` (`SRCH-001`, `MOD-001`–`005`, `AUD-A11Y-001/002`, `AUD-UI-001`) |
| `SECOPS26-832` | `CORE-OPS` (migraciones, despliegue, `database_credentials`) |
| `SECOPS26-840` | `AUD-API-002` |
| `SECOPS26-845` | `AUD-PERF-001` |
| `SECOPS26-850` | `AUD-PERF-003` |
| `SECOPS26-855` | `SIA-001` (decisión: no se separa del menú PAM) |
| `SECOPS26-858` | `INT-002` (cerrado 2026-10-01; probe de throttling autorizado) |
| `SECOPS26-869` | `REQ-001` (aparcado sin implementar: sin uso actual; endpoint y permiso validados) |
| `SECOPS26-871` | `ONB-001`, `LDAP-001`, `ACC-GRP-001`, `LINK-001`, `DEP-ACC-001` |
| `SECOPS26-879` | `MOD-DOCKER-001` (aparcado por decisión; cerrado 2026-10-01) |
| `SECOPS26-881` | `CONN-002` (retirado; cerrado sin implementar el 2026-10-01) |
| `SECOPS26-883` | `NSK-DEV-001/003/004`, `NSK-DUP-001`, `NSK-EVT-001`, `NSK-CHG-001` |
| `SECOPS26-887` | `NSK-ALR-001`, `NSK-VER-001`, `NSK-FLT-001` |
| `SECOPS26-888` | `CHAIN-010`, `CHAIN-007` |
| `SECOPS26-906` | `SAFE-PLAT-001` (aparcado); `REC-001` y `PAM-USR-002` retirados |
| `SECOPS26-911` | `AI-001`, `AI-002` (retirados) |
| `SECOPS26-912` | `BE-CFG-001`, `FE-A11Y-001`, `TEST-PROP-001`, `BE-RETRY-001`, `TOOL-LINT-001` |
| `SECOPS26-873` | `RISK-001`, `POSTURE-REFRESH-001`, `RISK-ENT-001` |
| `SECOPS26-949` | `ID-002` |
| `SECOPS26-943` | `NSK-IPSEC-001` (vista retirada por `NSK-STEER-RET-001`) |
| `SECOPS26-909` | `VIEW-006`, `VIEW-008` |

### En curso

| Ticket Jira | IDs técnicos que cubre |
|---|---|
| `SECOPS26-836` | `PENTEST-003` |
| `SECOPS26-862` | `CPM-001` (implementado); la subtarea `SECOPS26-916` sigue abierta para los fallos de política |
| `SECOPS26-941` | `SIA-TGT-001` (código y vista entregados; confirmar primera sincronización persistida) |
| `SECOPS26-890` | `TEST-PG-001`, `TOOL-LINT-001`, `FE-DATA-001`, `FE-API-001`, `E2E-STALE-001`, `MOD-FE-001`, `TEST-NSK-001`, `CONN-TEST-001`, `ARCH-LAYERS-001/002`, `FE-AUD-001…008` (cerrados); `NSK-E2E-TIME-001`, `FE-A11Y-MEASURE-001` y `ACCESS-LOCAL-001` (verificación en curso) |
| `SECOPS26-938` | `CONN-001` y `CONN-NAV-001` (cerrados); `CONN-RISK-001` (bloqueado por contrato de findings) |
| `SECOPS26-954` | `ACCESS-UI-001` (fases 1–3 entregadas; fase 4 en curso) |

### Pendiente / bloqueado

| Ticket Jira | IDs técnicos que cubre |
|---|---|
| `SECOPS26-860` | `SIA-DIAG-001` |
| `SECOPS26-865` | `CA-AUD-001` |
| `SECOPS26-867` | `SESS-001` |
| `SECOPS26-875` | `AUD-EXT-001` |
| `SECOPS26-877` | `REL-001` |
| `SECOPS26-916` | `ACC-FAIL-001` (desbloqueado; falta aprobar los campos específicos) |
| `SECOPS26-889` | `NSK-WEB-001`, `NSK-APP-001`, `NSK-NPA-001/002`, `NSK-AUD-001`, `NSK-UBA-001`, `NSK-SPM-001`, `NSK-AI-001`, `NSK-AA-001`, `NSK-UBA-003`, `NSK-ADEM-SCORE-001`, `NSK-LIC-001`, `NSK-DEM-ALR-002`, `NSK-ER-001`, `NSK-DEM-VALIDATE-001`, `NSK-ADEM-WINDOWS-001`, `NSK-ADEM-TIME-001`, `NSK-DEM-ALR-001`, `NSK-XMET-002` (`NSK-POL-001` y `NSK-DLP-001` cerrados) |
| `SECOPS26-907` | `NSK-DEV-006`, `NSK-CFG-001`, `NSK-EB-001` |
| `SECOPS26-908` | `CHAIN-006` (`CHAIN-008`, `CHAIN-012` y `UXB-009` cerrados) |
| `SECOPS26-910` | `METRIC-GEO-001`, `SAFE-CLASS-001` (`OKR-001`, `OKR-002` y `COMPLIANCE-001` retirados) |
| `SECOPS26-948` | `RISK-REC-001` |
| `SECOPS26-939` | `PAM-GRP-001` |
| `SECOPS26-940` | `MAINT-001`, `UX-COPY-001`; `UX-SYNC-001` (cerrado), `NSK-PERF-001` (benchmark pendiente) |
| `SECOPS26-942` | `CMGR-001` |
| `SECOPS26-944` | `NSK-GRAPH-DEV-001` |
| `SECOPS26-945` | `NSK-API-001`, `NSK-SCOPE-REQ-001` (`NSK-PROBE-V3-001` cerrado; permisos pendientes: `NSK-RBAC-001`, `NSK-AUD-001`, `NSK-NPA-001/002`, `NSK-CFG-001`, `NSK-POLCFG-PROBE-001`, `NSK-GRAPH-POL-001`, `NSK-DEM-MET-001`) |
| `SECOPS26-946` | `NSK-GRP-001` (API entregada; la vista queda por ahora en Jira, sin ID técnico activo) |
| `SECOPS26-947` | `PAM-PSM-001` |
| `SECOPS26-950` | `BE-STREAM-001`, `BE-TRACE-001` (prioridad baja) |

### Sin ticket en Jira (comprobado 2026-10-02)

Quedan fuera de Jira los estudios del API de Okta (`OKTA-API-001` y sus
dependientes, incluido `ACCESS-OIDC-FRESHNESS-001`): el dueño indicó que no
pedirá esa API hasta demostrar primero el valor del producto y no administra
Okta. `HARN-RUN-001` corresponde al harness de agentes, no a una capacidad de
la CMDB. Los estados `Candidato`, `Aparcado` y `Retirado` permanecen sólo en
`TO_IMPLEMENT.md` por diseño. El resto de los IDs activos está agrupado en los
hijos de esta tabla; los hijos pueden incluir trabajo entregado y residual,
desglosado en sus comentarios.

## Dónde guardar el contexto

- Contratos, allowlists y límites entre fuentes: `../architecture/`.
- Procedimientos de operación: `../operations/`.
- Evidencia histórica cerrada: fuera del repositorio; no duplicarla en el
  tracker.

El tracker debe enlazar contexto; no copiar sus tablas ni recontar la misma
evidencia.
