---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-05
---

# Trabajo diferido y decisiones retiradas

**Reorganizado:** 2026-10-03, por decisión del dueño del proyecto.
Este archivo conserva los 16 ítems aparcados, los 10 retirados y los
antecedentes diferidos que salieron del backlog visible. No constituyen
trabajo priorizado ni autorizan una implementación. Las observaciones del
tenant y los conteos conservan su fecha original; no son comprobaciones nuevas.

El [trabajo activo](TO_IMPLEMENT.md) sigue siendo la fuente de prioridades,
dependencias y criterios de cierre. Lo entregado está en
[IMPLEMENTED.md](IMPLEMENTED.md). Archivar una idea no elimina código,
contratos, evidencia ni migraciones aplicadas.

## Cuándo volver al tracker activo

- **Aparcado:** comprobar la condición de entrada de la fila y contar con
  prioridad explícita del dueño. Mover la fila al tracker activo con el mismo
  ID, evidencia fechada y estado Listo, Verificar o Externo según corresponda.
  Retirarla de este archivo para conservar una sola definición vigente.
- **Retirado:** mantener el ID como decisión histórica. Una nueva aprobación
  de alcance requiere un ID nuevo que enlace la decisión anterior.
- **Idea sin ID:** no es una tarea. Registrar alcance, fuente, condición de
  entrada y criterio de cierre antes de incorporarla al trabajo activo.

Cumplir una condición técnica no da prioridad automática ni amplía el alcance
más allá de CyberArk y Netskope. Las referencias desde tareas activas a este
archivo sólo explican dependencias o decisiones; no reactivan lo archivado.

## Aparcados — sujetos a evidencia y prioridad

### Conexiones — Personas, Cobertura y Riesgos (2026-09-29)

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `CONN-INFRA-001` | **Aparcado** | **Cobertura combinada de infraestructura.** Cruzar una población autoritativa de servidores/activos con observaciones frescas de scanners aprobados; exponer cobertura individual, unión, intersecciones y brechas. | Falta elegir y contratar la fuente autoritativa del denominador. Wiz, Tenable y Cortex no están en el alcance actual y no autorizan todavía endpoints, objetos ni relaciones. Reactivar sólo con esa población y al menos un contrato de scanner aprobado. | Identificadores estables y reglas de match documentados; ninguna identidad universal por IP inferida; fuentes aisladas; reconciliación completa segura; métricas con desconocidos/frescura y drill-down explicable; regresiones de permisos y retiros falsos. |
| `CONN-REPO-001` | **Aparcado** | **Cobertura y riesgo por repositorio.** Una fila canónica por repositorio, con cobertura, findings, frescura y detalle por fuente sin fijar el modelo a proveedores concretos. | Falta una fuente SCM autoritativa (GitHub/GitLab/Bitbucket u otra) y contratos de señales de seguridad. Reactivar cuando estén aprobados el universo esperado y al menos una fuente de observación. | ID estable por organización/repositorio; denominador auditable; findings conservan fuente; columnas por proveedor son proyección, no esquema; permisos y frescura explícitos. |

### CyberArk — funcionalidades diferidas

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `SAFE-PLAT-001` | Aparcado | Safes asociadas a una plataforma | Probe 2026-09-10 y re-probe 2026-10-01: el endpoint no filtra por plataforma en este tenant (4 plataformas consultadas devuelven el mismo total de 434; shape `{count, value}`). No se ingiere ninguna relación desde él. | Reactivar únicamente con confirmación de CyberArk de un endpoint alternativo o comportamiento corregido |
| `ONB-001` | Aparcado | Reglas de onboarding automático | El endpoint responde `501 Feature has been turned off` en este tenant. | Reactivar únicamente si el tenant habilita la funcionalidad |
| `REQ-001` | Aparcado — sin uso actual | Cola dual control de Privilege Cloud (incoming requests PAM, no Access Requests) | **Validado 2026-10-01:** endpoint y permiso confirmados (`GET /PasswordVault/API/IncomingRequests`, `onlywaiting`/`expired`: `200` con la credencial existente; cola vacía, 0 solicitudes incluidas expiradas). **Decisión de producto 2026-10-01:** no se implementa por ahora por falta de uso real; alcance decidido sin cambios (sólo lectura, sin `Reason`, sin confirmar/rechazar). Se retoma si el uso de dual control aparece. | Vista operativa de sólo lectura con denominador/frescura y tests de exclusión de motivos |
| `LDAP-001` | Aparcado | Directorios y mappings LDAP del Vault | El endpoint responde `500` y no hay evidencia de soporte en esta instancia SaaS. | Reactivar únicamente con confirmación de soporte de CyberArk |
| `ACC-GRP-001` | Aparcado | Grupos de cuentas (reconcile/change conjunto) | Las 436 Safes reales se probaron y ninguna usa esta feature. | Reactivar únicamente ante un tenant o entorno con grupos poblados |
| `LINK-001` | Aparcado | Cuentas vinculadas (logon / reconcile) | Las variantes documentadas responden `404` en este tenant. | Reactivar únicamente con endpoint confirmado por soporte de CyberArk |
| `DEP-ACC-001` | Aparcado | Dependientes CPM (servicios/tareas Windows) | Las variantes documentadas responden `404` en este tenant. | Reactivar únicamente con endpoint confirmado por soporte de CyberArk |

### Sincronización modular — capas, política por fuente y observabilidad (2026-10-03)

| ID | Estado | Trabajo / alcance | Criterio de cierre |
|---|---|---|---|
| `SYNC-WORKER-001` | **Aparcado** | Proceso `python -m app.worker` que corre sólo coordinador y scheduler, sin HTTP (mismo repo, misma cola; no es un microservicio). | Se reactiva si un sync pesado o un reinicio de la API afectan a la operación; requiere su unidad systemd y nota en `deployment.md`. |

### Netskope — funcionalidades diferidas (evidencia de 2026-09-22)

| ID | Estado | Trabajo | Validación previa / siguiente paso | Criterio de cierre |
|---|---|---|---|---|
| `NSK-DEM-ALR-001` | Aparcado — sin reglas configuradas ni contrato de consulta | **Alertas y reglas DEM read-only.** `alert/rules` respondió `200` con colección vacía; `rules/entities` respondió `400` sin el contexto requerido. | Reactivar cuando exista al menos una regla configurada y estén versionados los schemas de request de `alerts/getalerts` y parámetros de entidades. Receivers/templates permanecen fuera de la primera versión. | Agregados por regla/estado/severidad y entidades afectadas; geolocalización sólo país/región agregada; sin crear/editar reglas o receivers. |

### Netskope — funcionalidades diferidas (evidencia de 2026-09-22)

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `NSK-UBA-001` | Aparcado | **Riesgo de usuario (UCI).** Distribución UCI y anomalías UBA. | **Decisión cerrada:** sólo distribución agregada por bandas y ventana; no almacenar/listar score por persona. **Re-probe 2026-10-01:** `ubadatasvc/user/uci` responde `404` y requiere licencia Advanced UEBA; reactivar si el tenant habilita la funcionalidad. | Agregados con denominador/frescura; nunca escribir UCI ni exponer identidad individual. |
| `NSK-SPM-001` | Aparcado | **SaaS Security Posture (SSPM).** Score, apps monitoreadas y cambios recientes. | **Re-probe 2026-10-01:** `spm/saas_posture_score`, `spm/apps` y `spm/inventory` responden `404` en este tenant; reactivar si el tenant habilita SSPM. | Score Netskope mostrado tal cual con fecha/frescura; no se mezcla con Postura PAM. |

### Okta — requiere acceso a su API (2026-10-14)

Decisión del dueño (2026-10-14): hoy Okta se usa únicamente como proveedor OIDC de
inicio de sesión; leer grupos, administradores o logs exige integrar su API, que no
está disponible. Todo este bloque queda aparcado sin trabajo previo.

**Condición de entrada:** el dueño dispone de acceso a la API de Okta (service app de
sólo lectura, `OKTA-API-001`) y fija su prioridad. Al reactivarlas se mueven a
`TO_IMPLEMENT.md` con el mismo ID, y `OKTA-API-001` pasa a Externo hasta recibir la
credencial.

| ID | Estado | Trabajo | Alcance decidido / dependencia | Criterio de cierre |
|---|---|---|---|---|
| `ACCESS-UI-003` | **Aparcado** | **Editar el mapeo grupo de Okta → rol desde la UI eligiendo grupos reales.** | El backend (tabla, adopción, techo, auditoría) ya existe; falta la lista de grupos del proveedor para no depender de texto libre. | Selector de grupos reales, sin nombres tipeados; E2E y regresión de la adopción. |
| `ACCESS-OIDC-FRESHNESS-001` | **Aparcado** | **Revocación/frescura de autorizaciones OIDC.** | Identidad estable `issuer + subject`; reconciliación read-only de membresías; al retirar un rol se incrementa la versión de autorización y se invalida la sesión. Fallo de Okta no concede privilegios nuevos. | Una baja de grupo deja de autorizar sin esperar un nuevo login; checkpoint y auditoría sin guardar tokens ni payloads completos. |
| `OKTA-API-001` | **Aparcado** | **Service app Okta de sólo lectura, separada del cliente OIDC interactivo.** | Solicitar `private_key_jwt` y scopes mínimos `okta.users.read`, `okta.groups.read`; sumar `okta.roles.read`/`okta.logs.read` sólo para sus tareas. Limitar resource sets a los grupos de Custodia. | Credencial configurada como secreto externo; probe registra sólo status, forma, conteos y paginación; nunca claves ni valores personales. |
| `OKTA-DIR-001` | **Aparcado** | **Inventario de grupos Custodia y membresías.** | Sólo grupos de una allowlist/prefijo acordado; lectura, sin altas/bajas. Relación grupo → rol por ID/configuración exacta. | Detecta grupo desconocido, rol inexistente, miembro sin mapping y drift; aislamiento por `source_system`; sin escritura remota. |
| `OKTA-ADMIN-001` | **Aparcado** | **Inventario de administradores y roles Okta.** | Requiere `okta.roles.read`; no se mezcla con administradores internos ni Netskope. | Vista read-only de principal, rol e IDs de recurso; permiso `access:oidc_mappings_read`; sin mutaciones. |
| `OKTA-AUD-001` | **Aparcado** | **Cambios de grupo/rol desde System Log.** | Requiere `okta.logs.read`; cursor durable, retención 180 días, allowlist de tipos de evento, IDs y tiempos; excluir request/debug payloads. | Ingesta incremental idempotente, revocación conectada a `ACCESS-OIDC-FRESHNESS-001` y auditoría consultable con permiso estrecho. |

### Home — mejora visual diferida

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `HOME-WHEEL-X` | **Aparcado — horizonte muy futuro** | **Escalado del Home por áreas cuando una órbita plana deje de alcanzar.** La raíz muestra áreas y, al elegir una, la misma órbita muestra sus herramientas; Personas/Custodia continúa en el centro, la lista conserva el catálogo completo y un breadcrumb más “Volver a áreas” hacen explícito el nivel. Taxonomía organizativa propuesta: **Data Security** → CyberArk, Netskope, BigID; **Endpoint** → Tenable One, Proofpoint, Cortex, Cloudflare WAF; **Cross-area** → Wiz, Google SecOps, Okta. Cada nivel distribuye sus nodos con `360° / N`; si una sola área supera 8 herramientas, pagina dentro de esa área sin rotación automática ni reducción indefinida de nodos. | Es una solución futura de navegación, no aprobación de integraciones ni afirmación de relaciones técnicas entre proveedores. Hoy sólo CyberArk y Netskope están en alcance y BigID es un placeholder planned; Tenable, Proofpoint, Cortex, Cloudflare WAF, Wiz, Google SecOps y Okta no deben aparecer ni generar workspaces hasta contar con decisión y contrato propios. JumpCloud y Cloudflare ZTNA quedan fuera de esta taxonomía hasta una decisión explícita. Las áreas expresan propiedad organizativa, no procedencia de datos. Mantener orden DOM/teclado independiente de la profundidad visual, RBAC por destino, logos oficiales sólo en el nivel herramienta, iconos neutrales para áreas, ambos temas, Axe y reduced motion. | Reactivar sólo cuando existan destinos aprobados en al menos dos áreas o el catálogo plano alcance más de 8 herramientas autorizadas. Antes de código: validar la taxonomía con el dueño de producto y producir un prototipo HTML/CSS sin dependencias ni datos inventados. Cierre exige navegación área → herramienta y retorno por teclado, deep links estables, lista completa siempre disponible, estado anunciado por lector de pantalla, cero exposición de herramientas sin contrato y pruebas de overflow/Axe/reduced-motion en desktop. |

### Métricas y decisiones de producto pendientes

| ID | Estado | Trabajo | Dependencia | Criterio de cierre |
|---|---|---|---|---|
| `METRIC-GEO-001` | Aparcado | **Mapa geográfico.** | **Decisión cerrada:** sólo país/región agregados entregados directamente por una fuente autorizada; nunca coordenadas personales ni inferencia desde IP/texto. DEM puede reactivarlo si `NSK-DEM-ALR-001` confirma esos campos. | Procedencia, denominador y frescura visibles; cohortes pequeñas se suprimen. |

### Arquitectura modular de despliegue

La dirección recomendada es modularizar por responsabilidad y contrato de
integración, no por herramienta comercial. `frontend`, `backend` y `migrate`
ya son separaciones útiles. Un conector de CyberArk PAM, SIA, Identity
Administration o Netskope sólo debería convertirse en un servicio Docker
independiente cuando necesite permisos de red distintos, ciclo de despliegue
propio, escalado independiente o aislamiento de fallos. Cada módulo debe
exponer un contrato interno mínimo, no compartir secretos por volumen y
persistir a través de la capa de repositorios definida por Custodia.

| ID | Estado | Trabajo | Condición de entrada | Criterio de cierre | Referencia |
|---|---|---|---|---|---|
| `MOD-DOCKER-001` | Aparcado | Separar la ingesta por fuente en servicios desplegables propios. | **Decisión cerrada:** mantener un backend y entrypoints aislados hasta que una fuente necesite red, despliegue, escalado o aislamiento de fallos distinto. BigID no se incorpora. | Reactivar sólo al cumplirse un criterio objetivo; entonces cada módulo se reinicia sin afectar lecturas de otras fuentes y no comparte secretos por volumen. | idea de sesión `1168724` |

## Retirados — decisiones de no implementación

### CyberArk — funcionalidades diferidas

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `NSK-UBA-003` | Retirado | Cruce «UCI bajo con acceso privilegiado en PAM» (Netskope↔CyberArk) | — | Retirado por decisión del dueño (2026-10-14): no se mezcla el UCI de Netskope con PAM, y el borde entre ambas plataformas permanece aislado por `source_system`. Las anomalías UBA por usuario ya están entregadas (`NSK-EXP-UEBA-001`) |
| `BE-ERR-001` | Retirado | Handler central para los `except ValueError` de `api/routes/` | Medido 2026-10-14: 18 bloques en 8 archivos | Cerrado sin implementar según su propio criterio: el mismo `ValueError` se traduce a 400 (Netskope), 404 (preferencias), 409 (reglas de negocio, p. ej. último administrador) o 422 (validación de entrada) según la ruta, y a menudo conviven 409 y 404 en la misma. Unificarlos cambiaría contratos observados. Reabrir sólo con un ID nuevo si aparece una excepción de dominio con un único status |
| `BE-TYPE-001` | Retirado | Tipado estático (mypy/pyright) acotado a `cyberark/pam/` | Piloto 2026-10-14: mypy 2.4 sobre 67 archivos, 42 errores, 149 de 284 funciones con tipo de retorno | Cerrado sin adoptar. ~30 errores salen de un único hueco: el pool se crea con `row_factory=dict_row` pero se anota `AsyncConnectionPool` (filas tupla), y tiparlo bien toca ~395 anotaciones del backend por invarianza de genéricos. El piloto encontró un defecto real (cancelación de una tarea de Safe en `ingestion.py`, corregido con test) y dos o tres inconsistencias menores sin corregir: `date` frente a `datetime` en `review_finding`/`update_finding`, y `max()` sobre valores posiblemente `None` y una asignación `str \| None` a `str` en `pam_mapping.py`. Reabrir con un ID nuevo si se decide el refactor del tipo del pool |
| `BE-VALID-001` | Retirado | Modelos pydantic para las respuestas de los clientes de integración | Evaluado 2026-10-14 sobre el cliente Access (el más chico y estable: `get_assets` + `access_mapping.py`, sin escribir el modelo) y su dato real: 7 assets, `workflow_status` vacío y `port` nulo en los 7 | Descartado: el cliente ya falla claro ante la forma del sobre (objeto, `assets[]` de objetos, `nextToken` no nulo) y `access_mapping.py` exige `assetId`; los defaults por campo (`_text`, `_bool`, `_string_list`) son el contrato observado, con tests que lo fijan. Un modelo estricto fallaría con campos que el tenant real envía vacíos o nulos, y uno laxo sólo movería esos helpers a otro archivo y sumaría una capa sobre `services/*_mapping.py`, que es lo que el criterio excluye. No hay un caso real de formato inesperado que lo justifique; el payload crudo no se guarda, así que tampoco se puede saber si esos campos llegan ausentes, nulos o vacíos. Reabrir con un ID nuevo si un cambio de formato real de CyberArk o Netskope pasa inadvertido |
| `FE-VALID-001` | Retirado | Validación de runtime (zod/valibot) de las respuestas de `lib/*-api.ts` | Evaluado 2026-10-14 sobre `chains-api.ts`, el dominio propuesto para el piloto (sin instalar la dependencia) | Descartado: los tipos de Cadenas ya salen del OpenAPI del backend (`chains-api.generated.ts`) y `verify:chains-types` falla en `npm run verify` si el contrato cambia sin regenerarlos, así que el chequeo de tipos en compilación ya cubre ese dominio. Frontend y backend se despliegan juntos, de modo que un desajuste de forma en producción no es un escenario que el runtime atrape antes que el gate. Una dependencia nueva de runtime duplicaría esa validación sin aportar. Reabrir con un ID nuevo si aparece un dominio sin tipos generados o un desajuste real entre el despliegue y el cliente |
| `AIM-001` | Retirado | Inventario AIM de aplicaciones | — | Retirado del producto por decisión de alcance. Se conserva la migración histórica, pero ya no se sincroniza, almacena en el modelo activo ni se expone en la API/UI |

### P2 — ampliaciones que requieren contrato de CyberArk

| ID | Estado | Trabajo | Validación previa | Criterio de cierre | Fuente |
|---|---|---|---|---|---|
| `CONN-002` | Retirado | Inventario manual de connectors PSM/SIA y su capacidad operativa | **Decisión cerrada:** no crear un inventario manual paralelo sin fuente autoritativa. Custodia enlaza observabilidad existente; CPU/RAM no se presentan como dato de CyberArk. | Reactivar como un ID nuevo únicamente cuando exista contrato real de Connector Manager y dueño del dato. **2026-10-01: contrato localizado y validado → nueva tarea `CMGR-001`.** | — |
| `AIM-002` | Retirado | Métodos de autenticación AIM | — | Retirado junto con el catálogo AIM de aplicaciones; no se implementará mientras la funcionalidad permanezca fuera de alcance | — |
| `REC-001` | Retirado | Metadatos de recordings PSM | **Decisión cerrada:** Custodia no ingiere recordings ni sus metadatos. `SESS-001` cubre únicamente agregados operativos no personales. | Fuera de alcance; nunca `Play recording`, archivos, SessionID, IP, RiskScore ni IncidentDetails | [contratos](../architecture/integration-contracts.md) |
| `PAM-USR-002` | Retirado | Detalle PAM por usuario (`GET /API/Users/{id}`) | **Decisión cerrada:** emails adicionales, teléfonos, dirección y `personalDetails` quedan fuera del inventario. | `PAM-USR-001` cubre el estado necesario sin PII | [contratos](../architecture/integration-contracts.md) |

### Métricas y decisiones de producto pendientes

| ID | Estado | Trabajo | Dependencia | Criterio de cierre |
|---|---|---|---|---|
| `OKR-001` | Retirado | **KR sin fuente calculable.** | **Decisión cerrada:** no implementar métricas de clasificación/depuración o HA hasta que exista fuente; la UI declara “no disponible” y no inventa equivalencias. | Reactivar con un ID nuevo por KR cuando fuente, fórmula, denominador y frecuencia estén documentados. |
| `OKR-002` | Retirado | **KR de Jira/SOC.** | **Decisión cerrada 2026-09-26:** no integrar Jira/SOC. Reactivar con un ID nuevo sólo si aparece una necesidad operativa concreta. | No mostrar porcentajes ni datos simulados de Jira/SOC. |
| `COMPLIANCE-001` | Retirado | **Equivalencia con el reporte oficial de CyberArk.** | **Decisión cerrada 2026-09-26:** no buscar equivalencia. La métrica propia de Custodia se considera más útil y conserva su fórmula, fuente, denominador, ventana y etiqueta explícita; no se presenta como el reporte oficial ni como rotación. | Mantener pruebas de cálculo y procedencia; cualquier comparación futura requiere un ID/caso de uso nuevo. |

### IA en Custodia (fuera del roadmap activo)

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `AI-001` | Retirado | **Pregunta en lenguaje natural → Cadenas/filtros.** | `CHAIN-004` cubre el caso sin LLM. No se envían nombres ni inventario a un proveedor externo en el alcance actual. | Reactivar con un ID nuevo sólo si existe contrato corporativo de IA y gobierno de datos aprobado. |
| `AI-002` | Retirado | **Resumen explicado de una cadena o un cambio.** | Fuera de alcance por la misma decisión de `AI-001`; usar explicaciones deterministas basadas en conteos. | No implementar con LLM en el alcance actual. |

## Backlog diferido: no priorizar todavía

Estas ideas pueden ser valiosas, pero hoy agregarían complejidad sin mejorar la
decisión diaria de un manager. Solo deben volver al roadmap cuando exista un
contrato de datos y una pregunta operativa concreta.

- Licencias: no inferir consumo desde usuarios, miembros o cuentas. El conteo
  de `safe_members` no es un KPI de asientos. La conciliación Standard vigente
  usa la intersección `EPVUser` con roles Privilege Cloud y se muestra como
  “Licencia Standard” en Cadenas → Usuarios PAM y en Identidades → Usuarios
  (este último sólo por UUID coincidente). No presentarla como facturación.
- Rotación de credenciales: no presentar frescura de inventario como rotación.
- CPU, RAM, disco, servicios o certificados: enlazar observabilidad existente;
   no crear un segundo inventario de hosts en Custodia. `CONN-002` fue retirado;
   sólo se reconsidera con un ID nuevo, contrato real y dueño del dato.
- Targets/workspaces/conectores SIA, Connector Health y Session Intelligence:
  los **target sets de SIA** y el **inventario de Connector Manager** ya tienen
  contrato localizado y validado (`SIA-TGT-001`, `CMGR-001`, 2026-10-01); los
  workspaces de SIA y Session Intelligence siguen esperando contrato, permisos
  y caso de uso aprobado.
- Renombrado de Safes y traducción de nomenclatura: soporte va a entregar el
  mapeo de nombres. Al llegar, evaluar un nombre de display sobre
  `cyberark_safe_metadata` (sin tocar `safe_name` de CyberArk, para no romper
  joins por nombre) más una capa de nomenclatura reutilizable sobre
  `lib/format.ts` + `status-glossary.tsx`. No es una capa i18n completa.
- PDF, animaciones complejas y nuevos gráficos: priorizar primero filtros,
  denominadores, fecha de actualización y navegación al dato fuente.
- Orquestación remota desde Custodia (idea, 2026-09-12): disparar acciones sobre
  el servidor destino de un PSM (ej. "actualizar Windows en el puerto tal")
  sin login manual, posiblemente vía un agente instalado en el endpoint.
  Es un dominio distinto al de un CMDB de solo lectura: requeriría agente en
  cada host, canal de control autenticado, cola/orquestador de jobs, RBAC de
  "quién puede ejecutar qué en qué máquina", logging de ejecución remota y
  modelo de amenaza propio (un agente que ejecuta comandos remotos es un
  vector de ataque mayor si se compromete el control plane). Antes de
  diseñar nada custom, revisar qué expone CyberArk PSM/SIA en materia de
  ejecución remota para reusar en vez de reinventar. No tocar sin decisión de
  producto explícita y sin tratarlo como una fase separada de "Custodia Ops".
- Librerías de frontend evaluadas el 2026-09-25 y descartadas por ahora
  (las que sí entraron son `FE-DATA-001` y `FE-API-001`):
  - **TanStack Table:** las tablas ya paginan y filtran del lado del
    servidor, y no hay un bug concreto que lo justifique. Reconsiderar solo
    si una tabla necesita selección múltiple, columnas configurables o un
    sorting complejo que hoy no se pueda mantener.
  - **React Router:** `use-workspace-route.ts` acaba de incorporar deep links
    con tests (Cadenas `CHAIN-003`). Reconsiderar solo si aparecen bugs de
    ruteo repetidos, y en ese caso migrar de forma incremental.
  - **TanStack Virtual:** todo inventario grande pagina en el servidor (por
    ejemplo, los ~9000 usuarios Netskope nunca se renderizan juntos).
    Reconsiderar si una vista necesita renderizar miles de filas.
  - **Redux, SQLAlchemy/SQLModel, Next.js, un kit de UI completo o un
    repositorio genérico:** no resuelven un problema actual. Además
    contradicen la arquitectura: psycopg explícito, FastAPI sin SSR,
    componentes propios y SQL separado por fuente (`AGENTS.md`).
  - **react-hook-form, zod, nuqs, date-fns/dayjs, cmdk, sonner, respx:** no
    resuelven un dolor medido. Hay unos 3 formularios de administración, el
    estado en la URL depende de la decisión sobre React Router, hay pocas
    fechas y ya existen búsqueda global, toasts propios y mocks de httpx en
    los tests.
  - **APScheduler/Celery:** la cola durable con advisory locks por fuente
    (`sync_queue.py`, `sync_coordinator.py`) es propia a propósito;
    reemplazarla perdería el aislamiento por fuente.
  - **ESLint con `react-hooks`:** esta conclusión del 2026-09-25 fue superada
    por la medición posterior del 2026-09-26. El piloto vigente es
    `TOOL-LINT-002`; esta nota se conserva sólo como antecedente histórico.
  - La lista de pilotos que sí se van a probar está en "Calidad del gate y
    pilotos de librerías".
