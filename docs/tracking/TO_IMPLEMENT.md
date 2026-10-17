---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-15
---

# Por implementar en Custodia

**Última revisión:** 2026-10-08 (auditoría integral UI/UX, ruido y rendimiento: `UX-AUD2-001`…`026`). Anterior 2026-10-04 (cierre operativo `SYNC-TASK-001`/`002`: migraciones 078/079 aplicadas y scheduler observado con las tres tareas Netskope y las dos PAM completadas; detalle en `IMPLEMENTED.md`). El contraste transversal y cierre de `DOCS-TRACK-001` del 2026-10-01 se conserva en `IMPLEMENTED.md`.
**Barrido anterior:** 2026-09-29 (DEM, Conexiones y navegación; el historial conserva los barridos anteriores de seguridad).
**Contraste transversal anterior:** contra `d947b37`; pendientes operativos separados de implementaciones entregadas, sin afirmar readiness de producción.
**Código revisado:** contraste anterior hasta `d947b37`; métricas Netskope contrastadas el 2026-10-02 contra `491ffe3` y los cambios AA del árbol compartido. No es auditoría integral de seguridad ni validación de producción.
**Propósito:** fuente central y actualizable del trabajo activo y sus dependencias.
El inventario de trabajo cerrado está en [`IMPLEMENTED.md`](IMPLEMENTED.md).
Los aparcados, retirados e ideas diferidas están en
[`BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md); vuelven aquí sólo con evidencia
y prioridad explícita del dueño, siguiendo la regla de reactivación del archivo.

Los documentos de arquitectura, producto, operaciones y referencia conservan
el contexto y la evidencia. Este archivo concentra el estado, el orden y el
criterio de cierre. Si otro documento contradice el estado de una tarea, este
tracker tiene precedencia para el trabajo activo y debe actualizarse junto
con el cambio. Todo trabajo activo —incluidos descubrimientos priorizados en
planes, revisiones UX y checklists operativos— debe tener aquí un ID y estado.
Los aparcados y retirados tienen su única fila vigente en BACKLOG_ARCHIVE.md;
los documentos de contexto enlazan al ID en el archivo correspondiente.

## Mapa del documento

El archivo es largo: leer sólo el dominio que se va a tocar.

| Dominio | Secciones |
|---|---|
| Orden y reglas del documento | [Cómo mantener este documento](#cómo-mantener-este-documento) · [Orden recomendado](#orden-recomendado) |
| CyberArk — PAM, SIA, Identity y contratos | [P0 — confiabilidad y validaciones pendientes](#p0--confiabilidad-y-validaciones-pendientes) · [Candidatos priorizados con contrato documentado](#candidatos-priorizados-con-contrato-documentado) · [PAM — señales de limpieza para depuración (2026-10-01)](#pam--señales-de-limpieza-para-depuración-2026-10-01) · [Identidades — simplificación de roles (2026-10-03)](#identidades--simplificación-de-roles-2026-10-03) · [P2 — ampliaciones que requieren contrato de CyberArk](#p2--ampliaciones-que-requieren-contrato-de-cyberark) · [Barrido REST Privilege Cloud Standard (2026-09-10)](#barrido-rest-privilege-cloud-standard-2026-09-10) · [Alcance de licencia del tenant (2026-09-10)](#alcance-de-licencia-del-tenant-2026-09-10) · [Catálogo de fuentes API (solo lo licenciado)](#catálogo-de-fuentes-api-solo-lo-licenciado) · [Evidencia de UI SIA observada (2026-09-10)](#evidencia-de-ui-sia-observada-2026-09-10) · [Administración de acceso local y Okta](#administración-de-acceso-local-y-okta) |
| Netskope — métricas, DEM/ADEM, políticas y equipos | [Netskope — Postura y replanteo de vistas (aprobado 2026-10-10)](#netskope--postura-y-replanteo-de-vistas-aprobado-2026-10-10) · [Netskope — ideas priorizadas (investigación 2026-09-22)](#netskope--ideas-priorizadas-investigación-2026-09-22) · [Reestructuración de métricas por fases — `NSK-METRICS-001` (2026-10-02)](#reestructuración-de-métricas-por-fases--nsk-metrics-001-2026-10-02) · [Advanced Analytics e ingestión de volumen (autorizado 2026-10-02)](#advanced-analytics-e-ingestión-de-volumen-autorizado-2026-10-02) · [Revisión de equipos sin eventos — `NSK-DEVREV-001` (aprobado 2026-10-05)](#revisión-de-equipos-sin-eventos--nsk-devrev-001-aprobado-2026-10-05) · [SDK y DEM — contrato aportado 2026-09-26](#sdk-y-dem--contrato-aportado-2026-09-26) · [Requieren scope nuevo y probe](#requieren-scope-nuevo-y-probe) |
| Conexiones, Personas, Cadenas y Home | [Conexiones — Personas, Cobertura y Riesgos (2026-09-29)](#conexiones--personas-cobertura-y-riesgos-2026-09-29) · [Cadenas v2 — "¿Qué querés buscar?" (CyberArk + Netskope)](#cadenas-v2--qué-querés-buscar-cyberark--netskope) · [Home — mejora visual diferida](#home--mejora-visual-diferida) · [Visibilidad de capacidades ya entregadas (2026-10-03)](#visibilidad-de-capacidades-ya-entregadas-2026-10-03) |
| UX/UI y frontend | [Auditoría de frontend (2026-10-11)](#auditoría-de-frontend-2026-10-11) · [Orden de vistas por pregunta (2026-10-11)](#orden-de-vistas-por-pregunta-2026-10-11) · [Auditoría integral UI/UX, ruido y rendimiento (2026-10-07)](#auditoría-integral-uiux-ruido-y-rendimiento-2026-10-07) · [Revisión UX exploratoria (2026-10-10)](#revisión-ux-exploratoria-2026-10-10) · [Auditoría UI/UX — revisión read-only (2026-09-27)](#auditoría-uiux--revisión-read-only-2026-09-27) · [Presentación de inventarios tabulares (2026-10-03)](#presentación-de-inventarios-tabulares-2026-10-03) · [Oportunidades de producto y mantenibilidad — revisión estática y UX (2026-10-01)](#oportunidades-de-producto-y-mantenibilidad--revisión-estática-y-ux-2026-10-01) · [Editar vista v2 (Métricas CyberArk y Netskope)](#editar-vista-v2-métricas-cyberark-y-netskope) · [Verificación de cascada de estilos — `FE-CSS-002` (2026-10-09)](#verificación-de-cascada-de-estilos--fe-css-002-2026-10-09) · [Navegación por casos de uso — prioridad inmediata (2026-09-27)](#navegación-por-casos-de-uso--prioridad-inmediata-2026-09-27) |
| Sincronización, datos y plataforma | [Sincronización modular — capas, política por fuente y observabilidad (2026-10-03)](#sincronización-modular--capas-política-por-fuente-y-observabilidad-2026-10-03) · [Capacidad y retención de datos — pendiente de definir (2026-10-05)](#capacidad-y-retención-de-datos--pendiente-de-definir-2026-10-05) · [Reproducción del timeout E2E Netskope (2026-10-02)](#reproducción-del-timeout-e2e-netskope-2026-10-02) |
| Seguridad y auditoría | [Auditoría de seguridad — revisión tipo pentest (2026-09-11)](#auditoría-de-seguridad--revisión-tipo-pentest-2026-09-11) · [Observaciones de auditoría técnica (2026-09-11)](#observaciones-de-auditoría-técnica-2026-09-11) |
| Calidad, operación y documentación | [Calidad del gate y pilotos de librerías (consenso 2026-09-25)](#calidad-del-gate-y-pilotos-de-librerías-consenso-2026-09-25) · [Operaciones y publicación](#operaciones-y-publicación) · [Limpieza y afinado general — `MAINT-001` (2026-10-01)](#limpieza-y-afinado-general--maint-001-2026-10-01) · [Mejora de la documentación del repo — `DOCS-*` (2026-10-08)](#mejora-de-la-documentación-del-repo--docs--2026-10-08) · [Mantenimiento del tracker y Jira (2026-09-30)](#mantenimiento-del-tracker-y-jira-2026-09-30) |
| Criterios y límites | [Criterio simple para nuevas métricas](#criterio-simple-para-nuevas-métricas) · [Límites transversales](#límites-transversales) · [Reglas propias de postura PAM — oportunidad aprobada para documentar](#reglas-propias-de-postura-pam--oportunidad-aprobada-para-documentar) · [Métricas y decisiones de producto pendientes](#métricas-y-decisiones-de-producto-pendientes) |

El trabajo cerrado está en el índice [`IMPLEMENTED.md`](IMPLEMENTED.md) y su detalle en `done/`.

## Cómo mantener este documento

Estados:

- **Listo**: puede implementarse con contratos y datos actuales.
- **Verificar**: existe un reporte previo, pero el código cambió; reproducir
  antes de modificar.
- **Bloqueado**: depende de otra tarea identificada por ID. La dependencia debe
  figurar en la fila; no se usa este estado para pedir una decisión abierta.
- **Externo**: el alcance está decidido, pero falta una licencia, permiso,
  payload, confirmación o acción de un equipo/plataforma fuera del repositorio.
- **En curso**: implementación iniciada y aún no cumple todos sus criterios.
- **Candidato**: piloto ya especificado y sin decisiones pendientes, pero aún
  fuera del orden activo; puede promoverse a **Listo** sin rediseñarlo.
- **Aparcado** (archivo diferido): no entra al roadmap activo porque la capacidad no existe en el
  tenant, no tiene fuente verificable o todavía no cumple una condición de
  entrada objetiva. Sólo se reactiva con la evidencia indicada en la fila.
- **Retirado** (archivo diferido): decisión explícita de no implementar dentro del alcance actual.

Regla de higiene: queda prohibido como estado activo "pendiente de decisión"
o equivalente. Toda decisión interna debe cerrarse en este documento como
**Listo** o **Candidato** aquí, o **Aparcado** / **Retirado** en
`BACKLOG_ARCHIVE.md`. **Candidato** identifica
un piloto ya especificado que todavía no entró al orden de ejecución; no es un
bloqueo ni requiere otra definición de producto. **Bloqueado**
siempre nombra uno o más IDs predecesores; si lo que falta viene de un proveedor
o del tenant, el estado correcto es **Externo**.

Al comenzar una tarea, cambiarla a **En curso** y enlazar rama/issue si existe.
Al terminarla, retirarla de las tablas activas y mover su evidencia a
[`IMPLEMENTED.md`](IMPLEMENTED.md), con commit y fecha. No duplicar el mismo
pendiente en varios roadmaps: allí se conserva únicamente el enlace al ID.

## Orden recomendado

Cada ID identifica una sola tarea para siempre; no reutilizar IDs retirados.
Las tablas de referencias pueden enlazar IDs, pero no crear otra asignación.
Un cierre de código con validación operativa pendiente usa un ID residual
distinto. El harness nativo OpenCode conserva contexto y entregas en sesiones;
el planner solicita aprobación para registrar **En curso** al autorizar la
corrida y mueve el cierre sólo después de verificar/revisar y aceptación humana.
No es una máquina de estados determinista ni un sandbox del host.

Contraste 2026-09-30: `CPM-001`, `CA-AUD-001`, `SESS-001`, `NSK-SDK-001`,
`NSK-POL-001` y `CHAIN-012` conservaban trabajo real sin entregar.
No se encontró persistencia de la allowlist CPM, agregados de sesiones,
auditoría externa de cuentas, evaluación de adopción del SDK, catálogo de
políticas observadas ni mapa de columnas Netskope (`NSK-POL-001` y `CHAIN-012`
se cerraron después; ver `IMPLEMENTED.md`).
La existencia de widgets/presets/alertas no cumple esos criterios por sí sola.

1. **Prioridad inmediata de producto:** ordenar la reestructuración de
   métricas Netskope por fases en `NSK-METRICS-001` (solicitud del dueño,
   2026-10-02). Primero semántica de capturas/denominadores y registro de
   contratos; después piloto AA verificado y expansión. Poblaciones/Top-N y registro
   contractual entregados; siguen oferta/carga y validación externa del piloto AA. El último batch de UX
   (`UX-*`, `DOCS-PORTAL-001`, `FE-MOTION-001`) está cerrado (ver
   `IMPLEMENTED.md`). `FE-MOTION-002` queda como **Candidato de prioridad
   baja**: el Command Center aporta el caso de uso concreto para un POC de
   continuidad espacial, pero no justifica adopción global ni desplaza
   trabajo de producto.
2. **Conexiones:** `CONN-001` está cerrado (piloto Identity + Netskope, ver
   `IMPLEMENTED.md`). Por decisión del dueño (2026-10-11), se retiró la vista
   agregada «Cobertura de cliente» del menú y del buscador: su URL redirige a
   Personas, donde se conserva la evidencia individual. El cálculo y contrato
   del backend siguen disponibles. Se aclaró la presentación de UCI en Netskope
   (2026-10-11): «Usuarios con señales de riesgo», índice de confianza con escala
   y explicación, más variación semanal legible; sin cambios de captura ni permisos. `CONN-NAV-001` también está cerrado y `CONN-RISK-001` sigue
   a la espera de un contrato adicional de findings.
3. `NSK-POL-001` está desbloqueado (`NSK-DEV-001`, `NSK-XMET-001` y
   `NSK-ALR-001` cerrados); su oferta de métricas se coordina con las fases
   de `NSK-METRICS-001`, sin duplicar el catálogo observado. `ACCESS-BREAKGLASS-001` queda deliberadamente
   fuera de este orden (**Candidato**, no bloqueado): no tiene sentido
   implementarlo antes de acercarse al cierre de `PENTEST-003`.
4. Continuar el probe read-only `NSK-DEV-006` (la corrida de
   `NSK-RBAC-PROBE-001` se completó el 2026-10-01: grupos `200`; roles/admins
   `403`). Un `2xx` promueve automáticamente su consumidor a **Listo**;
   `401/403` lo vuelve **Externo** y `404` lo **Aparca** con evidencia.
5. Las tareas de la API de Okta están aparcadas (ver
   [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md)): hoy Custodia sólo usa Okta como
   proveedor OIDC.
6. Implementar inventarios/métricas Netskope sólo para familias confirmadas
   por los probes. Las mutaciones remotas continúan fuera de alcance.
7. Auditoría UI/UX read-only del 2026-09-27: `UX-AUD-001`…`013` cerrados
   (ver `IMPLEMENTED.md`); el detalle vive en "Auditoría UI/UX — revisión
   read-only (2026-09-27)".

## Conexiones — Personas, Cobertura y Riesgos (2026-09-29)

La decisión de producto y sus límites están en
[`integration-contracts.md`](../architecture/integration-contracts.md#conexiones-correlación-transversal-entre-herramientas).
`Conexiones` describe correlaciones entre herramientas; no reemplaza el
aislamiento por `source_system` ni representa conexiones de red. Personas es
una vista dentro de ese paraguas. Toda métrica debe publicar denominador,
frescura, desconocidos y versión; riesgo no es la suma directa de findings.

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `CONN-RISK-001` | **Bloqueado por al menos un contrato adicional de findings** (`CONN-001` ya cerrado) | **Riesgo correlacionado entre herramientas.** Mantener findings originales, normalizar severidades de forma versionada y deduplicar sólo con claves verificadas por entidad/control/componente/ubicación. | `cyberark_findings` actual no es un motor neutral multi-proveedor y no debe ampliarse por inferencia. `0 findings` no significa `sin riesgo` si falta cobertura. | Se documentan escalas, clave de correlación, vigencia y fórmula; UI separa cobertura de riesgo y permite llegar a evidencia autorizada; duplicados no inflan conteos; snapshots reproducibles y tests de incompatibilidad/ambigüedad. |

## Cobertura de destinos — inventario centralizado de Privilege Cloud y SIA (aprobado 2026-10-14)

Alcance fijado por el dueño: el inventario de destinos es el lugar centralizado de **Privilege Cloud y SIA** y sirve
para **seguir cómo avanza la implementación de SIA**. Custodia pasa a ser la fuente de verdad del inventario; la
planilla es un formato de entrada y salida. Capacidades: acceso Platform por SIA, acceso DBA por SIA, ZSP (acceso
passwordless, todavía no habilitado: sólo declarado) y Acceso (`Tengo llegada`). No hay rotación. En SIA,
`CA_SIA` es el acceso Platform y `CA_DBA` el acceso DBA (política que conecta como el usuario SYS). La población
esperada es la lista de destinos del inventario (denominador explícito). Observado y declarado se muestran juntos;
una IP en PAM o SIA que no está en el inventario se lista aparte como «Sin inventariar».

| ID | Estado | Trabajo | Dependencia / decisión | Criterio de cierre |
|---|---|---|---|---|

## Mantenimiento del tracker y Jira (2026-09-30)

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|

## Navegación por casos de uso — prioridad inmediata (2026-09-27)

### Decisiones de producto comunes a los cuatro batches

- **Personas es una capacidad transversal de Custodia**, no un workspace de
  CyberArk PAM. Su marca es neutral (favicon/marca Custodia), aunque sus datos
  provengan de CyberArk o Netskope. Moverla visualmente al área `admin`/Custodia
  no la convierte en una función administrativa ni amplía/restringe permisos.
- Hay dos conceptos que hoy pueden confundirse: **Personas** es la correlación
  read-only entre herramientas de `CHAIN-010`; **Usuarios de Custodia** es el
  directorio local/OIDC, roles y permisos que hoy vive en `/admin/access`.
  Esos nombres deben permanecer distintos en navegación, búsqueda y ayuda.
- El orden editorial común es **CyberArk → Netskope → Custodia** cuando se
  enumeran plataformas. La excepción deliberada es el Inicio: la entrada
  transversal **Personas** aparece primero, separada bajo “Vista transversal”,
  y debajo se muestran las plataformas en ese orden. BigID continúa último,
  deshabilitado y “Próximamente”; no se crea integración ni nodo personal.
- No cambiar contratos backend, inferir relaciones entre fuentes ni agregar
  endpoints por conveniencia visual. Se conservan la ruta canónica
  `/chains/person`, los deep links existentes, los estados
  `matched`/`reference`/`ambiguous`/`unmatched`, el vínculo exacto 1-a-1 por
  correo y la referencia SIA por nombre ya documentados.
- No incorporar Motion/Framer Motion, Fuse.js, un router ni un kit visual en
  esta iniciativa. Usar el catálogo de workspaces, Lucide, CSS y las
  primitivas existentes. Toda dependencia nueva requeriría un piloto separado
  y medición de supply chain/bundle.

| ID | Estado | Resultado de producto | Alcance de implementación | Criterio de cierre |
|---|---|---|---|---|

### Secuencia de entrega al agente obrero

Para cada batch: releer `AGENTS.md`; inspeccionar `git status --short` y no
pisar cambios ajenos; citar en el reporte el comportamiento previo observado;
implementar sólo el ID asignado; no comenzar el siguiente; correr primero los
unit/e2e enfocados y finalmente `npm run verify`; entregar `git diff --check`,
`git status --short`, lista de archivos, conteos exactos y cualquier test
preexistente reproducido sobre HEAD. No hacer commit ni push salvo instrucción
expresa del dueño. El orquestador verifica el diff y las suites antes de mover
el ID a `IMPLEMENTED.md`.

## Auditoría de seguridad — revisión tipo pentest (2026-09-11)

Revisión de código (sin modificar archivos ni generar commits) orientada a
qué reportaría un pentest formal. Verificado con HTTP real contra la app
(`httpx.AsyncClient`/ASGI), no sólo lectura de código. `npm audit` (raíz y
frontend) y `pip-audit` (backend): 0 vulnerabilidades de dependencias.
**No presentar el proyecto como "sin vulnerabilidades" todavía.**

### P0 — bloqueantes antes de un pentest o de producción

| ID | Estado | Hallazgo validado | Próxima acción | Criterio de cierre |
|---|---|---|---|---|
| `PENTEST-003` | Riesgo operativo aceptado transitoriamente — secreto de sesión endurecido en código (2026-09-12); retiro del modo híbrido programado tras el pentest (2026-10-01) | MFA, HTTPS forzado, cookies `Secure`, rotación de `APP_WRITE_TOKEN`/`AUTH_BOOTSTRAP_TOKEN` y aislamiento de Postgres/puerto 8000 no se pueden verificar sólo leyendo el repositorio. La condición crítica de secreto de sesión débil sí quedó mitigada: `AppSettings` rechaza valores menores a 32 bytes y placeholders conocidos; `.env.example` ya no proporciona un valor copiable. **Decisión del responsable de producto:** MFA y HTTPS/HSTS quedan delegados a Okta Access Enterprise (OIDC) una vez que esté en producción; el ambiente usa hoy `AUTH_MODE=hybrid`, riesgo aceptado durante la migración. **Actualización 2026-10-01 (dueño de producto):** Okta ya está implementado y en uso; el login local se conserva a propósito mientras corre el pentest externo (es parte de lo que se prueba). Al cerrar el pentest — estimado máximo 2 semanas — se retira el login local y el acceso queda sólo por Okta. | No implementar MFA/HTTPS propios en Custodia. Al cierre del pentest: confirmar la fecha, pasar a `AUTH_MODE=oidc` puro y mantener el checklist operativo: secreto aleatorio real, rotación de tokens técnicos, Postgres y `:8000` no expuestos. Rotar `SESSION_SECRET` al desplegar este hardening si existe cualquier duda sobre su valor actual; esto invalida sesiones existentes. | Reevaluar al cierre del pentest, cuando se pueda retirar el modo híbrido; hasta entonces sigue como riesgo operativo aceptado. |

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

**Antes de un pentest formal:** los cambios de código de `PENTEST-001`, `002`, `004` a `012` están registrados en `IMPLEMENTED.md`; no reabrir `008`, `009`, `010` ni `012` desde la narrativa histórica. `PENTEST-003` conserva únicamente los controles operativos: el secreto de sesión se endureció, pero los restantes son un riesgo aceptado transitoriamente hasta que Okta Access Enterprise esté en producción. Esto no demuestra hardening real de producción.

## Capacidad y retención de datos — pendiente de definir (2026-10-05)

| ID | Estado | Trabajo pendiente | Criterio de cierre |
|---|---|---|---|
| `DATA-CAP-001` | Listo | **Definir la estrategia de crecimiento al incorporar más herramientas.** El trabajo autorizado es el análisis y la propuesta; quedan por acordar retención, archivado, particionado y necesidad de almacenamiento analítico o NoSQL. No está aprobada una migración de tecnología ni la eliminación de historial. | Documento con ventanas por tipo de dato, conservación y recuperación de capturas, crecimiento y costo proyectados, consultas que deben seguir disponibles, alternativas comparadas y decisión del dueño antes de implementar. |

**Evidencia inicial — consulta de sólo lectura del 2026-10-05, hora de Asunción:**

- Base completa: **3,34 GB (3,11 GiB)**; no incluye backups ni WAL.
- Tablas de aplicación, incluido TOAST: **2,22 GB**; índices: **1,10 GB**.
- `netskope_device_snapshots`: **2,87 GB con índices**, aproximadamente el **86 %**
  de la base; **2.945.791 filas de 330 sincronizaciones**, desde el 23 de septiembre.
- `raw_safe_members_dump`: **207 MB**; inventario compartido
  `cyberark_inventory_objects`: **151 MB**; `netskope_dlp_alerts`: **33 MB**.
- Las capturas completas por corrida concentran el crecimiento. El número de
  herramientas debe analizarse junto con registros por fuente, frecuencia de
  sincronización y tiempo de conservación.
- Estimación orientativa del historial Netskope: **unos 7 GB por mes** si continúa
  el ritmo observado y se conserva todo. Es una extrapolación del espacio actual
  sobre el período de capturas, no una medición diaria ni una garantía de crecimiento;
  incluye espacio asignado e índices.

**A definir:**

1. Ventana de consulta inmediata y conservación total para inventario, capturas,
   auditoría y agregados; preservar decisiones humanas y trazabilidad.
2. Archivado de capturas antiguas: destino, formato, permisos, integridad,
   recuperación y efecto sobre drawers, comparaciones y reportes históricos.
3. Conveniencia de particiones por fecha e índices, según consultas y volumen;
   no asumir que particionar reduce por sí solo el almacenamiento.
4. Medición periódica de bytes, filas, crecimiento y latencia por fuente y tabla,
   con escenarios de más herramientas y distintas frecuencias de sincronización.
5. Si conviene mantener todo en PostgreSQL o sumar almacenamiento analítico,
   de objetos o NoSQL para algún caso concreto. La elección queda abierta y debe
   justificar costo operativo, consistencia, permisos y recuperación.

Este pendiente no autoriza purgas, cambios del historial append-only, nuevos
conectores ni movimiento de datos. No reemplaza las políticas específicas de
retención ya acordadas en otras tareas; cualquier cambio debe aprobarse.

## Observaciones de auditoría técnica (2026-09-11)

Este bloque convierte el informe de auditoría de solo lectura en trabajo
trazable. Los puntos están contrastados contra el código actual. **Verificar**
no significa que exista una vulnerabilidad: indica que falta una regresión,
una medición o una búsqueda exhaustiva antes de modificarlo.

### Seguridad y contrato de API

| ID | Estado | Hallazgo validado | Próxima acción | Criterio de cierre |
|---|---|---|---|---|
Sin tareas activas: cierres `AUD-API-002` y `AUD-DOC-001`/`002`/`003` en
`IMPLEMENTED.md`. Mantener documentos sincronizados no es un pendiente nuevo.

El informe no encontró TODO/FIXME antiguos, tests omitidos ni dependencias npm/pip
sin uso; no se agregan como tareas.

## Presentación de inventarios tabulares (2026-10-03)

Decisión del dueño: conservar las tablas como base de los inventarios
estructurados y mantener Personas tal como está presentada. El piloto de Safes
se completó y aceptó (ver `IMPLEMENTED.md`); las ideas opcionales de edición y
columnas alternas no forman parte del trabajo cerrado.

| ID | Estado | Trabajo / alcance | Validación previa | Criterio de cierre |
|---|---|---|---|---|
Sin tareas activas: `UX-TABLE-PRESENTATION-001` completado y aprobado (ver `IMPLEMENTED.md`).
Sin tareas activas: `UX-TABLES-001` cerrado con la fase 3 en `IMPLEMENTED.md`.

## Auditoría UI/UX — revisión read-only (2026-09-27)

Sin tareas activas: `UX-AUD-001`…`013` están cerrados (ver `IMPLEMENTED.md`).
La revisión fue de solo lectura sobre la app en ejecución (27 rutas, dark y
light, teclado, axe WCAG 2 A/AA, sin errores de consola). Límites que siguen
vigentes y no son tareas: no se abrieron diálogos de mutación ni guardados, no
se verificó el gating negativo de permisos con una sesión restringida, no hubo base
vacía real ni lector de pantalla. No reabrir lo verificado correcto:
`CompactSelect` (foco, Escape, scroll), `overscroll-behavior` del Safe table,
"Cargar 50 más" y la apertura/cierre repetida de drawers.

## Auditoría de frontend (2026-10-11)

Informe de un agente auditor, **validado contra el código el 2026-10-11** (HEAD `88e1fa97`): los ocho hallazgos eran reales y quedaron cerrados el mismo día (`FE-AUD-001`…`008`, detalle en [done/2026-10-11.md](done/2026-10-11.md)). La revisión adicional con datos reales (`FE-AUD-009`) se completó el 2026-10-13; alcance, límites y evidencia en [el informe](FE_AUD_009_REVIEW.md). Tres bugs corregidos; cinco hallazgos reproducidos se registraron como `FE-AUD-010`…`014` (todos cerrados). Regla común de cierre: un test por hallazgo, un commit por ID, sin cambiar la densidad ni el diseño de la vista.

Sin tareas activas: `FE-AUD-010`…`014` cerrados; detalle en [IMPLEMENTED.md](IMPLEMENTED.md).

Descartados por el auditor y confirmados como ya cubiertos: `UX-QA-004` (tablero guardado sin gráficos), `UX-COPY-001`, `NSK-IA-001`, `CA-IA-001`. `UX-QA-006` pasa a «reproducido con datos reales según el auditor» (evidencia en su carpeta de capturas, no revisada).

## Auditoría integral UI/UX, ruido y rendimiento (2026-10-07)

Recorrido con agent-browser sobre la app en ejecución (`:5173` build, sesión
admin, tema oscuro, 1600×1000): 45 rutas de CyberArk, Netskope, Conexiones y
Administración, más Command-K, notificaciones y selectores de Safes. Se midió el
tiempo de cada API con `performance` del navegador. Sin errores de consola. No se
guardó ninguna mutación. Límites: no se probó una sesión con permisos restringidos,
el tema claro ni una base vacía. Orden sugerido: bugs (001–006), después
rendimiento y, por último, reducción de ruido (015–026). La regla transversal
para ruido: un dato se muestra una sola vez por pantalla, y las aclaraciones
metodológicas van en `HelpHint`, no en texto fijo.

| ID | Estado | Trabajo y criterio de cierre |
| --- | --- | --- |

Los veintiséis criterios cerrados (001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 021, 022, 023, 024, 025 y 026) están en
[`IMPLEMENTED.md`](IMPLEMENTED.md).
El estado de cada criterio, la evidencia de verificación y el trabajo que falta
se conservan en [el checkpoint de esta auditoría](UX_AUD2_CHECKPOINT.md).
No cerrar el bloque completo mientras existan puntos parciales o pendientes.

## Revisión UX exploratoria (2026-10-10)

Revisión manual en `:5173` (rama `feat/netskope-dev`, sin mutaciones ni
sincronizaciones) validada después contra el código, sin ejecutar la app. Los
ítems **Listo** se confirmaron por lectura de código; **Verificar** necesita
dato real o ver la pantalla antes de tocar nada. El informe original vive fuera
del repositorio y no se conserva.

| ID | Estado | Trabajo y criterio de cierre |
| --- | --- | --- |
| `UX-QA-004` | Verificar | Netskope Métricas promete "agregados de alertas" y el layout por defecto **sí** los trae: `DEFAULT_NETSKOPE_DATA_WIDGETS` incluye `alerts_7d` y `DEFAULT_NETSKOPE_CHART_WIDGETS` incluye `alerts_by_type` (frontend y `netskope_dashboard_preferences.py`), y un E2E fija ese reset. Lo observado probablemente es una vista guardada del usuario sin esos bloques. Confirmar en la cuenta que lo reportó antes de tocar el texto o el layout. |
| `UX-QA-007` | Verificar | KR2 "Cobertura de conexiones migradas" ya declara numerador y denominador en su detalle (`dashboard-metrics.ts`); el rótulo sigue siendo ambiguo. Requiere decisión del dueño sobre si "KR2" pasa a código secundario, porque presets y vocabulario del equipo lo usan. |
| `UX-QA-008` | Verificar | Hallazgos PAM, "Evolución de la incorporación": siete ceros aislados (12 mayo–15 julio 2026) vuelven al nivel previo al día siguiente. El backend solo convierte a `null` lo que no es un entero válido y la gráfica ya dibuja `null` como hueco, así que los ceros vienen de CyberArk; no hay defecto de la gráfica. Confirmar con el dueño del tenant si es discontinuidad de la fuente. Tratar un `0` con descubiertas > 0 como "sin observación" exige decisión de producto y no se infiere. |

`UX-QA-001`, `002`, `003` y `005` se cerraron el 2026-10-10 (ver `IMPLEMENTED.md`). `UX-QA-006` se cerró el 2026-10-14 (ver `IMPLEMENTED.md`). Quedan los **Verificar** (`004`, `007`, `008`).

## Orden de vistas por pregunta (2026-10-11)

Criterio y mapas en [view-design.md](../architecture/view-design.md).

| ID | Estado | Trabajo y criterio de cierre |
| --- | --- | --- |
| `NSK-RTP-001` | Bloqueado — falta scope del token (2026-10-11; re-probe 2026-10-14: sigue `403`, el dueño lo está gestionando) | **Vista de políticas de protección en tiempo real.** Pedido del dueño: ver las políticas configuradas (Real-time Protection) en una vista propia. El probe del tenant respondió `403` en `policy/internetaccess/{rules,rules/applied,groups}` (ver `netskope-api.md`). Antes de construir: que el administrador del tenant habilite ese scope de lectura, repetir el probe, definir la allowlist de campos (sin datos sensibles) y registrar el contrato. | Probe `200` con el scope, contrato documentado, vista de sólo lectura con nombre, estado, acción y orden de cada regla. |
| `UX-IA-002` | Vigente | **Criterio «una vista, una pregunta».** Documentado en `view-design.md` con lista de control. Toda vista nueva o movida declara su pregunta y persona. |

## Reproducción del timeout E2E Netskope (2026-10-02)

| ID | Estado | Trabajo y criterio de cierre |
| --- | --- | --- |
| `NSK-E2E-TIME-001` | **Verificar** | Reproducir el timeout histórico de `NSK-POSTURE-UX-001` y medir el presupuesto acumulado de navegaciones, render y Axe. Las tres corridas actuales y las tres del baseline `7bfdcaf` pasan; no hay señal para atribuirlo al refactor ni para bisectar. El trace histórico vence durante la configuración del último análisis Axe, después de nueve navegaciones y análisis anteriores. No subir timeouts ni agregar retries: conservar aserciones y corregir la causa sólo con reproducción y cobertura. Evidencia y comparación en [netskope-metrics.md](../architecture/netskope-metrics.md). |

## P0 — confiabilidad y validaciones pendientes

Sin tareas activas: `INT-002` cerrado el 2026-10-01 (paginación confirmada
2026-09-10; probe de throttling autorizado por el dueño del tenant, sin `429`
hasta 100 concurrentes; evidencia en `IMPLEMENTED.md`). El espacio de IDs de
SIA no expone identificadores estables; el vínculo de personas se resolvió por
correo exacto 1-a-1 (`REL-001`, cerrado; ver `IMPLEMENTED.md`).

## Candidatos priorizados con contrato documentado

Estos endpoints están documentados por CyberArk. Antes de persistir o mostrar
datos se valida con un probe mínimo del tenant, los permisos efectivos y la
allowlist indicada; la documentación pública no sustituye esa validación.

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `CA-AUD-001` | Listo | Auditoría de CyberArk por cuenta | **Decisión cerrada:** sólo `Alert`, `Date`, `Action`, `ActionID` y `ClientID`; excluir `User`, `MoreInfo`, `Reason` y payload completo; retención 180 días; permiso nuevo `pam:audit_read`. Probar cuentas representativas antes de persistir. | Fuente append-only de sólo lectura, paginada si el tenant lo requiere, separada de `AUD-001`, purga por retención y sin textos potencialmente sensibles |
| `SESS-001` | Listo | Sesiones activas: resumen operativo sin detalle personal | **Decisión cerrada:** agregar únicamente conteos por estado/protocolo/plataforma en ventanas UTC de 1 h y 24 h; excluir usuario, target, IP, Session ID, texto libre, `RawProperties` y recordings; retención de agregados 90 días; permiso `pam:sessions_read`. | Vista de sólo lectura con denominador, ventana y actualización visible; tests prueban que los campos excluidos no se persisten ni salen por API |

## Identidades — simplificación de roles (2026-10-03)

Se priorizan dos análisis separados: membresía y permisos. La revisión
read-only de membresías ya se puede ejecutar con
`scripts/review_identity_role_memberships.py`: agrupa conjuntos directos
idénticos y cuentas referenciadas idénticas al recorrer todos los roles hijos.
No usa nombres/correos como claves, excluye conjuntos vacíos y caminos
incompletos, y termina ante ciclos. Las coincidencias no prueban duplicación
de permisos ni autorizan retirar roles.

| ID | Estado | Alcance | Condición de entrada / cierre |
| --- | --- | --- | --- |
| `ID-ROLE-PERM-001` | Externo | Contrato read-only de derechos administrativos y aplicaciones asignadas por rol de Identity. | El SCIM confirmado sólo entrega `id`, `displayName`, `members`, `meta` y `schemas`. Confirmar endpoint, permiso, paginación y allowlist mínima con el tenant; probe controlado y test contractual antes de sincronizar. No inferir derechos desde nombres, descripciones o membresías. |
| `ID-ROLE-REVIEW-001` | Bloqueado por `ID-ROLE-PERM-001` | Presentar candidatos de simplificación **por permisos** dentro de **Roles y grupos**, manteniendo dos subnav. La parte de coincidencia de miembros y de cuentas por todos los caminos pasó a `VIS-ROLE-CMP-001` (separación aprobada 2026-10-04). | Comparación determinística con procedencia, fecha y completitud; permisos deben incluir derechos, aplicaciones, alcance y condiciones. Mostrar diferencias y recorrido que sustenta cada candidato. La misma población sola nunca se etiqueta como duplicado de permisos; sin eliminación automática. |

## Sincronización modular — capas, política por fuente y observabilidad (2026-10-03)

Auditoría de `sync_coordinator.py`, `lifecycle.py` y los sincronizadores de
cada fuente. Se conserva lo que ya funciona (cola durable en Postgres, lock
advisory por fuente, lease con heartbeat, registro `SourceSpec`, retiro sólo
con corrida completa). Problemas a resolver: cada fuente es una función
todo-o-nada (p. ej. Identity mezcla usuarios, roles, consultas N+1 del
directorio y federaciones); no existe la noción de capa ni un estado
intermedio; el intervalo es único y global; el reloj de «vencida» parte del
último encolado, no del último éxito; no hay reintentos, backoff ni racha de
fallos; el tope de concurrencia está escrito en código.

| ID | Estado | Trabajo / alcance | Criterio de cierre |
|---|---|---|---|

## Visibilidad de capacidades ya entregadas (2026-10-03)

Revisión de capacidades que existen en backend o API y tienen poca presencia en
la UI. Verificado en el código: `GET /api/cmdb/netskope/devices/{id}/history`
no tiene consumidor en el frontend; `GET /api/accounts` existe y el cargador
`onLoadAccountsPage` está declarado en `safe-table.tsx` pero nunca se invoca;
`GET /api/lifecycle/retired` sólo alimenta un total en el tablero PAM. Se
agregan pocas vistas y se reutiliza lo existente. No se crean pantallas para
métricas, cumplimiento, duplicados, DLP, salud PAM ni recursos SIA, que ya
tienen representación. Mantener Personas y las dos subnav de Identidades.
Orden: las prioridades de este bloque quedaron cerradas
(`VIS-NSK-HIST-001`, `VIS-PAM-RET-001`, `VIS-PAM-ACC-001`, y
`VIS-ROLE-CMP-001` con su residual `VIS-ROLE-CMP-RES-001`; ver
`IMPLEMENTED.md`); el resto de las filas sigue intercalable.

| ID | Estado | Trabajo / alcance | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `VIS-PAM-PLAT-001` | Verificar | **Registros detrás de los conteos de catálogos técnicos de Plataformas**: algunos se muestran sólo como número. | Inventariar qué conteos no son navegables y qué registro hay detrás antes de proponer panel lateral; sólo atributos que ya persisten y no son secretos. | Lista de conteos no navegables con su fuente; si procede, panel lateral de sólo lectura con allowlist y tests de exclusión. |

**No se agregan, con motivo:** el catálogo de sitios DEM sigue como backend técnico
(decisión registrada en `NSK-DEM-VALIDATE-001`, además de externo hasta una
captura real); la búsqueda y la comparación entre ventanas de las políticas
observadas se suman al alcance de `NSK-POL-003` en lugar de abrir otro ID, y
esa comparación debe seguir rotulando «observadas en eventos», nunca
«configuradas».

## P2 — ampliaciones que requieren contrato de CyberArk

| ID | Estado | Trabajo | Validación previa | Criterio de cierre | Fuente |
|---|---|---|---|---|---|
| `CMGR-001` | Listo | **Inventario read-only de Connector Manager.** Pools y redes (nombre, descripción, conteos de componentes e identificadores, fechas), sin IPs ni valores de identificadores. | **Contrato validado 2026-10-01** (SDK oficial + probe autorizado): `GET /api/pool-service/pools` y `/networks` responden `200` (5 pools y 5 redes), paginación por `page`/`continuation_token` con `projection=EXTENDED`. Excluir identificadores y valores de red; ninguna mutación. | Catálogo read-only con fuente y frescura; allowlist sin hostnames/IPs; tests de exclusión y de paginación. |
| `SIA-UX-001` | Candidato, sin priorizar | **Mejoras de lectura y consistencia de la superficie SIA** (hallazgos del análisis 2026-10-02, sin implementar): (1) unificar la paginación de políticas con VMs/cuentas BD (hoy páginas numeradas vs acumulación); (2) eliminar la repetición entre fila expandida y panel lateral de la política; (3) distinguir «sin IP» de «sin cuenta con esa IP» en la vinculación; (4) mostrar frescura y cobertura por catálogo SIA; (5) reordenar «Recursos» sin mezclar orígenes, incluidos los target sets al sumarse; (6) revisar densidad de la fila (primer destinatario y reglas cortadas en 5). | Cada punto necesita revisión visual del dueño antes de implementarse; un scan Axe verde no certifica jerarquía. Mantener desktop, ambos temas y la regla de no confundir referencia por nombre con vínculo. | Una superficie por vez, con antes/después y pruebas E2E desktop; sin cambios de contrato ni de permisos. |
| `SIA-SET-001` | Candidato, sin priorizar | **Configuración de SIA (settings).** Catálogo read-only de los flags del servicio (grabaciones RDP/SSH, MFA caching, validación de certificado, etc.). | Probe 2026-10-01: `GET /api/settings` responde `200` con ~25 claves. Fijar alcance de exhibición como postura antes de implementar. | Vista read-only con fuente y fecha; sin secretos; tests de exclusión. |
| `SIA-DIAG-001` | Listo | Diagnóstico de sesiones SIA (errores de usuario/sistema, warnings y sesiones) | **Reactivado 2026-10-01:** fuente oficial encontrada (monitoreo de sesiones de Audit and Reports, filtro por aplicación SIA) y acceso de lectura confirmado con la credencial existente (probe read-only `200`, con sesiones SIA visibles). Alcance agregado y sin PII, igual que `SESS-001`: sólo estados, códigos y fechas. | Vista read-only de conteos por estado/código con denominador, ventana y frescura; tests de exclusión de campos personales. |
| `ACC-FAIL-001` | Externo — falta aprobación de los campos específicos (`SECOPS26-916`) | Cuentas con fallo de política/CPM vía `savedFilter` | `GET /API/Accounts?savedFilter=` documenta `PolicyFailures`, `FailedChange`, `FailedVerify`, `FailedReconcile`, `ScheduledFor*`; la dependencia de gestión de cuentas (`CPM-001`) ya está implementada. La aprobación de campos para estos hallazgos es una subtarea distinta. | Hallazgos con denominador y filtro al inventario; no secretos ni `platformAccountProperties` | [contratos](../architecture/integration-contracts.md) |
| `RISK-REC-001` | Externo — falta contrato de filtros y permiso del lado de CyberArk | **Recomendaciones detalladas y progreso de discovery de Risk Management.** Completar lo que `RISK-001` dejó fuera por contrato: (1) `GET /recommendations` y (2) `GET /recommendations/{type}/by-tags`, y (3) `GET /risk-posture/secure-standing-privilege/discovery`. La vista actual muestra como recomendaciones sólo las opciones tipadas que CyberArk incluye en cada `riskType`, vinculadas al catálogo de remediaciones. | Probe de implementación 2026-10-01: `/recommendations` sin el contrato de filtros respondió `400` y `/recommendations/{type}/by-tags` respondió `403` (el usuario de servicio no tiene ese permiso); `discovery` nunca se probó. Pedir a CyberArk/IAM el contrato de filtros y el permiso exacto de sólo lectura; después ejecutar un probe read-only con `scripts/probe_cyberark_risk_contract.sh` (sólo status, forma, claves y conteos) antes de implementar. Custodia no adivina parámetros. `/entities/{id}` queda excluido: trae atributos de identidades, cuentas y apps (ver la decisión sobre nombres de entidad). | Probe `2xx` con forma y paginación confirmadas; allowlist de campos extendida sólo con lo aprobado; sin snooze ni remediación remota; tests de exclusión de campos y de acciones remotas; los endpoints que sigan en `4xx` quedan documentados como Aparcado/Externo con evidencia. | Detect and Respond (licenciado) |
| `AUD-EXT-001` | Listo | Sesiones históricas y eventos de plataforma desde Audit and Reports | **Decisión cerrada:** sólo IDs opacos, tiempos UTC, protocolo, estado y códigos; excluir usuario, target, source/IP, recordings y textos libres; retención 180 días; permiso `pam:audit_read`. **Acceso confirmado 2026-10-01:** probe read-only autorizado `200` con la credencial existente; la licencia del tenant ya cubre la lectura. | Timeline read-only idempotente con allowlist, purga por retención y test de exclusión de campos | Audit and Reports (licenciado) |

## PAM — señales de limpieza para depuración (2026-10-01)

Análisis read-only autorizado contra el tenant (miembros, en vivo) y la
última sincronización (acceso a Safes y barrido de datos): 83 grupos, 482
membresías, **0 roles anidados** (los únicos miembros que no son usuarios son
cuentas integradas del Vault). La redundancia real está en grupos vacíos y
duplicados; el barrido sumó PSM huérfanos, plataformas sin uso y safes sin
acceso, y confirmó integridad sin inconsistencias.

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `PAM-PSM-001` | Externo — acción del dueño | **Limpieza operativa de servidores de sesión.** Revisar y dar de baja los PSM sin plataformas activas (10 de 13 en el barrido 2026-10-01). En uso: `UE-CYBERARK03` (37), `PSM_FO-CYBERARK-SRV` (16) y `EC2AMAZ-PCDGV9L` (3). | Confirmar con operación en la consola de CyberArk antes de ejecutar; sin cambios desde Custodia. | Baja ejecutada y re-verificada con el barrido (0 huérfanos; los PSM en uso siguen referenciados). |
| `PAM-GRP-002` | Candidato — depende de una fuente/clave verificable que identifique grupos administrados por Okta | **Detectar grupos de CyberArk cuyos miembros dependen de Okta.** Reutilizar la jerarquía de membresía ya ingerida en Custodia para generar candidatos de revisión y reducir el universo de grupos a depurar. | `PAM-GRP-001` ya ofrece análisis PAM de sólo lectura, pero no identifica por sí solo el origen Okta. Antes de cruzar fuentes, confirmar con IAM/Assertiva un identificador estable o una lista explícita aprobada; evaluar `OKTA-DIR-001` cuando se resuelva su bloqueo externo. No inferir dependencia por nombre ni usar coincidencias de nombre autorizadas sólo para otras vistas como evidencia de baja. | Reporte read-only con recorrido y procedencia de membresías, grupos identificados/no resueltos/ambiguos y completitud visible; validación humana de candidatos; ninguna baja automática ni escritura en CyberArk desde Custodia. |

## Barrido REST Privilege Cloud Standard (2026-09-10)

Fuente: árbol oficial
[REST APIs](https://docs.cyberark.com/privilege-cloud-standard/latest/en/content/webservices/implementing%20privileged%20account%20security%20web%20services.htm)
(`PasswordVault/API` Gen2 y `PasswordVault/WebServices` Gen1). No se inventaron
endpoints de SIA ni de Identity Administration a partir de este árbol.

**Ya cubierto por Custodia (no reabrir como feature):** Get all Safes, Get Safe
details, Search for a Safe, Get all Safe members, Get accounts (inventario
delgado), Get platforms (mapeo `general` + PSM), Get users / Get groups /
Get group details (objetos PAM), throttling `429` en transporte PAM.

**Descartado a propósito (no entra al tracker como implementación):**

- Mutaciones: Add/Update/Delete Safe, member, user, group, account, platform
  (activate/deactivate/duplicate/import/export) y onboarding rules.
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
anonimizado, allowlist y pruebas. Custodia centraliza visibilidad autorizada;
no reemplaza la licencia ni los controles de CyberArk; no solicita ni
conserva secretos, tokens, claves, recordings o payloads completos.

| Dominio | Fuente oficial | Qué aporta al CMDB / dónde profundizar | Límite vigente |
|---|---|---|---|
| Índice API | [CyberArk API docs](https://api-docs.cyberark.com/) | Mapa general y auth/rate limit. **Filtrar** por la licencia de arriba; ignorar tarjetas de productos no contratados | No tratar el hub como inventario de features del tenant |
| Access | [Access API](https://api-docs.cyberark.com/secure-access/docs/secure-access-api) | `GET /api/assets`: activos, protocolo, workspace y workflow; implementado (`ACCESS-001`, evidencia en `IMPLEMENTED.md`) | Distinto de Access Requests. `POST Get Secret` prohibido |
| Manage / PAM | [Manage REST](https://docs.cyberark.com/manage/latest/en/content/automation/rest-apis.htm) y [Privilege Cloud REST](https://docs.cyberark.com/setup/latest/en/content/privilege-cloud/webservices/implementing%20privileged%20account%20security%20web%20services%20.htm) | Safes, cuentas, plataformas, CPM/PSM, discovery PAM, health; candidatos `SYS-*` a `DEP-ACC-*` | En Manage, usar sólo APIs de Privilege Cloud / Identity / SIA. Ignorar CDS, SCA y Secure AI agents de esa misma página |
| Identity Administration | [Identity APIs](https://api-docs.cyberark.com/identity-docs-api) | Complemento del SCIM ya ingestado (`ID-001`) | Contrato SCIM del repo manda; PII mínima; sin joins por nombre |
| SIA | [SIA developer](https://docs.cyberark.com/setup/latest/en/content/privileged-access/hometileslps/dpa-lp-tile6.htm) y [SIA API docs](https://api-docs.cyberark.com/secure-infra-access) | Policies, targets, connectors, settings; contrato actual `/api/access-policies` | Primero `INT-002`; no inventar endpoints ni unir por nombre/email |
| Detect and Respond | [Manage risk](https://docs.cyberark.com/detect-and-respond/latest/en/content/risk-management/rm-lp.htm) · [roles](https://docs.cyberark.com/detect-and-respond/latest/en/content/risk-management/rm-support.htm) (la API en api-docs hoy pide login) | Riesgo por tipo/hallazgo/entidad, recomendaciones y remediaciones sugeridas, y progreso; contrato validado 2026-10-01 (`RISK-001`) | Sólo GET; sin snooze ni remediaciones remotas; el usuario de servicio ya cuenta con los roles del módulo |
| Audit and Reports | [Developer reference](https://docs.cyberark.com/audit-and-reports/latest/en/content/hometileslps/lp-tile5.htm) | Session Monitoring `/api/sessions` y SIEM query/events; `AUD-EXT-001` | Nunca pedir ni guardar URLs/archivos de recordings |
| Setup | [API authentication ISPSS](https://docs.cyberark.com/setup/latest/en/content/ispss-deployment/ispss/ispss-api-authentication.htm) | Token del plano compartido; inventario manual retirado ([`CONN-002`](BACKLOG_ARCHIVE.md)); la lectura automática de Connector Manager quedó validada (`CMGR-001`, 2026-10-01) | No copiar tokens. CCE / Connect cloud environments no está en Services |
| Flows | Servicio visible en el launcher; no hay candidato CMDB todavía | Automatización, no inventario | No inventar endpoints ni tratar Flows como fuente de cobertura |

**Fuera de licencia (no reabrir, aunque aparezca en api-docs):** Access
Requests, Cloud Discovery Service, Secure Cloud Access, Secure AI Agents,
Secrets Hub, Secrets Manager SaaS, Workspace delegation, Remote Access
(producto aparte de Access space), Discovery Context GraphQL (secrets /
workloads / AI agents), BYOK. [`REQ-001`](BACKLOG_ARCHIVE.md) (cola dual control de Privilege
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

## Administración de acceso local y Okta

Diseño aprobado e implementado en el worktree (2026-10-11):
[Usuarios, smartchip de Okta y representación de roles y permisos](../architecture/access-ui-proposal.md).
Revisada contra las fases 1 y 2 (`de7d723f`, `d3b2d9df`): reutiliza las
asignaciones con origen, mueve el mapeo editable al detalle del rol y limita el
chip a grupos observados. Explicita el trabajo backend para dominios opcionales
en roles compuestos. Implementa tabla por persona, ficha por cuenta, capacidades
legibles y vista previa, duplicación de roles, chips observados y edición del
mapeo por rol. La composición opcional conserva la herencia SQL existente;
no requiere migración. Se mantienen como pendientes del alcance original
la selección de recursos completos, la clasificación de capacidades sensibles
y la vista previa de pantallas, sin
presentar descripciones de permisos como garantía de acceso a una vista.

Decisión de arquitectura 2026-09-26: Custodia separa tres autoridades. Los
usuarios locales y los sujetos OIDC reciben roles internos de Custodia; los
grupos y administradores de Okta son objetos externos de sólo lectura; los
administradores/roles de Netskope son objetos de Netskope y nunca se equiparan
por nombre con los anteriores. Las relaciones externas usan IDs inmutables del
proveedor, no correo o nombre, salvo las dos excepciones de persona ya
sancionadas en `integration-contracts.md`.

| ID | Estado | Trabajo | Alcance decidido / dependencia | Criterio de cierre |
|---|---|---|---|---|
| `ACCESS-UI-001` | En curso — fases 1 a 3 hechas (2026-10-11) | **Administrar acceso desde la UI, no desde el código.** Aprobado 2026-10-11; diseño en [`access-ui-proposal.md`](../architecture/access-ui-proposal.md). Fase 1: roles por persona como chips; un rol `manual` convive con los de Okta y ningún login lo quita (migración 095). Fase 2: mapeo grupo → roles en PostgreSQL con adopción de `OIDC_ROLE_MAP_JSON` en la primera edición (migración 096). Fase 3: tabla por persona con «Gestionar» y chip de Okta con grupos observados; roles con capacidades legibles (lista plana, sin `domain:*`, «Datos por usuario» en DLP/UCI), «Duplicar como personalizado», asignaciones por rol y compuestos con áreas opcionales (un rol «sólo Netskope» ya no hereda PAM); textos del catálogo corregidos (migración 097). **Decisión 2026-10-11: la edición del mapeo de Okta sale de la UI** — sin SCIM Custodia no conoce los grupos reales y un nombre tipeado mal no otorga nada sin avisar; el rol muestra «Lo otorga en Okta» en sólo lectura. `PUT /api/access/oidc-group-roles` queda disponible por API y vuelve a la UI con `ACCESS-UI-003`. Reconstrucción aprobada: mapa de accesos a todo el ancho y editor de capacidades desde cero; diseño en [`role-access-design.md`](../architecture/role-access-design.md), con modos explícitos de permisos individuales y niveles vinculados, revisión de cambios y Okta en sólo lectura. Pendiente (fase 4): explicar qué grupo causó cada rol OIDC y la vista previa de vistas por permiso. | Decisiones: roles del sistema no editables (sólo duplicar); SCIM entra después como otro origen. | Cada fase con tests de autorización (techo, propio rol, último administrador), auditoría y E2E. |
| `ACCESS-LOCAL-001` | Verificar | **Validación residual de administración local separada de OIDC.** Las altas/desactivación, contraseña temporal, asignación acotada y revocación por cambio de contraseña/desactivación ya existen; no reimplementar. | Contrastar `user_admin.py`, rutas de usuarios y `user-admin.tsx` con los tests HTTP/RBAC y E2E. No existe una acción administrativa independiente de revocar sesiones; no agregarla por inferencia. | Regresión del flujo local completo y del secreto temporal efímero, aislamiento OIDC y auditoría/permisos. Si se solicita revocación independiente, delimitarla como trabajo nuevo autorizado. |
| `ACCESS-BREAKGLASS-001` | Candidato, sin priorizar | **Sigue postergado (2026-10-15, dueño):** hoy la única cuenta local se usa sólo para QA con agent-browser; el acceso de las personas es por Okta y no se amplía el uso local. **Cuenta local de emergencia para el paso a OIDC puro.** Postergado a propósito: no está bloqueado por otra tarea, pero no tiene sentido implementarlo antes de que `AUTH_MODE=oidc` puro esté realmente cerca (depende del cierre de `PENTEST-003`). | **Decisión cerrada 2026-09-26:** cuenta administrativa separada de los usuarios cotidianos, contraseña fuerte custodiada/recuperada mediante CyberArk PAM. El usuario del dueño del producto no será superadmin ni se usará como primera cuenta privilegiada. **Vía de acceso decidida 2026-09-26 (revisión de alcance):** Custodia es un dashboard de inventario interno, no una plataforma crítica; se descartó diseñar un segundo hostname/aplicación Cloudflare Access dedicado. Cloudflare Access hoy protege todo `custodia.itti.digital` sin excepción de `/api` (ver `docs/history/cloudflare-custodia-meeting.md`), así que la vía de emergencia es puramente API: una excepción puntual y auditada en la política de Cloudflare Access (Service Token o email único), acotada a esta cuenta, para poder autenticar por `curl`/API si el IdP corporativo está caído. No se crea infraestructura nueva del lado de Custodia. | Runbook de uso/rotación, alerta y auditoría en cada login, prueba de recuperación desde PAM, la excepción de Access configurada y documentada, y criterio para cerrar `PENTEST-003`. |

La vista de grupos mapeados y miembros observados en futuros logins se
implementó el 2026-10-03 (`ACCESS-OIDC-GROUPS-OBSERVED-001`). No cierra
`OKTA-DIR-001` ni `ACCESS-OIDC-FRESHNESS-001` (aparcados): sólo registra claims verificados
al iniciar sesión; no consulta las APIs de Okta ni reconcilia cambios entre
logins. El diagnóstico técnico de OIDC se mantiene únicamente por API.

## Netskope — Postura y replanteo de vistas (aprobado 2026-10-10)

Decisión del dueño (2026-10-10): crear una **Postura Netskope** con el mismo
patrón que la de CyberArk (Resumen · hallazgos agrupados por tipo · Tipos) y,
desde ahí, replantear Políticas y Experiencia digital. Steering se retiró el
mismo día (ver `IMPLEMENTED.md`). La fase 1 (`NSK-POSTURE-001`, cerrada) evalúa
los chequeos al leer sobre el inventario sincronizado, sin tabla propia ni
mezcla con `cyberark_findings`; cada conteo es la lista exacta del inventario
que abre su detalle. Las fases siguientes agregan chequeos al mismo catálogo.
`NSK-POL-RETHINK-001` (cerrada) movió Políticas a la pestaña Actividad de políticas de Postura.

| Prioridad | ID | Estado | Oportunidad | Validación previa / criterio de cierre |
|---|---|---|---|---|
| P2 | `NSK-INV-002` | Implementado (2026-10-13) | **Inventario: consulta, no clasificación.** Título «Inventario»; columnas Dispositivo · Usuario · Empresa · Señal (punto + tiempo relativo) · SO · Cliente; la fila se abre en una ficha corta (equipo, usuario, señal, experiencia ADEM del equipo con POP y puntaje, anomalías UEBA del usuario con `netskope:uba_read`) en vez del panel lateral; sin ID ni capturas. Postura agrupa los equipos sin señal por explicación de Netskope, de solo lectura; se retiró la clasificación manual (ver [diagnóstico de equipos](../architecture/netskope-device-review.md)). | Las anomalías UEBA no traen equipo (probe 2026-10-13: sin hostname ni ID de dispositivo; sólo IPs y propiedades libres, que no se usan), así que no se pueden repartir por equipo. Las alertas por equipo o usuario necesitarían capturar eventos de alerta con un campo de dispositivo: contrato nuevo a aprobar. Limpieza (2026-10-13): se retiraron las rutas de clasificación por equipo (`GET`/`PUT devices/{id}/review`, `accept-suggestion`) y los resúmenes DLP `incidents/summary` y `users/alerts/summary` (responden `410`). |
| P2 | `NSK-POLICY-004` | Implementado (2026-10-12) y pausada del menú (2026-10-13, decisión del dueño) | **Alertas DLP por política.** La vista deja de ser una tabla de alertas sueltas con usuario sin resolver y pasa a una fila por política (volumen de 30 días, últimos 7 contra los 7 anteriores, severidad, acción, última alerta) con los 5 incidentes recientes al abrirla: `GET /api/cmdb/netskope/dlp/policies`. Sin columna ni conteo de usuario (el `user_id` del evento nunca resuelve contra el inventario). | «Qué cubre» cada política espera las reglas (`NSK-POLICY-003`); ahí también se podrá vincular el nombre de la política del incidente con su grupo. Los endpoints `users/alerts/summary` e `incidents/summary` ya no los usa la pantalla (candidatos a retiro). **Límite confirmado (2026-10-13):** el incidente no trae número ni ID de regla; sólo `dlp_policy` (nombre al momento del evento), `dlp_profile_name`, `dlp_rules[].dlp_rule_name` y `dlp_policy_hash`. Tras renombrar políticas en la consola, los incidentes nuevos traen el nombre nuevo y los viejos el anterior, así que agrupar por nombre parte la historia: no se puede mapear a Real-time Protection sin la lista de reglas (`NSK-POLICY-003`). La vista quedó **fuera del menú, de la guía y del selector de workspaces** (`catalog: false`); sigue abierta por URL `/netskope/dlp` con `netskope:dlp_read`. Se reactiva cuando haya reglas y se pueda agrupar por ID de regla, no por nombre. |
| P2 | `NSK-POLICY-002` | Recolección implementada (2026-10-12); falta el primer sync con la variable activa | **Grupos de políticas de Real-time Protection.** `GET policy/npa/policygroups` (los 8 grupos de la consola) se guarda como inventario (`netskope_policy_group`, migración `099`) dentro de `netskope_inventory`, con lectura `GET /api/cmdb/netskope/policy-groups`. Ver [grupos de políticas](../architecture/netskope-api.md). | Aplicar la migración `099`, activar `NETSKOPE_POLICY_GROUPS_PATH`, reiniciar y correr un sync. Después, la vista de políticas (grupos, incidentes por política) del rediseño de Alertas DLP. |
| P2 | `NSK-POLICY-003` | Externo — acceso a pedir al soporte de Netskope (2026-10-12) | **Reglas de cada grupo** (nombre, a quién aplica, destino, perfil DLP, actividad, acción). Ruta confirmada en el Swagger del tenant: `GET policy/internetaccess/rules` («List Internet Access Policy Rules»; filtro `jql` por `id`, `group_id`, `name`, `enabled`, `status`; `limit` máx. 1000). Hoy `403`, y el Swagger la marca *«still under development and not ready for use… work with your account team to request access»*: no es un scope que se pueda dar desde el token. Las otras rutas que fallan (`internetaccess/groups`, `rules/applied`, `services/dlp/profiles`) muestran el mismo mensaje (confirmado por el dueño). `policy/npa/rules` sólo trae Private Access (0 reglas). | Pedir el acceso al soporte/account team de Netskope. Con él: contrato por ruta, allowlist sin correos de usuarios (sólo cantidades), vínculo con las alertas DLP por nombre exacto de política y, de ahí, `NSK-URLCAT-001`. |
| P2 | `NSK-POLICY-001` | Decisión pendiente con la jefatura | **Política de versiones del cliente y del SO.** Definir qué es una «release golden» del cliente Netskope (cuántas y cuáles) y las versiones mínimas de SO por sistema. Los tres chequeos de Postura que dependen de eso (cliente 2 o más releases golden atrás, cliente 1 release golden atrás, SO debajo del mínimo) se retiraron de Postura el 2026-10-12 para no mostrar «sin configurar» sin una política. | Con la política aprobada: cargar las líneas base desde Equipos (el editor y su API siguen disponibles), mover `DEFERRED_POLICY_CHECKS` a `DEVICE_CHECKS` en `netskope_posture.py` (las consultas y los filtros de inventario `client_compliance`/`os_compliance` están intactos) y ajustar los tests de Postura. |
| P2 | `NSK-POSTURE-002` | Bloqueado por contrato | **Fase 2 (rutas con 200 en el probe v3).** IPS en modo solo-alerta, secure enrollment, SPM instancias desconectadas, método de steering por equipo (`NSK-GRAPH-DEV-001`). | Contrato documentado en `netskope-api.md` por ruta antes de mapear campos. |
| P3 | `NSK-POSTURE-003` | Externo — falta scope | **Fase 3: políticas configuradas vs. observadas.** Solo-alerta vs. bloqueo y políticas que nunca disparan. | Depende de `policy/internetaccess/*` en `NSK-SCOPE-REQ-001`. |
| P1 | `NSK-EXP-UEBA-001` | Entregado salvo causa raíz — fases 1 a 5 entregadas (3: anomalías por usuario, severidad ordenada; 4: cola «Usuarios a atender» UCI+ADEM; 5: tendencia semanal por empresa, migración `093`); queda la causa raíz (`getrca`). Fases previas (fase 2: proporción de usuarios con UCI Poor/Moderate por empresa, `GET /api/cmdb/netskope/uci/companies`; fase 1: puntaje ADEM y componente más bajo por usuario y equipo, `GET .../users/{id}/experience/score`); la serie `getexpscore` se descartó (48 h máx., casi sin puntos); faltan causa raíz (`getrca`, nombres sin verificar) y anomalías UEBA | **Experiencia digital como cadena del usuario (UEBA).** Por usuario: puntaje ADEM y causa raíz, equipos y su ubicación oficina/remoto, serie de UCI, anomalías por escenario/regla/severidad y listas de vigilancia. Es el equivalente de las Cadenas de CyberArk visto desde el comportamiento. | Lectura en vivo acotada (`getanomalies` máx. 30 días y 1000 filas; `getexpscore`; `getrca`); sin persistir IPs. Definir qué anomalías se muestran y su paginación. |
| P2 | `NSK-DEM-UX-001` | En curso — la parte "dónde trabaja la gente" ya está (`NSK-EXP-ONPREM-001`) | **Experiencia digital, vista macro primero.** Arriba: dónde trabaja la gente y cómo les va (contadores de `getsummary` y los 100 peores de `getentities`, aplicaciones impactadas); abajo, la ficha del usuario (`NSK-EXP-UEBA-001`). | `getentities` no pagina ni pasa de 100 usuarios: no se muestra una distribución del tenant completo ni se la presenta como tal. |

Reorganización de Usuarios entregada el 2026-10-12: pestañas «Para revisar» y
«Por empresa», búsqueda superior y ficha lateral directa. «Rendimiento digital»
explica ADEM con escala, ventana y componentes; la comparación por empresa
muestra cantidades, proporciones y fecha de la semana anterior disponible.
No cierra causa raíz, scopes ni validaciones externas pendientes de estos IDs.

## Netskope — URL Lookup aplicado al negocio (idea del dueño, 2026-10-11)

Caso de uso aprobado por el dueño (2026-10-11): responde «¿tengo habilitada esta web? y, si no, ¿qué regla la bloquea?» de forma más simple que la consola de Netskope.

Idea: que Custodia no repita la pantalla «URL Lookup» de la consola de Netskope
(categoría, tipo, políticas) sino que responda en términos de negocio: «esta
URL está en la categoría X; se habilita cargando una solicitud del tipo Y», y
que de paso simplifique esa consulta para quien opera Netskope.

| Prioridad | ID | Estado | Oportunidad | Validación previa / criterio de cierre |
|---|---|---|---|---|
| P3 | `NSK-URLCAT-001` | Idea — sin probe, sin contrato | **Consulta de URL con respuesta de negocio.** El operador pega una URL o dominio y ve la categoría (predefinida o personalizada), si está bloqueada o permitida y qué solicitud la desbloquea. | (1) Probe de `POST /api/v2/nsiq/urllookup` (lote de hasta 100 URLs; devuelve categorías) con aprobación del dueño: ruta nunca llamada y enviar URLs a Netskope no es lectura pura, ver `netskope-api.md`. (2) Confirmar si la API trae las **políticas que cubren la URL** y los **perfiles de destino** que muestra la consola; esa parte no aparece en el listado público de `nsiq` y puede ser una API interna de la UI. Sin ella, «bloqueada o permitida» se deduciría de `policy/urllist` (403 sin scope, `NSK-CFG-001`) o de los nombres de política observados, y no sería confiable. (3) El «qué solicitud lo desbloquea» **no existe en ningún sistema que Custodia lea**: haría falta una tabla mantenida por personas (categoría → tipo de solicitud/proceso) con su pantalla de edición y auditoría; la conexión con Jira la configura y define el dueño (2026-10-11); hasta entonces Custodia no integra un gestor de tickets. **Evidencia 2026-10-12 (GET de sólo lectura, sin leer contenido):** `policy/urllist` ya responde `200` con 23 listas de URL (p. ej. «Allowed URLs», «Blocked URLs», excepciones SSL, whitelists); `policy/internetaccess/{rules,groups,rules/applied}` y `services/dlp/profiles` siguen en `403`. Una URL en una lista **no** implica que esté permitida o bloqueada: eso lo decide la regla de tiempo real que usa la lista (acción, quién y actividad), que sigue sin poder leerse. |

Alcance si se aprueba: fase 1 solo categoría + política de la consola (sin
reglas de negocio); fase 2 la tabla categoría → solicitud. No persiste las URLs
consultadas, igual que el resto de Netskope (nunca URLs ni forense).

## Netskope — ideas priorizadas (investigación 2026-09-22)

### Reestructuración de métricas por fases — `NSK-METRICS-001` (2026-10-02)

**Objetivo:** que el equipo entienda qué mide cada dato y gráfico de Netskope,
pueda confiar en sus números y consulte los resúmenes de Netskope sin copiar
eventos innecesarios a nuestra base.

**Hoy:** tenemos 13 datos clave y 15 gráficos configurables, además de las
vistas de Operaciones, DLP y Experiencia. Mezclan distintas fuentes y períodos.
La auditoría encontró dos correcciones prioritarias: evitar combinar datos de
capturas distintas y aclarar los porcentajes cuando sólo se muestran las
categorías más frecuentes. El detalle de todos los widgets y hallazgos está en
[la auditoría](../architecture/netskope-metrics.md).

**Qué ofrecer:**

| Tema | Datos clave y gráficos | Tratamiento |
|---|---|---|
| Inventario y cobertura | Usuarios, equipos, actividad observada, versiones y clasificación | Conservar datos locales y acceso a sus detalles |
| Alertas y protección | Volumen, severidad, tipos, acciones y evolución | Consumir resúmenes AA cuando su definición esté verificada |
| Políticas y aplicaciones | Políticas que generaron eventos, aplicaciones, sitios y volumen de uso | Ampliar por las tareas existentes; elegir una fuente válida por métrica |
| Experiencia | Observaciones actuales por usuario; resúmenes futuros de experiencia | Mantener aparte; las métricas nuevas esperan su contrato y permisos |

**Cómo cambia el almacenamiento:** Netskope conserva y calcula los resúmenes
analíticos que pueda ofrecer. Custodia los consulta y mantiene una caché breve.
La base local conserva inventario, decisiones, preferencias y auditoría.
La captura mínima DLP y sus vistas de investigación permanecen; retirarlas
requiere una decisión separada.

**Estado:** reestructuración en curso; poblaciones/Top-N y registro de
contratos entregados. La conexión AA y una prueba de caché ya funcionan, pero el
primer gráfico DLP espera verificar su definición. El catálogo por IDs no
confirma por sí solo período, unidad o significado de un gráfico.

| Fase | Resultado esperado |
|---|---|
| 1. Corregir los números actuales | Una captura coherente y porcentajes con la población correcta |
| 2. Definir cada métrica | Fuente, qué cuenta, período, filtros y disponibilidad claros |
| 3. Validar un gráfico AA | Confirmar su significado y verlo funcionar en Custodia |
| 4. Ordenar el tablero | Datos clave y gráficos legibles; cargar sólo lo necesario |
| 5. Ampliar gradualmente | Migrar métricas equivalentes y sumar políticas/apps/web verificadas |
| 6. Probar el resultado | Funcionamiento, permisos, errores y rendimiento medidos |
| 7. Retirar duplicación aceptada | Dejar de capturar sólo lo que ya fue reemplazado y validado |

**Siguiente trabajo local:** la oferta de métricas (`NSK-MET-UX-001`) quedó
cerrada (ver `IMPLEMENTED.md`); el piloto AA conserva su validación externa en
`NSK-AA-001`. Denominadores, registro contractual y carga por selección
(`NSK-MET-LOAD-001`) están cerrados. Los detalles
siguientes están destinados a quien implemente las fases.

<details>
<summary>Subtareas, dependencias y pruebas técnicas</summary>

| ID | Estado | Trabajo / fase | Dependencia y criterio de cierre |
|---|---|---|---|
| `NSK-METRICS-001` | En curso — denominadores, registro y carga entregados; piloto AA, oferta y aceptación pendientes | **Tarea coordinadora: reestructuración de métricas Netskope.** Fases siguientes, cada una con su dueño; no otro backlog ni refactor por tamaño de archivo. | Cierre: registro de los 28 widgets actuales, semántica corregida, piloto AA funcional, oferta/presets ordenados, validación HTTP/E2E y rendimiento comparable, decisiones explícitas de conservación/retiro. Expansiones externas se mantienen con sus IDs y no se declaran entregadas al cerrar la primera versión. |
| `NSK-MET-ROLLOUT-001` | Reencuadrado (2026-10-12): elegir más gráficos del mapa AA | **Fase 5: migración gradual del resto de alertas a AA.** Evaluar totales 7/30/90, tipo, acción y tendencias, después del piloto. | Un binding y comparación de equivalencia por métrica; misma ventana/zona/unidad/filtros/grano. No sumar malware con DLP ni distinct counts solapados; sin fallback silencioso. Si no existe fuente equivalente, conservar la actual con estado explícito. Políticas/apps/web conservan sus IDs propios. |
| `NSK-MET-VALIDATE-001` | Reencuadrado (2026-10-12): validar los gráficos del mapa AA (`NSK-AA-CHARTS-001`) | **Fase 6: aceptación funcional y operativa del primer tablero.** Ruta autenticada + navegador + carga comparable; después repetir por cada binding nuevo. | Frío/cacheado/expiración/error, 20 lecturas HTTP y workers según despliegue, p50/p95, tareas/requests remotos, SQL/RSS/frescura/429 y comportamiento de permisos/audit. Umbrales se fijan contra baseline comparable; no prometer capacidad con benchmark en un proceso. `npm run verify` y E2E Netskope del flujo real con mocks sólo donde corresponda. |
| `NSK-MET-RETIRE-001` | Pendiente de `NSK-MET-ROLLOUT-001` y `NSK-MET-VALIDATE-001`; incluye decidir el retiro del código de `alerts_by_severity` | **Fase 7: retirar sólo ingesta analítica duplicada aceptada.** Desactivar requests y snapshots por métrica migrada, manteniendo inventario e investigación DLP. | Dependencias de rutas/drills verificadas; historia sujeta a retención vigente, sin borrado físico por sync ni migraciones retroactivas. Rollback explícito por binding y decisión de histórico propio; ninguna retirada masiva por estar AA disponible. |

**Fase 3 usa `NSK-AA-001`, sin duplicarla:** completar el contrato externo del
piloto de severidad y aceptar una métrica funcional. El candidato malware
sólo probó caché; todavía no reemplaza DLP. Si la API accesible no entrega la
definición, mantener el binding sin activar y registrar la evidencia externa
necesaria; el catálogo ya elimina la copia manual de IDs, no esa validación.

**Fase 5 de expansión usa tareas existentes:** `NSK-POL-001`, `NSK-APP-001` y
`NSK-WEB-001` conservan catálogo/drill/contrato; aquí sólo se coordina su
representación en Métricas y elección de fuente agregada. DEM, configuración
de políticas, NPA, RBAC y gráficos de cadenas no cambian de estado por este
plan. No se modifica Jira ni se crea un ticket remoto en esta tarea.

</details>

### Advanced Analytics e ingestión de volumen (autorizado 2026-10-02)

| ID | Estado | Alcance y siguiente condición |
|---|---|---|
| `NSK-AA-001` | Cerrado por reemplazo (2026-10-12) | **Severidad desde AA.** El tenant no tiene un widget de dos columnas con todas las alertas; `alerts_by_severity` salió del selector y la severidad por tipo se consume con el mapa (`NSK-AA-CHARTS-001`, «Malware por severidad»). El código del contrato con aprobación queda sin uso hasta decidir su retiro. | Reabrir sólo si el equipo pide la severidad de todas las alertas: requiere un widget compartido de dos columnas en la consola de Netskope. |
| `NSK-AA-CHARTS-001` | Primera versión implementada (2026-10-12); validación de uso pendiente | **Mapa de gráficos AA por tenant.** Backend, galería en el selector y tarjeta listos; 8 gráficos cargados en el tenant (riesgo de apps, amenazas, estado del cliente, POP). Ver [mapa AA](../architecture/netskope-metrics.md). | Pendiente: (1) mirarlos en el navegador con datos reales; (2) confirmar en la consola el período de los 7 con «Según el reporte en Netskope» y precisarlo; (3) decidir si se permiten columnas extra cuando la etiqueta es única (p. ej. «DLP Incidents by Status»). Severidad sigue en `NSK-AA-001`. |
| `NSK-PERF-001` | Instrumentación implementada; benchmark y concurrencia pendientes | **Medir el rendimiento real del iterator DLP.** Hay checkpoints, recuperación y métricas de páginas/requests/reintentos/SQL/esperas; el dueño lo acepta para avanzar con AA. Falta una comparación de sync completa con varias páginas y concurrencia entre endpoints independientes. Se mantiene el máximo de 12 páginas; nunca paralelizar el mismo endpoint/índice. La muestra previa no demostró menor latencia. Evidencia y números en [benchmark iterator](../architecture/netskope-metrics.md) y contrato de recuperación en [integraciones](../architecture/integration-contracts.md). |

La recuperación por página del iterator DLP se documenta en
`netskope-api.md`, sección «DLP: captura mínima» (recuperación del iterator). No amplía campos personales/forenses ni permisos.


**Base actual:** inventario aislado de usuarios (`/api/v2/users/getusers`) y
dispositivos (`/api/v2/events/datasearch/clientstatus`), migración `053`,
workspaces `Métricas` / `Usuarios` / `Dispositivos` y panel personalizable
(según el registro de diseño interno de Netskope). Los pendientes de
ese plan se consolidan aquí (`NSK-DEV-*`) y este tracker tiene precedencia.

**Capacidades visibles aportadas por el dueño del producto (captura
2026-09-26):** el tenant muestra en su navegación AI SecOps, AI Command Center,
AgentSkope, Incidents, API-enabled Protection, Policies, Skope IT, App Catalog,
Advanced Analytics y Digital Experience Management. Esto demuestra que las
superficies existen en la UI del tenant, pero no demuestra por sí solo licencia
efectiva para el service account, scope del token ni contrato REST. Cada familia
se valida con un probe read-only antes de implementarse.

### Evidencia que puede aportar el dueño del tenant sin exponer datos

Para destrabar una familia, alcanza con uno de estos insumos, en este orden:

1. nombre exacto del scope/API permission que aparece en la consola para el
   token de Custodia;
2. captura del endpoint Swagger expandido con parámetros y schemas de
   request/response, ocultando host, tenant, IDs y ejemplos con valores;
3. ejecución del probe versionado desde el entorno configurado, compartiendo
   sólo HTTP status, headers de rate limit, nombres/tipos de campos, conteo y
   paginación;
4. si devuelve `401/403`, captura o texto del permiso mínimo solicitado al
   administrador; si devuelve `404`, confirmar si la feature está habilitada
   para el service account.

Nunca compartir en chat API tokens, tenant URL completa, cookies, usuarios,
IPs, URLs navegadas, nombres de archivo, prompts, incidentes o payloads reales.

Pedido de evidencia por módulo visible, en orden de retorno:

| Módulo visible | Tarea relacionada | Qué pedir/probar ahora |
|---|---|---|
| Digital Experience Management | `NSK-DEM-MET-001`, [`NSK-DEM-ALR-001`](BACKLOG_ARCHIVE.md) | El probe GET ya cerró y desbloqueó sites. Solicitar el scope read-only de `query/definitions`, aportar schemas de request de `getdataset`/`getentities` y configurar al menos una regla antes de reabrir alertas. |
| Policies | `NSK-POL-001`, `NSK-NPA-002`, `NSK-CFG-001` | Captura del catálogo de API que muestre si existe lectura de Real-time Protection; scope de NPA rules, private apps y URL lists. Si RTP sólo exporta archivo, aportar únicamente encabezados/schema del export, no registros. |
| Incidents | `NSK-DLP-001` | Ejecutar probes DLP versionados; confirmar scopes y paginación sin compartir incidentes. |
| Skope IT / App Catalog / Advanced Analytics | `NSK-APP-001`, `NSK-WEB-001` | Scope de `datasearch/application`, `datasearch/page` y CCI/App Catalog; schemas de agregación, filtros temporales y group-by. |
| API-enabled Protection | nuevo probe dentro de `NSK-API-001` | Aportar el tag Swagger y lista de endpoints GET. No asumir que los objetos de UI equivalen a apps de `datasearch`. |
| AgentSkope | nuevo probe dentro de `NSK-API-001` | Aportar el tag Swagger y endpoints GET disponibles; no diseñar inventario hasta conocer IDs, objetos y sensibilidad. |
| AI SecOps / AI Command Center | `NSK-AI-001` | Aportar sólo tags/rutas/schemas de inventario agregado. Prompts, respuestas, contenido, tokens y conversaciones quedan fuera de alcance. |
| Administradores/grupos | `NSK-RBAC-001` | Scope read-only de roles RBAC y usuarios administradores (al 2026-10-01 responden `403`); los grupos ya responden vía SCIM (`NSK-GRP-001`). No probar mutaciones. |

**Fuentes de la investigación:** SDK oficial `netskopeoss/netskope-py-sdk`
(commit `3fabfad`, 2026-07-03: 27 recursos y más de 80 rutas v2), provider
Terraform `netskopeoss/netskope`, documentación de Netskope (datasearch,
dataexport iterator, UCI, alertas/eventos, golden releases) y Community. Las
rutas son **documentadas públicamente, no probadas en nuestro tenant**: cada
ítem requiere un probe read-only y el scope correspondiente en el token antes
de mapear. El token actual sólo cubre `clientstatus`, `users/getusers` y
`users/counts`.

**Reglas específicas para Netskope** (además de los límites transversales):

- Eventos, alertas e incidentes **no** son inventario: se persisten como
  agregados diarios (`día × dimensión × clave → count/bytes`) con retención
  explícita, no como filas por evento. La excepción es `NSK-DLP-001`: sus
  conteos permiten bajar a una alerta individual mínima, vinculada sólo por un
  ID opaco y exacto al usuario Netskope ya inventariado. No se copia
  email/nombre desde el evento; IP, archivo, hash, contenido y URL completa
  permanecen excluidos.
- Nunca persistir forensics DLP, contenido/snippets de coincidencias, hashes
  de archivos, nombres de archivo ni URLs completas con query string.
- Custodia sólo lee: cerrar/asignar incidentes, notas, URL lists, reglas NPA,
  upgrades de publishers y tunnels quedan en la consola de Netskope.
- No existe API REST para leer políticas Real-time Protection (Community
  confirma que sólo hay export CSV/JSON manual desde la UI). No se presentan
  "políticas observadas en eventos" como el inventario configurado.
- Límite documentado: 4 req/s por endpoint (`RateLimit-*`). datasearch es
  ad-hoc (10.000 filas por página, timeout 180 s); el iterador dataexport usa
  índices con nombre y consumo de lotes de una hora — usar un índice propio de
  Custodia para no robar el cursor a un SIEM o a Cloud Exchange.
- Relaciones sólo por IDs exactos entregados en el payload (igual que PAM);
  nunca por email, hostname, nombre de app o similitud.

### Orden recomendado

1. Explotar lo ya persistido: `NSK-VER-001`, `NSK-DEV-00x`, `NSK-CHG-001`, `NSK-FLT-001`, `NSK-EVT-001` y `NSK-DUP-001` quedaron cerrados (ver `IMPLEMENTED.md`).
2. `NSK-API-001` (scopes read-only y probe) desbloquea el resto.
3. Alertas y políticas observadas (`NSK-ALR-001`, `NSK-POL-001`): mayor valor
   operativo diario.
4. Web/apps (`NSK-WEB-001`, `NSK-APP-001`) y NPA (`NSK-NPA-001`/`002`).
5. Auditoría de admins (`NSK-AUD-001`); DLP quedó implementado en `NSK-DLP-001`
   (conteos y alerta mínima por usuario).
6. GenAI, Enterprise Browser, UCI y posture (`NSK-AI-001`, `NSK-EB-001`,
   [`NSK-UBA-001`](BACKLOG_ARCHIVE.md), [`NSK-SPM-001`](BACKLOG_ARCHIVE.md)).

### Revisión de equipos sin eventos — `NSK-DEVREV-001` (aprobado 2026-10-05)

Diseño completo, reparto medido y reglas en
[netskope-device-review.md](../architecture/netskope-device-review.md). La
decisión humana vive en tablas propias que el sync nunca escribe; la sugerencia
se calcula y no se guarda; la antigüedad observada (`devices_stale_30d`) no
cambia al clasificar. Es un cambio grande: se entrega en tres IDs. Las Fases 1 y 2
(`NSK-DEVREV-001` y `-002`) están cerradas (ver `IMPLEMENTED.md`); queda la Fase 3. Usa `netskope:admin` para escribir; el permiso
dedicado `netskope:review` queda fuera de este alcance y su adopción sólo
cambia la dependencia de la ruta, sin tocar el contrato ni los datos.

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `NSK-DEVREV-003` | Externo | **Fase 3 — fuente corporativa de uso.** Habilita sugerir `in_use_not_reporting`. El dueño confirmó JumpCloud MDM y Cortex como candidatos y pospuso integrar sus inventarios. Falta aprobar el contrato y verificar identidad común y vigencia; ADEM y la unicidad de `guid` no prueban un vínculo (ver documento). | Contrato de la fuente, identidad de dispositivo y frescura exigida. | No se implementa sin contrato aprobado. |

### Con datos ya persistidos

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `NSK-DEV-006` | Verificar | **Sincronización incremental de dispositivos.** La sincronización actual sigue siendo completa; no convertir el endpoint ad-hoc en stream por inferencia. | Ejecutar probe read-only con una ventana corta y comparar contra una corrida completa para confirmar filtro temporal, orden, paginación y altas/cambios/bajas. `2xx` con cobertura equivalente → implementar; `401/403` → Externo; contrato incompleto → Aparcado y conservar full sync. | Una corrida incremental no pierde ni retira falsamente dispositivos frente a una corrida completa; conserva snapshots/auditoría y tiene tests de respuestas parciales y límites de ventana. |

### SDK y DEM — contrato aportado 2026-09-26

Las capturas de la documentación Swagger aportadas por el dueño del producto
confirman la existencia documental de la superficie `/api/v2/dem/*`; no
confirman todavía que el token actual tenga scope ni revelan los schemas de
respuesta. Custodia adopta DEM sólo en lectura. Quedan fuera de alcance todos los
`POST` de creación y todos los `PUT`/`PATCH`/`DELETE`, incluidos cambios de
apps, probes, receivers, reglas y settings. Las únicas excepciones a "GET" son
los endpoints de consulta read-only que usan `POST` por diseño:
`query/getdataset`, `query/getentities` y `alerts/getalerts`.

| ID | Estado | Trabajo | Validación previa / siguiente paso | Criterio de cierre |
|---|---|---|---|---|
| `NSK-DEM-VALIDATE-001` | Externo | **Activación y primera captura real del inventario DEM de sites.** El código de `NSK-DEM-INV-001` está cerrado; el GET de probe no demuestra captura persistida. | En el entorno autorizado, comprobar migración 070, configurar el opt-in `NETSKOPE_DEM_SITES_PATH=/api/v2/dem/config/sites` y autorizar una corrida completa. No ejecutar desde el harness. | Primera corrida completa y captura allowlisteada confirmadas con conteos, permisos y frescura; sin ubicación, redes ni payload completo. El inventario es backend técnico; no exige reponer la antigua UI de sitios. |
| `NSK-ADEM-WINDOWS-001` | Externo | **Validación operativa de POPs en ventanas de 24/48 h.** `NSK-ADEM-POP-001` entregó código y el tenant sólo fue validado en 2 h. | El dueño contrasta las ventanas con la consola desde el entorno autorizado, sin nuevas inferencias de usuario/latencia/egreso. | Evidencia no sensible de período y conteos; no confundir códigos POP con usuarios por POP. |
| `NSK-ADEM-TIME-001` | Externo | **Semántica temporal de `lastActivity` ADEM.** El código `NSK-ADEM-USERPOP-001` muestra actividad fuera de ventana con frescura sin confirmar. Ver [nota de continuidad](DEM_ADEM_HANDOFF.md). | Solicitar explicación del tenant por el timestamp unos 24 min posterior al reloj de consulta. No recortar/corregir el dato artificialmente. Una tabla global por POP no está aprobada por esta tarea: faltan schema 200 y paginación de `getentities`. | Semántica documentada y UI/test ajustados sólo si corresponde a un contrato confirmado; sin IP, coordenadas, payload completo ni relaciones SSE por nombre. |
| `NSK-LIC-001` | Reducido — verificado 2026-10-04 | **Uso de licencias de Enterprise Browser.** `nsbrowser/licensesettings` devuelve `assignedLicenses` (29) y un `totalLicenses` de 4.294.967.295 (2³²−1, centinela de «sin límite»): mostrar «Sin límite», nunca ese número ni «disponibles». Una sola tarjeta, junto a `NSK-EB-001`; no justifica una capa de sync propia. | **Descartado como denominador de usuarios:** `users/counts.totalUsers` (8.861) no coincide con el `totalResults` de `getusers` (8.921) ni con los activos de Custodia (8.917), y el sync ya valida contra el `totalResults` de `getusers`; un tercer número con otra definición sólo generaría alarmas sin causa conocida. | Tarjeta de licencias con frescura y centinela explícito, o descarte con motivo. |
| `NSK-DEM-ALR-002` | Listo — verificado 2026-10-04 | **Reglas, receptores y alertas DEM.** `dem/alert/rules`, `dem/alert/receivers` y `POST dem/alerts/getalerts {limit, offset}` responden `200` (con `remainingQuota`). | Revisar sensibilidad de receptores (canales/destinos): persistir sólo nombre, tipo y estado. | Inventario de reglas/alertas con frescura; sin destinos de notificación. |
| `NSK-ER-001` | Listo — probe 2026-10-04 | **Reportes ER (`reporting/er`).** `GET reporting/er/reports` `200` con 53 reportes. | Misma mecánica asíncrona que AA (`NSK-AA-001`); evaluar widgets útiles sin duplicar métricas propias. | Decisión de adoptar o descartar con muestra de widgets. |
| `NSK-SCOPE-REQ-001` | Externo — falta scope (`403`, 2026-10-04; re-probe 2026-10-14: las 14 rutas listadas siguen en `403`) | **Scopes read-only a solicitar al administrador del tenant:** `auth/tokens` (auditoría de tokens), `dem/query/definitions`, `dem/apps`, `dem/appprobes`, `aig/*` (AI Gateway), `airt/*`, `casb/appinstances`, `analysis/npa/jobs`, `services/dlp/profiles`, `policy/internetaccess/*`, `profiles/networks`, `ips/threathuntingconfig`, `events/logstreaming/list`, `steering/expressconnect/sites`. `spm/*` devuelve `404` (sin licencia SPM; sólo `spm/stats/disconnectedinstances` responde `200`). | El dueño solicita los scopes; después se repite el probe (`NSK-API-001/v3`). | Cada ruta pasa a `200` y se diseña su tarea, o se descarta por licencia. |
| `NSK-DEM-MET-001` | Externo — falta scope para `dem/query/definitions` (re-probe 2026-10-14: sigue `403`) | **Métricas RUM, Traceroute y HTTP Measures.** | El GET de definiciones respondió `403`. Solicitar el permiso read-only exacto; después versionar los schemas de request antes de cualquier muestra acotada de `POST /api/v2/dem/query/getdataset` o `getentities`. | Mediana/p95 de experiencia, usuarios/dispositivos impactados y apps degradadas con denominador/frescura; sin score nominal, ubicación exacta ni filas por usuario por defecto. |
| `NSK-XMET-002` | Bloqueado por `NSK-DEM-MET-001` | **Cruce DEM con usuario/dispositivo.** | Unir sólo IDs exactos confirmados en ambos payloads; si DEM no entrega IDs compatibles, mostrar cohortes separadas. | Experiencia por SO/versión/postura y dispositivos afectados, con conteos de no vinculados y sin joins por email/nombre. |

**Propuesta no priorizada — mapa agregado por POP ADEM.** Explorar una vista
agregada de usuarios/dispositivos por POP sólo cuando `POST
/api/v2/adem/users/getentities` tenga permiso read-only confirmado, schema 200
completo y paginación validada, y sus filas confirmen explícitamente la relación
con el POP. `poplist` entrega códigos, no conteos ni asignaciones, por lo que no
sirve para derivar concentración. Un mapa geográfico requiere además una fuente
autorizada de ubicación POP; no inferirla del código, IP, hostname o nombre.
Exponer período, procedencia y frescura, con agregación/supresión apropiada de
cohortes pequeñas. Esta nota no crea un ID, prioridad, estado ni autorización de
implementación; se mantienen los bloqueos de `NSK-ADEM-TIME-001` y
`NSK-DEM-MET-001`.

### Expansión del gráfico desde el catálogo GET (revisión 2026-09-26)

Fuente: [`netskope-api.md`](../architecture/netskope-api.md),
catálogo aportado de 611 rutas GET en 46 familias. El mayor retorno no está en
dibujar más nodos aislados sino en incorporar **aristas con IDs explícitos** y
procedencia consultable. Cada línea se puede entregar por separado; una familia
que no pase su probe no bloquea las demás. `CHAIN-006` sigue siendo la entrega
NPA existente y no se duplica aquí.

| Prioridad | ID | Estado | Oportunidad | Validación previa / criterio de cierre |
|---|---|---|---|---|
| P1 | `NSK-GRAPH-DEV-001` | Listo | **Cadena usuario observado → dispositivo → tag/regla de clasificación → steering.** Extiende la cadena actual con postura y método de encaminamiento. | Probe 2026-10-01 (`rules` 3, `tags` 1 y `steering` responden `200`); sólo IDs exactos presentes en ambos extremos, nodos sin vínculo explícitos y procedencia de cada arista; nunca unir por hostname, email, etiqueta o nombre. |
| P1 | `NSK-GRAPH-RBAC-001` | Candidato — `NSK-RBAC-001` entregado (2026-10-14); falta decidir si el grafo aporta algo sobre la vista Administradores | **Mapa administrador → rol → API group/scope y grupo → membresía.** Permite detectar cuentas privilegiadas inactivas, roles huérfanos y alcance excesivo. | Grafo separado de admins Custodia/Okta, permiso `netskope:admin_inventory_read`, IDs del proveedor y ningún dato de autenticación. |
| P2 | `NSK-POLCFG-PROBE-001` | Externo — `403` en `rules`, `rules/applied`, `groups`, destinations, networks y service objects (2026-10-01) | **Políticas Internet Access, grupos y perfiles referenciables.** | Solicitar el scope read-only; no leer contenido de listas ni desplegar/cambiar políticas. Un `2xx` promueve `NSK-GRAPH-POL-001` a Listo; `404` lo aparca. |
| P2 | `NSK-GRAPH-POL-001` | Bloqueado por `NSK-POLCFG-PROBE-001` | **Cadena grupo de política → regla aplicada → perfiles/destinos/service objects.** Responde qué configuración efectiva protege o encamina cada alcance. | Aristas sólo desde referencias ID confirmadas; distinguir borrador/aplicado; nodos desconocidos quedan explícitos, nunca resueltos por nombre. |
| P2 | `NSK-GRAPH-DEM-001` | Bloqueado por `NSK-DEM-INV-001` y [`NSK-DEM-ALR-001`](BACKLOG_ARCHIVE.md) | **Topología DEM app → app probe/network probe → site/gateway → regla/alerta.** Permite navegar desde degradación agregada hasta el objeto monitorizado. | Sólo relaciones declaradas por IDs del contrato; ubicación limitada a país/región agregada; sin IP/hostname ni entidad personal. |
| P2 | `NSK-GRAPH-APP-001` | Bloqueado por `NSK-APP-001` y `NSK-POL-001` | **Aplicación observada → categoría/CCI/tag → política observada/tipo de alerta.** Conecta adopción Shadow IT con controles que realmente dispararon. | Join sólo mediante identificador exacto entregado por la misma API; si sólo coincide el nombre, presentar cohortes separadas; agregados sin usuarios ni eventos individuales. |

**Orden de retorno:** terminar primero usuario/dispositivo con clasificación,
RBAC y la cadena NPA ya definida; después política aplicada/perfiles; por último
DEM y App Catalog. DSPM, linaje de archivos, eventos crudos, reporting por
usuario y artefactos forenses no se incorporan al gráfico: su sensibilidad no
se justifica para esta fase.

### Requieren scope nuevo y probe

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `NSK-API-001` | Verificado parcialmente (tenant 2026-09-24; re-corrida 2026-10-01) | **Scopes read-only y probe de catálogo.** El probe versionado `scripts/probe_netskope_api.sh` consulta sólo la allowlist de rutas de eventos, auditoría, infraestructura, NPA, CCI, dispositivos, SSPM y UCI; `scripts/probe_netskope_dlp_incidents_contract.sh` valida el contrato real de DLP Incidents. Ambos registran únicamente HTTP status, forma, nombres/tipos de campos, conteos y headers de rate limit; nunca valores ni payloads. El probe ahora usa `curl --compressed` para inspeccionar correctamente respuestas comprimidas. | Corrida read-only 2026-09-24: `datasearch/alert` y `datasearch/application` respondieron `200` con páginas de 10.000 eventos; `policy/npa/policygroups` respondió `200` con 8 grupos; auditoría, publishers, private apps, NPA rules y URL list respondieron `403`; varias rutas opcionales respondieron `404`; `events/incident` en datasearch respondió `400`, mientras el contrato `dataexport/events/incident` validado por el probe DLP respondió `200`. Los headers confirmaron límites por endpoint entre 4 y 100 req/s. Corrida adicional 2026-09-27 del probe de incidentes: `200`, allowlist mínima confirmada 4/4. **Re-corrida 2026-10-01 (48 rutas):** nuevos `200` en `scim/Groups` (718), `scim/Users` (1.408), `rbac/labels`, `rbac/apigroups/pagemapping` (232), clasificación de dispositivos y varias de DEM de configuración/alertas; siguen `403` auditoría, publishers/releases/lbrokers, private apps, NPA rules, URL list, roles RBAC, usuarios administradores, Internet Access/perfiles y `dem/query/definitions`; `404` en steering devices/globalconfig, SSPM y UCI. **Ampliación 2026-10-01 (rutas del SDK oficial):** nuevos `200` en `steering/ipsec/pops`, `/steering/ipsec/tunnels` y `services/cci/tags/all`/`rules`/`supportedattributes`; `403` en `steering/globalconfig/publishers`, `auth/tokens` y `enrollment/tokenset`; `401` en `events/metrics/transactionevents`; `404` en `spm/apps`/`inventory`, `devices/device/tags` y `adem/users` (GET). Capturados además los **schemas POST** de las consultas `users/getusers`/`getgroups`. Gestión preparada 2026-10-01 (`SECOPS26-945`): dominios Read en la cuenta de servicio (RBAC v3) o scopes por endpoint (flujo clásico). | Completar por caso de uso los filtros, paginación y allowlist de campos; pedir scopes sólo para las áreas aprobadas; no persistir eventos completos ni valores sensibles |
| `NSK-POL-PROBE-001` | Externo — verificación del dueño del tenant | **Contrato de `groupbys=policy`.** Hoy se pide sin límite explícito: si el tenant devuelve sólo un top-N, volumen y lista quedan incompletos sin aviso. Verificar además si `groupbys=policy,action` es aceptado y con qué forma de `_id` (el cliente rechaza claves compuestas). | Con el probe versionado, sin pegar datos del tenant: cantidad de políticas devueltas frente a las de la consola, existencia de límite/paginación y forma de la respuesta compuesta. Estimar el crecimiento de `netskope_alert_aggregates` (3 ventanas × N políticas × corridas × 180 días) con la frecuencia real de sync. Desbloquea `NSK-POL-ACTION-001`; si hay truncamiento, abrir un ID para marcarlo en la UI. |
| `NSK-POL-ACTION-001` | Bloqueado por `NSK-POL-PROBE-001` | **Acción dominante por política** con una dimensión cruzada política × acción. | Sólo si el probe confirma el contrato: migración nueva (nunca editar la 075), cliente y servicio con la forma aprobada, documentar en `integration-contracts.md`, mostrar la acción con su cobertura y volver a mostrar la columna oculta por `NSK-POL-003`. Sin cruce, «Sin dato». |
| `NSK-WEB-001` | Listo | **Sitios web más accedidos (permitidos y bloqueados).** Top-N diario por dominio de segundo nivel/categoría y conteos. | **Evidencia 2026-10-01:** `datasearch/page` `200` (páginas de 10.000 filas en el probe); agregación server-side y retención de 90 días se definen en la implementación. | Nunca URL completa ni usuario; top-N acotado, denominador/frescura y test de exclusión. |
| `NSK-APP-001` | Listo | **Apps cloud y Shadow IT.** Uso agregado por app/categoría y CCI/CCL. | **Evidencia 2026-10-01:** `datasearch/application` `200`; `services/cci/tags/all`, `/tags/rules` y `/tags/supportedattributes` `200` (sin reglas de tags configuradas hoy); `services/cci/app` responde con forma de error — apoyarse en lo observado + metadatos CCI; sin datos por usuario. | Riesgo rotulado como CCI Netskope; join sólo por identificador/nombre exacto entregado por la misma API. |
| `NSK-NPA-001` | Bloqueado por `NSK-API-001` | **Infraestructura NPA.** Publishers, releases y local brokers. | **Decisión cerrada:** excluir IPs, `common_name` y `assessment`; confirmar paginación. | Object types Netskope, retiro sólo con corrida completa y tests de allowlist. |
| `NSK-NPA-002` | Bloqueado por `NSK-API-001`, `NSK-GRP-001` y `NSK-NPA-001` | **Cadena NPA:** `grupo/usuario → regla → private app → publisher`. | Si policy API no está habilitada, no inventar la cadena y conservar sólo app → publisher confirmada. | Aristas por IDs del payload, workspace separado y rechazo de relaciones por nombre. |
| `NSK-AUD-001` | Bloqueado por `NSK-API-001` | **Auditoría de administración Netskope.** Feed read-only de cambios de configuración. | **Decisión cerrada:** retención 180 días; mostrar actor sólo a `netskope:audit_read`; allowlist ID, timestamp, actor ID/display mínimo, tipo y objeto ID/tipo; excluir diff, request y texto libre. | Fuente append-only separada de `AUD-001`, purga y test de idempotencia por ID de evento. |
| `NSK-CFG-001` | Bloqueado por `NSK-API-001` | **Configuración de steering y listas.** | **Decisión cerrada:** guardar sólo nombre/ID, tipo, cantidad de entradas, `pending` y última modificación; nunca contenido de URL lists. Ninguna escritura remota. | Alerta de cambios pendientes de deploy; test de allowlist y de ausencia de contenido. |
| `NSK-EB-001` | Bloqueado por `NSK-API-001` | **Adopción de Enterprise Browser.** Agregados por `access_method`; no existe inventario separado confirmado. | Confirmar literal exacto en el tenant; retención 90 días; no persistir usuario. | Si no aparece, mostrar “sin dato”, no 0 %; test del caso ausente. |

| `NSK-AI-001` | Bloqueado por `NSK-API-001` | **Uso de GenAI y AI Gateway.** Apps/categorías y alertas agregadas; opcionalmente inventario de proveedores/MCP si el API lo permite. | Confirmar literales y licencia. **Decisión cerrada:** nunca prompts, respuestas, contenido, tokens ni usuario; no inventariar secretos aunque el schema los exponga. | Agregados y metadatos no secretos, categoría tal como Netskope la entrega y tests de exclusión. |

**Evaluadas y descartadas por ahora:** IPS/RBI/DNS profiles (configuración de bajo valor de
decisión para este equipo), DSPM de Netskope (DSPM ya lo cubre BigID) y
cualquier escritura (UCI impact, notas de incidentes, deploy de políticas).
DEM ya no está descartado: el probe cerrado el 2026-09-29 habilitó un primer
inventario read-only de sites (`NSK-DEM-INV-001`). Métricas continúa externa
por scope y alertas permanece aparcada sin reglas ni schema de consulta.

## Cadenas v2 — "¿Qué querés buscar?" (CyberArk + Netskope)

**Problema actual:** `pam-chain-workspace.tsx` sólo arranca desde un usuario
PAM y recorre en un sentido (`usuario → rol → Safe → plataforma → PSM`). No
responde las preguntas inversas que más se hacen en una revisión de acceso:
"¿quién llega a este PSM?", "¿qué usuarios alcanzan esta plataforma?", "¿qué
roles abren este Safe?". Netskope no tiene cadena.

**Idea:** un solo explorador de cadenas por dominio con pivote libre.

1. **Entrada por búsqueda:** un buscador "¿Qué querés buscar?" con typeahead
   agrupado por tipo (Usuario PAM, Rol, Safe, Plataforma, PSM; en Netskope,
   Empresa, Usuario, Dispositivo, Versión de cliente y, cuando existan,
   Publisher, Private app, Regla NPA, Política observada). Chips de tipo para
   acotar ("Plataforma: Windows…").
2. **Columnas canónicas fijas, de izquierda a derecha:** el orden nunca cambia
   (PAM: `Usuario | Rol | Safe | Plataforma | PSM`), así la orientación se
   aprende una vez. El nodo elegido queda resaltado en su columna; a su
   izquierda se muestra el recorrido **hacia atrás** (quién llega) y a su
   derecha **hacia adelante** (a qué llega). "De política a usuario" y "de
   usuario a PSM" son el mismo mapa con el pivote en otro extremo. Toggle
   `Hacia atrás · Ambos · Hacia adelante`.
3. **Re-pivotear:** cualquier nodo tiene "Centrar aquí"; se arma un
   breadcrumb de pivotes (`PSM X → Plataforma Y → Rol Z`) para volver.
4. **Filtros y conteos por columna:** "12 roles · 48 Safes · 3 plataformas",
   filtro por columna, `+N más` como hoy, y las paradas explícitas actuales
   (`Sin Safe`, `Sin plataforma`, `Sin PSM`).
5. **Preguntas guardadas:** atajos de una línea — "¿Quién puede llegar a este
   PSM?", "¿Qué alcanza este rol?", "Usuarios suspendidos con acceso a Safes
   productivos", "Dispositivos con cliente viejo en empresa X".
6. **Comparar dos:** dos pivotes del mismo tipo lado a lado con diff (qué
   tiene A que B no). Sirve para movers/leavers y para "dame el mismo acceso
   que Fulano".

**Plan aprobado 2026-09-25 (revisión 3).** Orden: datos CyberArk → Cadenas
PAM v2 → resto de CyberArk → Netskope → vista por persona. Evidencia medida
read-only ese día (solo conteos): PAM 108 usuarios / 79 roles / 436 Safes /
75 plataformas / 12 PSM; fan-out máximo un rol → 414 Safes y una plataforma ←
200 Safes; puente Identity→PAM por UUID 0 de 77; 45 usuarios PAM elegibles
para el vínculo por correo (53 EPVUser+ExtUser con forma de correo, 8 en el
dominio técnico); SIA `granted_users` con 8 valores distintos, 6 con usuario
PAM; 45 de 56 aristas `platform_uses_psm` apuntan a PSMs retirados y 459
`user_has_role` a usuarios retirados (Fase B). La excepción de vínculo por
correo quedó documentada en `integration-contracts.md` y `AGENTS.md`, con la
implementación única en `services/person_email_matching.py`.

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `CHAIN-006` | Bloqueado por `NSK-NPA-002` y `NSK-POL-001` | **Cadena Netskope v2 con relaciones reales.** Grupo → regla NPA → private app → publisher; política observada → tipo de alerta → app; usuario observado → dispositivo. | `NSK-DEV-001` ya cerrado; restantes dependencias indicadas. | Allowlist de aristas Netskope, leyenda de procedencia y ninguna arista PAM↔Netskope. |

### Validaciones de producto pendientes

| ID | Estado | Trabajo | Dependencia | Criterio de cierre |
|---|---|---|---|---|
Sin tareas activas: `UXB-009` resuelto por la decisión aplicada en
`UX-AUD-013(c)`; ver evidencia y límites en `IMPLEMENTED.md`.

## Oportunidades de producto y mantenibilidad — revisión estática y UX (2026-10-01)

Registro solicitado por el dueño; no autoriza implementar ni eliminar código.
Evidencia de lectura del worktree, no una auditoría integral concluida ni QA
visual aprobado. Hay cambios concurrentes en Netskope/Personas que se preservan.
El QA read-only de producción con `agent-browser` fue autorizado. El hostname
`custodia.itti.digital:5173` falló con `ERR_NAME_NOT_RESOLVED`; luego se accedió a
`http://localhost:5173/` usando el perfil de autenticación local del dueño, sin
exponer su contraseña. QA parcial: Métricas PAM, políticas SIA (expansión y
contexto lateral), búsqueda de Safes sin resultados, Métricas Netskope e
Inventario Netskope; Command Center abre con Ctrl+K y cierra con Escape.
En esas cinco vistas, Axe WCAG A/AA reportó cero violaciones; dos dashboards
dejaron comprobaciones incompletas de contraste, que requieren revisión manual.
No se observó overflow horizontal de página en SIA/Safes a 1440×900 ni en
Inventario Netskope a 1280×720. Esto no certifica todos los flujos, ambos temas,
permisos negativos ni la integración de código local con el despliegue.
Después del login se bloqueó localmente todo `fetch` no GET/HEAD/OPTIONS durante
la navegación SPA: cuatro intentos de escritura de recientes quedaron bloqueados.
Sus errores son artefactos de esa guardia, no bugs de producto. No hubo
sincronizaciones, exportaciones ni guardados deliberados; el login sí puede
generar auditoría normal de autenticación. En la primera pasada no se observó
la sección REL-001; en la segunda sí apareció al expandir una política. No se
afirma una causa ni una regresión a partir de esa diferencia. No se guardaron
capturas ni payloads sensibles.
No duplicar `CONN-UX-001`, `CHAIN-012`, `VIEW-006` (cerrados) ni `E2E-STALE-001`.

**Segunda pasada, orientada a comprensión técnica:** QA read-only a 1440×900
en Métricas PAM, Safes, SIA y Métricas Netskope. En Safes se observaron filtros
generales y equivalentes dentro de columnas, además de selectores y guardado
de asignaciones por fila. En SIA, expandir una política abre simultáneamente
detalle y contexto lateral, repitiendo «Reglas de acceso» y «Vínculos por correo
exacto»; esto confirma la oportunidad `SIA-LINK-UX-001`. El tooltip de KR1 PAM
explica bien fórmula, fuente y límites, pero el título comienza por el código
KR; el tablero Netskope observado no mostró controles equivalentes de
explicación. Son oportunidades de jerarquía, no fallos de cálculo ni una
afirmación sobre todos los widgets o presets. Se preservan cambios concurrentes
de Postura PAM; esta revisión no los implementa ni valida.

**Dirección de diseño:** usuario técnico, desktop denso y legible. Primera capa:
identidad del objeto, estado con significado, dato relevante y procedencia;
segunda capa: evidencia y contexto desplegables; tercera: IDs, fórmulas y
atributos técnicos completos. No esconder frescura, denominadores, desconocidos,
errores o límites de interpretación. No sustituir tablas por tarjetas anidadas,
eliminar columnas indiscriminadamente ni introducir lenguaje infantil o marketing.
Separar «dato observado del proveedor», «decisión operativa local» y «vínculo
inferido bajo contrato». Cada propuesta requiere revisión visual del dueño;
un scan Axe verde no certifica comprensión ni buena jerarquía visual.

| ID | Estado | Oportunidad / alcance propuesto | Evidencia / validación previa | Criterio de cierre |
|---|---|---|---|---|

### Nuevos candidatos de claridad para operadores técnicos

| ID | Estado | Oportunidad / alcance propuesto | Evidencia / validación previa | Criterio de cierre |
|---|---|---|---|---|

**Orden sugerido (no autorización de ejecución):** `SAFE-READ-UX-001`,
`SIA-LINK-UX-001`, `METRIC-READ-UX-001`, `PAM-CLEAN-FRESH-001` y
`PAM-CLEAN-UX-001` cerrados (ver `IMPLEMENTED.md`). Entregar
una superficie por vez, comparando antes/después con preguntas concretas:
«¿qué estoy viendo?», «¿qué está pendiente?», «¿qué evidencia sostiene el dato?»
y «¿dónde investigo sin confundir una referencia con un vínculo?».

### Ampliación UX — Personas y Netskope (2026-10-01)

Tercera pasada con `agent-browser`, sesión separada, perfil del dueño y guardia
local que bloquea `fetch` de escritura después del login. Revisadas Personas
(búsqueda y selección del perfil del dueño), Inventario Netskope (filtros y
detalle de un equipo), Estado de equipos y pantalla inicial de Experiencia
digital, a 1440×900. Métricas Netskope se revisó en las pasadas anteriores.
No se seleccionó un usuario en ADEM para evitar consultas live adicionales;
su listado de dispositivos y detalle POP no fueron validados en esta pasada.
No se ejecutaron sincronizaciones, guardados ni exportaciones. Esto amplía
la cobertura de revisión, no certifica todos los estados, permisos ni temas.

**Conservar lo que ya ayuda:** en Personas, buscador primero, procedencia y
referencias por nombre diferenciadas del vínculo por correo; evidencia técnica
desplegable y fuentes explícitas. En detalle de equipo Netskope: «Usuario
observado», «Señal reciente», «Registro en Custodia» y «Datos técnicos» desplegable;
no volver a mezclar fecha de sync y fecha de actividad. No reabrir esos cambios
ni simplificarlos eliminando evidencia.

**Priorización dentro de esta ampliación:** `NSK-INVENTORY-UX-001`,
`NSK-POSTURE-UX-001`, `NSK-ADEM-UX-001` y `PERSON-FOCUS-UX-001` cerrados (ver
`IMPLEMENTED.md`). Esta ampliación no tiene filas activas.

## Home — mejora visual diferida

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `HOME-WHEEL-002` | **Candidato, prioridad baja** | **Órbita 2.5D para el menú visual del Home.** Evolucionar la rueda circular de `HOME-WHEEL-001` a un anillo elíptico con profundidad visual: Personas/Custodia permanece en el centro y cada herramienta ocupa un nodo distribuido por ángulo uniforme (`360° / N`). Los botones y logos oficiales siguen planos y legibles; el aro, las sombras, la escala y el orden de profundidad producen la perspectiva. | No es 3D real ni requiere WebGL/dependencias nuevas. Anillo estático, sin rotación automática, drag ni movimiento permanente; hover/foco sólo eleva y activa el nodo. La equidistancia es angular sobre la órbita circular original: la proyección elíptica no promete igual separación en píxeles. Mantener lista principal, orden de teclado, RBAC, BigID planned/no navegable, ambos temas, Axe y `prefers-reduced-motion`. Reutilizar los tokens globales de movimiento si `FE-MOTION-001` ya está cerrado al implementarlo. | Helper determinista calcula posición, profundidad, escala y `z-index` para `N`; nodos no colisionan ni desbordan en 1280×720 y 1440×900. Política de densidad explícita: 1–4 nodos de 84 px, 5–6 de 72 px, 7–8 de 60–64 px; al superar 8 aplica la navegación jerárquica documentada en [`HOME-WHEEL-X`](BACKLOG_ARCHIVE.md), nunca achicar indefinidamente. E2E cubre foco/teclado, orden DOM independiente de profundidad, BigID no interactivo, dark/light, Axe y reduced motion; `npm run verify` verde. |

**POC experimental de `HOME-WHEEL-002` (2026-09-28):** la rama
`experiment/home-wheel-002` prueba la variante radial 2D solicitada durante la
revisión visual: Personas ocupa el núcleo delimitado por un círculo interior y
las herramientas se distribuyen uniformemente en la corona contenida por un
segundo círculo exterior. No agrega dependencias ni estado React. Frente al
build base, el entry JS pasó de 332,82 kB / 101,01 kB gzip a 333,19 kB /
101,18 kB gzip y el CSS de 208,87 kB / 34,47 kB gzip a 210,86 kB / 34,82 kB
gzip. El candidato sigue abierto hasta la validación visual del dueño de
producto. La corona centra cada nodo entre ambos bordes y usa una entrada CSS
breve con los tokens de `FE-MOTION-001`; hover/foco elevan el nodo y
`prefers-reduced-motion` elimina la animación. La rama permite descartarlo sin
afectar la línea principal.

## Editar vista v2 (Métricas CyberArk y Netskope)

**Estado actual:** ambos tableros se editan en el lugar con el mismo motor:
`dashboard-edit-item.tsx` (reordenar con mouse/teclado, tamaño, quitar),
`dashboard-widget-picker.tsx` (atajos y creación desde cero) y
`dashboard-widget-config.tsx` (configuración por widget en el lugar: nombre,
medida, tipo, gráfico, objetivo, filtros en la barra del bloque y vista
previa en vivo). `VIEW-008` quedó cerrado el 2026-09-26: el modal
`dashboard-customizer.tsx` fue retirado y ya no hay dos personalizadores. `VIEW-005` quedó cerrado el 2026-09-26: la vista previa en vivo ya estaba cubierta por VIEW-008 y se sumó el aviso cuando los filtros dejan el bloque en 0, con test e2e (ver `IMPLEMENTED.md`). `VIEW-003` quedó cerrado el 2026-09-26: presets por rol, restablecer y deshacer en ambos tableros (ver `IMPLEMENTED.md`). `VIEW-004` quedó cerrado el 2026-09-26: los 3 estados de frescura por medida y la unificación de denominadores están implementados; KR6 queda sin drill por decisión de privacidad (snapshot agregado), no por falta de tiempo (ver `IMPLEMENTED.md`).

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `FE-MOTION-002` | **Candidato — prioridad baja** | **POC de Motion en el Command Center.** Dar continuidad espacial a los resultados que entran, salen o cambian de posición al escribir, filtrar o recibir la búsqueda remota: `AnimatePresence mode="popLayout"`, `layout="position"` y un único indicador activo compartido mediante `layoutId`. La animación es presentacional; `GlobalSearch` conserva la propiedad de query, resultados, filtros, RBAC, foco y selección. | La base actual ya usa `useDeferredValue`, debounce remoto de 250 ms, derivados memoizados, keys estables, carga diferida de widgets, focus trap y `aria-activedescendant`; no reemplazarlos ni duplicarlos dentro de la capa animada. Usar `LazyMotion strict` + componentes `m` y cargar `domMax` dinámicamente sólo al abrir esta superficie; Motion no se adopta globalmente. Reutilizar los tiempos de `FE-MOTION-001`: panel 190–210 ms y resultados 140–180 ms, sin spring/stagger por tecla, sin `mode="wait"`, sin keyear la lista por query y sin retrasar requests, loaders ni resultados. `MotionConfig reducedMotion="user"` más `useReducedMotion`: cambios instantáneos o sólo opacidad, nunca transform/layout bajo reducción. | Comparar build antes/después y documentar entry chunk, chunk diferido y gzip; `domMax` no se solicita antes de abrir el Command Center. E2E cubre apertura/cierre y restauración de foco, escritura rápida interrumpible, filtros, llegada remota, ↑/↓/Enter/Escape, `aria-activedescendant` siempre válido, Axe y reduced-motion sin animaciones geométricas. Los resultados y requests siguen disponibles sin esperar salidas; `npm run verify` y subset `auth.spec.ts`/`ux-aud.spec.ts` verdes. Adoptar sólo si la revisión comparativa demuestra una mejora clara frente a CSS; si no, retirar la dependencia y registrar el POC descartado. |
| `BE-STREAM-001` | Prioridad baja | **SSE para estado de sincronización.** Reemplazar el sondeo de una corrida por notificación, manteniendo PostgreSQL como fuente de verdad. | No bloquea trabajo actual. El diseño debe incluir allowlist de eventos, autorización, reconexión/cursor y múltiples workers. | Test de reconexión y fallback de polling; nunca transportar datos sensibles ni reemplazar la cola durable. |
| `BE-TRACE-001` | Prioridad baja | **Trazas por `run_id` a través del ciclo de sincronización.** | No bloquea trabajo actual. Empezar cuando exista un destino de observabilidad; allowlist: IDs técnicos, fuente, fase, resultado y duración, nunca payloads/secretos. | Instrumentación acotada, destino configurado y overhead medido antes de extender. |

**Extensión posterior de `FE-MOTION-002`, fuera del POC inicial:** si Motion se
adopta en el Command Center, evaluar en otro batch `layout` sobre los widgets
del modo edición para suavizar reordenamientos por teclado/drop, cambios de
tamaño y eliminación. No sustituir el drag nativo, los controles de teclado,
los anuncios `aria-live` ni la persistencia existentes, y no usar
`Reorder.Group`: la grilla multidimensional con tamaños variables no coincide
con su caso simple por eje. Drawers, popovers, tablas, workspaces y la órbita
2.5D de `HOME-WHEEL-002` permanecen fuera de este ID mientras CSS y
`usePresence` resuelvan su movimiento.

## Métricas y decisiones de producto pendientes

| ID | Estado | Trabajo | Dependencia | Criterio de cierre |
|---|---|---|---|---|
| `SAFE-CLASS-001` | Prioridad baja, después de la baja masiva | **Clasificación manual de alcance y calidad de Safes.** | **Decisión cerrada 2026-09-26:** primero retirar/dar de baja las Safes ya identificadas; clasificar manualmente el inventario restante, nunca por patrón de nombre. | Cada decisión restante queda aplicada y auditada; los KPIs reflejan la clasificación sin inferencias automáticas. |

## Operaciones y publicación

### Harness de desarrollo (no runtime de Custodia)

| ID | Estado | Trabajo | Validación previa | Criterio de cierre |
|---|---|---|---|---|
| `HARN-RUN-001` | Externo | **Primera corrida completa con modelo autorizado de los agentes nativos OpenCode V2.** OMP/SDK propio descartados por decisión del dueño. Cargar perfiles no demuestra una implementación por el obrero. | Conectar OpenCode Go y/o ChatGPT Plus OAuth; ID Listo autorizado, alcance de archivos y checkout revisado. No reutilizar secretos productivos ni efectuar commit para limpiar sin permiso. | Planner → worker → gate aprobado → reviewer fresco → aceptación humana, con evidencia real y modelo/consumo documentados sin credenciales. Permisos no equivalen a sandbox: si el código no es confiable, verificar fuera del host productivo. |

Sin pendientes activos de despliegue. `DEP-001` y `DEP-002` (Cloudflare Tunnel/Access y
hostname productivo) quedaron cerrados por confirmación operativa el 2026-09-10.

## Calidad del gate y pilotos de librerías (consenso 2026-09-25)

Consenso entre el dueño del producto y dos revisiones de agentes, con
evidencia medida en el repo. Los ítems marcados como **piloto** no son
migraciones aprobadas: cada uno se prueba en un alcance acotado y se
**adopta o se descarta** según su criterio de adopción, registrando el
resultado. Los pilotos se hacen **uno por vez**, después de lo que indica su
columna de entrada, y cualquier dependencia nueva pasa antes por la revisión
de supply chain (`npm run verify:supply-chain` / `requirements.lock.txt`).

Orden acordado:

1. Terminar Cadenas/Netskope (`CHAIN-*`).
2. `FE-API-001` (tipos OpenAPI) quedó cerrado y **adoptado** el 2026-09-26
   (ver `IMPLEMENTED.md`): Cadenas es el primer dominio con tipos generados
   desde el OpenAPI real; el resto de `frontend/src/lib/*-api.ts` sigue a
   mano hasta que se decida extenderlo por dominio. TanStack Query se adoptó
   por separado en `FE-DATA-001`; el resto de los hooks se migra por dominio,
   sin ticket nuevo mientras se toca cada workspace. Migrados a la fecha: 23
   de 31 hooks de dominio con lectura de servidor (ver `FE-DATA-001` en
   `IMPLEMENTED.md` para el detalle de las dos tandas). Quedan sin migrar
   `use-auth`, `use-safe-mutations` (sesión/mutación puntual, no lectura
   compartida) y, a propósito, `use-activity-events`/`use-ingestion` (poller de
   fondo y flujo imperativo de sincronización, no encajan en el modelo de
   queries).
3. `BE-CFG-001` (pydantic-settings) y `FE-A11Y-001` (React Aria) ya adoptados.
   Falta recuperar/medir el costo de bundle del segundo en `FE-A11Y-MEASURE-001`.

| ID | Estado | Problema medido | Alcance | Criterio de adopción o cierre |
|---|---|---|---|---|
| `FE-A11Y-MEASURE-001` | Verificar | **Evidencia residual de bundle del piloto React Aria.** `FE-A11Y-001` ya implementó `CompactSelect`; no repetir la migración. **Medición reconstruida (2026-10-02, `b62daba^` frente a `b62daba`, copias aisladas con `npm ci --offline`, gzip por archivo nivel 9):** +169.495 bytes de JS (+53.198 gzip, +11,85 %), casi todo en el chunk diferido de `CompactSelect` (+53.221 gzip); la entrada y su grafo estático no cambian (+5 bytes, −3 gzip) y el CSS suma 65 bytes. No es una medición histórica conservada ni mide el tiempo de navegación; falta la aceptación explícita del costo por el dueño. | Recuperar medición antes/después de `b62daba` o hacer comparación reproducible en copias aisladas sin tocar el checkout ni instalar dependencias productivas. No atribuir el crecimiento de otro batch a React Aria. | Registrar entry/chunks/gzip y aceptación explícita del costo; si no se puede reconstruir la base, documentar el límite y solicitar aceptación del dueño. No afirmar medición histórica inexistente. |

### Piloto Recharts solicitado (2026-10-11)

| ID | Estado | Problema a evaluar | Alcance | Criterio de adopción o cierre |
|---|---|---|---|---|
| `FE-RECHARTS-001` | Candidato, sin priorizar | Evaluar si Recharts mejora la accesibilidad y el mantenimiento de los gráficos avanzados actuales frente a ECharts. La corrección de `FE-AUD-006` sigue siendo independiente del piloto. | Probar Recharts en **un gráfico representativo de PAM**, comparado con ECharts con los mismos datos y funciones. Medir navegación por teclado, lector de pantalla en español, filtros al seleccionar datos, temas oscuro/claro, legibilidad en escritorio, distinción entre cero y sin dato, rendimiento y tamaño de entrada/chunks diferidos comprimidos. | Documentar ventajas, limitaciones y costo de bundle reproducible; adoptar sólo si hay una mejora comprobada sin perder funcionalidad ni densidad. Registrar la decisión de conservar ECharts o proponer una migración justificada. Este pendiente autoriza la evaluación, no una migración general ni la convivencia permanente de ambos motores. |

### Candidatos nuevos (2026-09-26, sin priorizar todavía)

Medidos durante la segunda tanda de `FE-DATA-001`, no implementados. No entran
en el orden acordado arriba hasta que se cierre el paso 3; se registran acá
para no perder la medición.

| ID | Estado | Problema medido | Alcance | Criterio de adopción o cierre |
|---|---|---|---|---|

Nota aparte, evaluada y descartada sin registrar ticket: paginación SQL
repetida (57 `LIMIT %s`, 29 `OFFSET %s` en 17 repositorios). `AGENTS.md`
prohíbe una abstracción genérica de repositorio, y no hay un bug medido por
la duplicación — se deja así hasta que aparezca uno.

### SDK de CyberArk (`ark-sdk-python`) — candidato (2026-10-01)

Revisado a pedido del dueño de producto. Es el SDK oficial de CyberArk
(Apache-2.0, publicado en PyPI): cubre SIA, PCloud, Identity, Connector
Manager, Unified Access Policies y el monitoreo de sesiones. Su código fue la
referencia del patrón de host `<subdominio>.<servicio>.cyberark.cloud` que
permitió validar el acceso read-only al servicio de sesiones (`SIA-DIAG-001`,
`AUD-EXT-001`).

| ID | Estado | Trabajo | Alcance del piloto | Criterio de adopción o cierre |
|---|---|---|---|---|
| `CA-SDK-001` | Candidato, sin priorizar | **Evaluar `ark-sdk-python` como cliente de referencia para una fuente CyberArk, sin migración masiva ni dependencia de runtime.** | Un caso ya validado (por ejemplo, la lectura de sesiones), comparado contra el cliente actual: dependencias, autenticación (el SDK está orientado a perfiles/MFA interactivos; Custodia usa credenciales de servicio), paginación, reintentos, logging y allowlists. | Se adopta parcialmente sólo si reduce transporte/mapping sin cambiar contratos existentes ni sumar dependencias fuera de la revisión de supply chain; si el cliente mínimo actual ya cubre el caso, se descarta y se documenta el motivo. |

### Limpieza y afinado general — `MAINT-001` (2026-10-01)

| ID | Estado | Trabajo | Alcance | Criterio de cierre |
|---|---|---|---|---|
| `MAINT-001` | Listo | **Pase de limpieza y puesta a punto:** limpieza de código (muerto o duplicado que aparezca), pruebas funcionales en el entorno desplegado sobre los flujos principales, y corrección de nombres, textos y descripciones confusas (interfaz y tickets). | Acotar con un checklist al arrancar; no duplica ni reemplaza `TOOL-LINT-002`, `E2E-STALE-001` ni `DOCS-TRACK-001`, que conservan su alcance propio. | Checklist ejecutado; flujos principales verificados en el entorno desplegado; correcciones de nombres/descripciones registradas; sin cambios de contrato. |

### Verificación de cascada de estilos — `FE-CSS-002` (2026-10-09)

`FE-CSS-001` quedó cerrado (ver `IMPLEMENTED.md`). Las herramientas con las que se
verificó cada movimiento (detector de conflictos de cascada, volcado normalizado de
reglas, comprobación de que cada componente carga su CSS y la baseline visual de 44
pantallas en dark y light) son locales y temporales; hay que decidir cómo se
conservan sin CI (GitHub empresa bloquea ese camino).

| ID | Estado | Trabajo | Alcance | Criterio de cierre |
|---|---|---|---|---|
| `FE-CSS-002` | Listo — baja prioridad (no urgente; el README documenta el procedimiento manual) | **Conservar sin CI la verificación de cascada de estilos al mover reglas.** | Hecho el 2026-10-09: `verify-style-cascade.mjs` en `verify:styles` (alcance del CSS por componente y clases muertas, con tests unitarios) y limpieza de 91 reglas muertas en CSS de componentes. Descartado tras probarlo: un detector sin referencia de empates de igual especificidad entre CSS de chunks lazy; da unos 90 falsos positivos (tablas distintas que comparten `.compact-table`) y no es un control útil. Lo que falta es un verificador de movimientos con referencia: compara el árbol contra un commit base, exige el mismo conjunto de reglas (salvo eliminaciones declaradas) y marca inversiones de orden solo entre las reglas movidas. Además hay que decidir dónde vive la baseline visual (opciones: `verify:full` local, hook pre-push, job programado en el host, snapshots de estilo calculado en JSON; no versionar PNG). | Un movimiento de reglas que invierta el orden, como `.auth-submit`/`.button`, falla en local sin CI; cubre login, toasts, modales y drawers; documentado en `frontend/src/styles/README.md`; `npm run verify` en verde. |

## Mejora de la documentación del repo — `DOCS-*` (2026-10-08)

Cadena cerrada el 2026-10-09 (`DOCS-IDX-001`, `DOCS-LINT-001`, `DOCS-META-001`, `DOCS-ADR-001`,
`DOCS-GEN-001` y `DOCS-GEN-002`); el detalle está en [`IMPLEMENTED.md`](IMPLEMENTED.md). No quedan IDs abiertos.

## Reglas propias de postura PAM — oportunidad aprobada para documentar

| ID | Estado | Alcance | Criterio de cierre |
|---|---|---|---|
| `PAM-RULES-001` | **Candidato; definición pendiente, no autorizado para implementar** | Crear y administrar reglas de evaluación propias de Custodia desde Postura PAM. Mostrar el catálogo local y distinguirlo de los tipos de riesgo evaluados por CyberArk: un tipo de riesgo no equivale a una política de configuración. CyberArk permanece sólo lectura. Esta oportunidad no forma parte de la tabla unificada de hallazgos. | Definir condiciones y campos permitidos, población aplicable, severidad local, versionado y ciclo de activación/desactivación. Vista previa de resultados antes de activar; permiso estrecho server-side y auditoría transaccional; sincronizaciones no sobrescriben decisiones humanas. Sin secretos, ejecución de código arbitrario, modificación de reglas CyberArk ni deduplicación o ranking entre fuentes. Tests de autorización, validación, evaluación y auditoría; gate, revisión y aceptación humana antes del cierre. |

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
