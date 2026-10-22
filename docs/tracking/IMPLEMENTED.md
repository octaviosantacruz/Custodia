---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-19
---

# Implementado en Custodia

Libro del trabajo cerrado: un solo archivo, sin detalle por periodo. Tiene dos
partes: el **índice por fecha** (una línea por entrega con sus IDs) y la **tabla de
cierres por ID** del trabajo anterior al 12 de octubre. La narrativa completa,
la evidencia y los commits de cada cierre se archivaron en `docs/history/` (local, no
versionado); Git conserva el historial de los archivos retirados.
`scripts/check-task-trackers.mjs` lee este archivo para impedir IDs duplicados o
simultáneamente activos y cerrados.

**Cómo registrar un cierre nuevo:** agregar una línea al índice de la fecha en curso
(título corto y IDs) con la evidencia mínima en la línea o en el commit. No repetir IDs de
`TO_IMPLEMENT.md`: al cerrarse salen de allí.

## Índice por fecha

## 19 de octubre de 2026

- Netskope Rendimiento medido en la oficina — `NSK-EXP-OFFICE-001`. Probe `NSK-EXP-OFFICE-001/v1` (`getinfo` puntúa exactamente la ventana pedida); tramos en oficina y remoto por persona y día desde la detección on-prem (migración `109`, retención 180 días) y tarea diaria `netskope_office_experience` (cada 3 h, hasta 2 días por corrida, opt-in con `NETSKOPE_OFFICE_EXPERIENCE_PATH`). Vista estricta `netskope:uba_read` con pestaña «Oficina, por semana»: una frase con denominador y una línea de datos, un gráfico semanal (malo o regular / promedio oficina vs remoto, solo semanas medidas) y una tabla (personas / por día / por empresa) que pagina de a 20 sin scroll interno; la ficha de cada persona muestra sus «Últimos 7 días» (Oficina, Remoto, Sin señal o Pendiente). Primera semana real completa, 12–18 oct: 852 personas medidas en oficina, 1 regular, promedio 89 en oficina y 88,6 en remoto, 0 fallas. Commits `ca9a156f`, `ae68d182`, `948127f5`.
- Netskope Riesgo y Rendimiento responden una pregunta cada uno: «Usuarios» pasa a «Riesgo» («¿Qué personas tienen señales de riesgo?», cola solo UCI bajo o moderado, menor primero; un puntaje ADEM bajo ya no entra y salen las columnas motivo y ubicación) y «Experiencia en oficina» pasa a «Rendimiento» («¿Cómo funcionan las apps y la red en la oficina?»), que concentra todo lo de ADEM. Al ir a otra pestaña desde un botón que desaparece, el foco pasa a la pestaña de destino. Commits `df3fedaf`, `a961ef6f`.
- Netskope Rendimiento, «Evolución diaria» — `NSK-EXP-OFFICE-002`: línea de tiempo diaria del puntaje promedio por persona (todas pesan igual) en oficina y en remoto, filtrable por empresa, con una persona superpuesta al promedio de su filtro (accesos a su ficha y a «Comparar con su empresa»), lugar, período 30/90/180 días o fechas «Desde/Hasta» (un mismo día responde el rendimiento de esa fecha) y un resumen del período que hace de leyenda. Los días se eligen sobre el propio gráfico: clic, arrastre para un tramo, Ctrl/⌘ + clic para sumar o quitar días sueltos, Shift + clic para extender y Enter/Espacio con teclado; el resumen describe la selección y, sin ella, el tramo medido (no el pedido). Un día sin medición es un hueco y uno con menos de 5 personas un punto hueco. Reemplaza la lista de los 100 menores puntajes de 24 h, que no separaba oficina de remoto y en la práctica mostraba solo puntajes buenos. Ruta de solo lectura `GET /api/cmdb/netskope/experience/office/timeline` (`days` o `start`/`end`, acotado a 180 días completos, 422 si el rango queda vacío; auditada sin empresa ni correo); no consulta Netskope ni necesita migración. Validación: tests unitarios, de ruta y de integración PostgreSQL, E2E con axe y capturas en ambos temas, suite E2E Netskope completa y `npm run verify`. Commits `ed1e118f`, `091ab70a` y el de esta entrada.
- Netskope Usuarios: la ubicación pasa a ser la de la semana (días con eventos en oficina/fuera de los últimos 7), con «N días de 7»; deja de esconder a los híbridos. Tabla diaria `netskope_device_presence_days` (migración `108`, backfill, retención 90 días) escrita por el sync junto a los snapshots — `NSK-EXP-PRESENCE-001`. Datos reales: en oficina entre las 100 de ADEM 8 → 23, lectura 37 s → 0,2 s. Validación: suite backend con PostgreSQL efímero, E2E de Experiencia y UCI y `npm run verify`.
- Servicio → Conectores: pools y redes de Connector Manager en vivo, con fuente, fecha, nombres y conteos allowlisted; sin valores de red ni mutaciones, paginación acotada y lectura restringida a catálogos técnicos — `CMGR-001`. Probe real: 5 pools y 5 redes; con `page_size=2`, tres páginas 2+2+1 en ambos catálogos. Validación: 1.762 tests backend, 463 frontend, 6 E2E (incluidos ambos temas y conservación de búsqueda PSM/SIA), QA visual y `npm run verify`; sin migraciones, commit ni despliegue.
- Administración de acceso completa: origen por rol OIDC con el mapeo exacto aplicado en el login (migración 107, sin reconstrucción histórica, lectura restringida y auditoría transaccional); vistas del menú previsualizadas en el editor, la ficha y la confirmación de asignaciones con las reglas del shell — `ACCESS-UI-001`. Validación: 1.755 tests backend, 463 frontend, 22 E2E en oscuro/claro, QA visual y `npm run verify`; sin commit ni despliegue de la aplicación.

## 16 de octubre de 2026

- Barra de secciones arriba del título en CyberArk y Netskope, con la pregunta de cada vista en un cartel al pasar el mouse; en CyberArk y Netskope el botón del encabezado pasa a «Accesos rápidos» entre herramientas, con un total de seis (tres por plataforma activa) repartible libremente y sin tope por herramienta en el backend; la ubicación nombra la plataforma, no la herramienta interna — `UX-NAV-001`
- Revisión UX de Netskope con admin: accesos visibles por permiso, Registro de equipos/Registro de usuarios con subnavegación compartida dentro de Inventario, resumen de movimientos hacia Cambios y vocabulario de confianza UCI; regresiones E2E de navegación, filtros y bajas — `NSK-UX-ACCESS-001`
- Equipos: la tabla de flota ya no tiene scroll interno (se desplaza la página) y separa la postura golden por severidad («1 golden atrás» / «2+ golden atrás», cada una abre su lista); el editor de SO mínimo muestra las versiones informadas hoy como referencia, sin inventar mínimos — `NSK-FLEET-003`
- Cruce oficina × experiencia (UCI) en Equipos: filtro `uci_rating`, agrupación por «Dónde trabaja» y «Experiencia (UCI)», columna «Con UCI bajo» y atajo «En oficina con UCI bajo»; UCI sin captura se lee «Sin dato», nunca «Sin alerta»; ADEM no entra (solo los 100 peores) — `NSK-EXP-UCI-001`
- Release golden de Netskope sugerida desde la documentación pública (tarea diaria `netskope_golden_release`, migración 106; el admin la confirma con el PUT auditado) — `NSK-GOLDEN-001`; alimenta `NSK-VER-001` sin cambiarlo solo

## 15 de octubre de 2026 — `done/2026-10-15.md`

- Sin inventariar: direcciones observadas y alta — `COV-008`
- Revisión de accesos con señales — `ACCESS-REVIEW-001`
- Exportar Actividad auditada — `ACCESS-AUDIT-EXPORT-001`
- Descartado: vencimiento de asignaciones manuales — `ACCESS-UI-002`
- Menos texto en pantalla (cierre) — `UX-COPY-001`
- Destinos sin movimiento en Avance — `COV-007`
- Avance de la cobertura por responsable — `COV-006`
- Menú de usuario sin «Incluir internos» — `UX-PROFILE-001`

## 14 de octubre de 2026 — `done/2026-10-14.md`

- Avance de la cobertura y tendencia semanal — `COV-005`; con esto se cierra el plan de Cobertura
- Estados de trabajo, responsable, nota e historial por destino — `COV-004`
- Declarado y observado por capacidad, con desvíos — `COV-003`
- Cobertura: ABM de destinos y rediseño — alta, edición, retiro y lote; parte entregada de `COV-004`
- Avisos con el logo de la herramienta — el aviso de una pantalla de CyberArk o Netskope lleva su logo
- Inventario de destinos: importar con vista previa y exportar — `COV-002`
- Actualizar datos sin confirmación — se quita la comparación previa de Safes
- Anomalías UBA por usuario — parte entregada de `NSK-UBA-003`
- Tabla de Usuarios de Identity a 1280 px — `UX-QA-006`
- Linter del frontend con reglas de hooks — `TOOL-LINT-002`
- Score de experiencia ADEM por usuario y equipo — `NSK-ADEM-SCORE-001`
- Permisos de lectura y gestión para Safes y Cobertura — `COV-001`
- Administradores y roles de Netskope — `NSK-RBAC-001`
- Puente entre nodos en el login — `AUTH-LOGIN-UI-003`
- Fondo del login y descripción del portal — `AUTH-LOGIN-UI-002`
- Pantalla de login en una tarjeta — `AUTH-LOGIN-UI-001`
- Grilla de gráficos común a PAM y Netskope — `DASH-GRID-001`

## 13 de octubre de 2026 — `done/2026-10-13.md`

- Login principal por Okta y cuenta local de automatización — `AUTH-AGENT-001`
- Contraste de tipos de rol de Identity — `FE-AUD-013`
- Contraste del contador de Plataformas PAM — `FE-AUD-010`
- Contraste de las cuentas Okta en Usuarios y permisos — `FE-AUD-014`
- Contraste de la insignia Standard — `FE-AUD-012`
- Desplazamiento por teclado en Depuración — `FE-AUD-011`
- Revisión adicional de interfaz con datos reales — `FE-AUD-009`
- Vigencia del inventario en Equipos — `NSK-FLEET-002`
- Equipos y Postura, una pregunta cada una (cierre 2026-10-13) — `NSK-FLEET-001`

## 12 de octubre de 2026 — `done/2026-10-12.md`

- Gráficos de Métricas Netskope sin texto repetido (2026-10-12) — `NSK-MET-UX-002`
- Retiro del ranking «Políticas observadas en alertas» (2026-10-12) — `NSK-MET-POL-002`
- Editor de bloques con panel lateral y gráficos dona/barras (2026-10-12) — `NSK-MET-UX-003`

## 11 de octubre de 2026 — `done/2026-10-11.md`

- Auditoría de frontend, hallazgos validados (2026-10-11) — `FE-AUD-001`, `FE-AUD-002`, `FE-AUD-003`, `FE-AUD-004`, `FE-AUD-005`, `FE-AUD-006`, `FE-AUD-007`, `FE-AUD-008`
- Reordenar Netskope por pregunta (2026-10-11) — `NSK-IA-001`
- Reordenar CyberArk por pregunta (2026-10-11) — `CA-IA-001`
- Roles sembrados al día (2026-10-11) — `ACCESS-ROLES-002`, `ACCESS-ROLES-003`

## 10 de octubre de 2026 — `done/2026-10-10.md`

- Retiro de Túneles de steering (2026-10-10) — `NSK-STEER-RET-001`
- Postura Netskope, fase 1 (2026-10-10) — `NSK-POSTURE-001`
- Políticas pasa a Postura (2026-10-10) — `NSK-POL-RETHINK-001`
- Descubrimiento de Experiencia digital (2026-10-10) — `NSK-EXP-DISCOVERY-001`
- Revisión UX exploratoria: cierres (2026-10-10) — `UX-QA-001`, `UX-QA-002`, `UX-QA-003`, `UX-QA-005`
- Experiencia digital: dónde se conectan los equipos (2026-10-10) — `NSK-EXP-ONPREM-001`
- Experiencia digital: ubicación del usuario y menos texto (2026-10-10) — `NSK-EXP-USERLOC-001`
- Ayuda corta en las tarjetas Netskope (2026-10-10) — `UX-HELP-SHORT-001`

## 7 a 9 de octubre de 2026 — `done/2026-10-07-a-09.md`

- Cierre ARCH-LAYERS-002 — rutas sin repositorios (2026-10-09) — `ARCH-LAYERS-002`
- Cierre ARCH-LAYERS-001 — SQL fuera de los servicios (2026-10-09) — `ARCH-LAYERS-001`
- Cierre DOCS-GEN-002 — catálogo de roles y permisos generado (2026-10-09) — `DOCS-GEN-002`
- Cierre DOCS-GEN-001 — referencia de la API generada (2026-10-09) — `DOCS-GEN-001`
- Cierre DOCS-ADR-001 — decisiones sancionadas como ADR (2026-10-09) — `DOCS-ADR-001`
- Cierre DOCS-META-001 — frontmatter en cada documento (2026-10-09) — `DOCS-META-001`
- Cierre DOCS-LINT-001 — chequeo de la documentación (2026-10-09) — `DOCS-LINT-001`
- Cierre DOCS-IDX-001 — trackers partidos (2026-10-09) — `DOCS-IDX-001`
- Cierre FE-CSS-001 — modularización de `styles.css` (2026-10-09) — `FE-CSS-001`
- Cierre UX-AUD2-009 — fechas y relativos (2026-10-08) — `UX-AUD2-009`
- Cierre UX-AUD2-024 — controles y copy (2026-10-08) — `UX-AUD2-024`
- Cierre UX-AUD2-023 — celdas y columnas (2026-10-08) — `UX-AUD2-023`
- Cierre UX-AUD2-022 — espacio vacío (2026-10-08) — `UX-AUD2-022`
- Cierre UX-AUD2-021 — tableros y grillas (2026-10-08) — `UX-AUD2-021`
- Cierre UX-AUD2-015 — una cabecera por vista (2026-10-08) — `UX-AUD2-015`
- Cierre UX-AUD2-019 — columnas consolidadas (2026-10-08) — `UX-AUD2-019`
- Cierre UX-AUD2-008 — estado compartido de Netskope (2026-10-08) — `UX-AUD2-008`
- Cierre UX-AUD2-004 — rendimiento HTTP (2026-10-08) — `UX-AUD2-004`
- Avance UX/UI — aclaraciones repetidas (2026-10-07) — `UX-AUD2-018`
- Avance UX/UI — textos de operador (2026-10-07) — `UX-AUD2-017`
- Avance UX/UI — resultados de Command-K (2026-10-07) — `UX-AUD2-014`
- Avance UX/UI — filas de catálogos SIA y Access (2026-10-07) — `UX-AUD2-020`
- Avance UX/UI — alineación de administración e inventario (2026-10-07) — `UX-AUD2-013`
- Avance UX/UI — herramientas, navegación y gráficos (2026-10-07) — `UX-AUD2-007`, `UX-AUD2-010`, `UX-AUD2-016`, `UX-AUD2-025`
- Avance UX/UI — rendimiento y requests (2026-10-07) — `UX-AUD2-003`, `UX-AUD2-005`
- Checkpoint UX/UI — seis criterios cerrados (2026-10-07) — `UX-AUD2-001`, `UX-AUD2-002`, `UX-AUD2-006`, `UX-AUD2-011`, `UX-AUD2-012`, `UX-AUD2-026`

## 5 y 6 de octubre de 2026 — `done/2026-10-05-a-06.md`

- Vistas SQL operativas de lectura (2026-10-05)
- Conciliación de totales con la consola de Netskope y estado de usuarios (`NSK-REF-001`, `NSK-USR-001`, 2026-10-06) — `NSK-REF-001`, `NSK-USR-001`
- Sugerencias, lote y widgets de equipos Netskope sin eventos, Fase 2 (`NSK-DEVREV-002`, 2026-10-06) — `NSK-DEVREV-002`
- Clasificación humana de equipos Netskope sin eventos, Fase 1 (`NSK-DEVREV-001`, 2026-10-05) — `NSK-DEVREV-001`
- Heartbeat de Netskope fuera del estado, el inventario y las métricas (`NSK-HB-001`, 2026-10-05) — `NSK-HB-001`
- Logos de las herramientas en el selector (`TOOL-LOGO-001`, 2026-10-05) — `TOOL-LOGO-001`
- Personas como espacio de la persona (`CONN-SPACE-001`, 2026-10-05) — `CONN-SPACE-001`
- Conexiones y Administración separadas; Cobertura de cliente en su propia vista (`CONN-IA-001`, 2026-10-05) — `CONN-IA-001`
- Home: nombres, aristas con iluminación y etiqueta del centro (`HOME-EDGE-001`, 2026-10-05) — `HOME-EDGE-001`
- Steering IPsec y GRE (`NSK-IPSEC-001`, `NSK-GRE-001`, 2026-10-05) — `NSK-IPSEC-001`, `NSK-GRE-001`
- Piloto de presentación de la tabla de Safes (`UX-TABLE-PRESENTATION-001`, 2026-10-05) — `UX-TABLE-PRESENTATION-001`
- Tablas, fase 3: Postura PAM, Actividad y clasificación de Safes (`UX-TABLES-001`, 2026-10-05) — `UX-TABLES-001`

## 4 de octubre de 2026 — `done/2026-10-04.md`

- Tablas, fase 2: patrón de Políticas y ayuda tras «?» (`UX-TABLES-001`, 2026-10-04) — `UX-TABLES-001`
- Verificación de cadencia del scheduler (2026-10-04)
- Sincronización manual: toast y modal de confirmación (`SYNC-UX-001`, 2026-10-04) — `SYNC-UX-001`
- Captura DLP: corridas sin novedades (`NSK-DLP-IDLE-001`, 2026-10-04) — `NSK-DLP-IDLE-001`
- Representación de tablas, fase 1 (`UX-TABLES-001`, 2026-10-04) — `UX-TABLES-001`
- Índice de confianza (UCI) de usuarios Netskope (`NSK-UBA-002`, 2026-10-04) — `NSK-UBA-002`
- Probe v3 de Netskope y cierre de `NSK-SDK-001` (`NSK-PROBE-V3-001`, 2026-10-04) — `NSK-SDK-001`, `NSK-PROBE-V3-001`
- Inventario completo de métodos de la API de Netskope (`NSK-API-INVENTORY-001`, 2026-10-04) — `NSK-API-INVENTORY-001`
- Vista «Políticas» de Netskope (`NSK-POL-VIEW-001`, 2026-10-04) — `NSK-POL-VIEW-001`
- Inventario de grupos Netskope y membresías (`NSK-GRP-001`, 2026-10-04) — `NSK-GRP-001`
- Cierre de `CHAIN-012` como superado por el inventario único (2026-10-04) — `CHAIN-012`
- Observabilidad de la agenda y de las capas (`SYNC-OBS-001`, 2026-10-04) — `SYNC-OBS-001`
- Cierre de capas de sync, política de agenda y vista de equipo (`SYNC-STAGES-001`, `SYNC-UI-001`, `SYNC-POLICY-OPS-001`, `VIEW-006`, 2026-10-04) — `SYNC-STAGES-001`, `SYNC-UI-001`, `SYNC-POLICY-OPS-001`, `VIEW-006`
- Primer widget de «Políticas y uso» (`NSK-MET-POL-001`, 2026-10-04) — `NSK-MET-POL-001`
- Teclado y Axe para políticas observadas (`NSK-POL-A11Y-001`, 2026-10-04) — `NSK-POL-A11Y-001`
- Tabla de políticas observadas: densidad y escaneo (`NSK-POL-003`, 2026-10-04) — `NSK-POL-003`
- Políticas Real-time observadas (`NSK-POL-001`, aceptada 2026-10-04) — `NSK-POL-001`
- Veracidad de las políticas observadas (`NSK-POL-002`, 2026-10-04) — `NSK-POL-002`
- Política de sincronización configurable (`SYNC-POLICY-001`, 2026-10-04) — `SYNC-POLICY-001`
- Tareas programadas independientes por fuente (`SYNC-TASK-001`, 2026-10-04) — `SYNC-TASK-001`
- Agenda de sincronización por tarea (`SYNC-UI-002`, 2026-10-04) — `SYNC-UI-002`
- Tareas programadas de PAM (`SYNC-TASK-002`, 2026-10-04) — `SYNC-TASK-002`
- Coincidencia de miembros en Roles y grupos (`VIS-ROLE-CMP-001`, 2026-10-04) — `VIS-ROLE-CMP-001`
- Cuentas desde Safes con «Incluir cuentas» (`VIS-PAM-ACC-001`, 2026-10-04) — `VIS-PAM-ACC-001`

## 1 a 3 de octubre de 2026 — `done/2026-10-01-a-03.md`

- Safes retiradas (`VIS-PAM-RET-001`, 2026-10-03) — `VIS-PAM-RET-001`
- Historial del equipo Netskope (`VIS-NSK-HIST-001`, 2026-10-03) — `VIS-NSK-HIST-001`
- Identity — cuentas técnicas omitidas por SCIM (2026-10-03)
- Identity — capas de membresía (`ID-002`, 2026-10-03) — `ID-002`
- Grupos OIDC observados en Usuarios (2026-10-03) — `ACCESS-OIDC-GROUPS-OBSERVED-001`
- Carga selectiva de métricas Netskope (2026-10-03) — `NSK-MET-LOAD-001`
- Oferta de métricas Netskope por familia (2026-10-03) — `NSK-MET-UX-001`
- Organización de tests frontend (2026-10-02) — `FE-TEST-ORG-001`
- Netskope — contratos de métricas (2026-10-02) — `NSK-MET-REGISTRY-001`
- Netskope — recuperación del iterator (2026-10-02)
- Señales de limpieza PAM (cierre 2026-10-01) — `PAM-GRP-001`
- Claridad de Safes (cierre 2026-10-01) — `SAFE-READ-UX-001`
- Claridad de SIA, Netskope y métricas (cierre 2026-10-01) — `SIA-LINK-UX-001`, `NSK-INVENTORY-UX-001`, `METRIC-READ-UX-001`
- Postura de equipos Netskope (cierre 2026-10-01) — `NSK-POSTURE-UX-001`
- Cierres de verificación (2026-10-01) — `TEST-NSK-001`, `REL-001`, `DOCS-TRACK-001`, `NSK-ADEM-UX-001`, `FE-DEAD-001`
- Contraste de avatares (cierre 2026-10-01) — `FE-AVATAR-CONTRAST-001`
- Foco individual en Personas (cierre 2026-10-01) — `PERSON-FOCUS-UX-001`
- Cierres por aceptación del dueño: Conexiones y PAM (2026-10-01) — `CONN-001`, `CONN-NAV-001`, `RISK-ENT-001`, `RISK-001`, `POSTURE-REFRESH-001`, `MOD-FE-001`, `UX-SYNC-001`, `CONN-UX-001`, `CONN-TEST-001`, `PAM-CLEAN-UX-001`, `PAM-CLEAN-FRESH-001`, `PAM-POSTURE-UX-001`

## Anteriores al 1 de octubre de 2026 (incluye secciones sin fecha) — `done/anteriores-a-2026-10-01.md`

- Auditoría técnica cerrada — `E2E-STALE-001`, `AUD-DOC-001`, `AUD-DOC-002`, `AUD-DOC-003`, `BE-CFG-001`, `FE-A11Y-001`, `SIA-POL-001`, `UXB-009`, `NSK-DEM-PROBE-001`, `ACCESS-SEG-001`, `ACCESS-MATRIX-001`, `ACCESS-CEILING-001` y 64 más
- Capacidades y refactors cerrados — `NSK-ADEM-POP-001`, `NSK-ADEM-USERPOP-001`, `FE-MOTION-001`, `HOME-WHEEL-001`, `DOCS-PORTAL-001`, `UX-PERSON-002`, `UX-PERSON-001`, `UX-SEARCH-001`, `UX-IA-001`, `FE-DEVTOOLS-001`, `FE-TEST-001`, `TEST-PROP-001` y 33 más
- Verificación de cierre
- Cierres de catálogo trasladados desde el backlog — `SIA-RES-001`, `SIA-CONN-001`, `SIA-STRONG-001`, `ID-001`
- Registro histórico
- Auditoría de baja prioridad IF-015–021 (2026-09-12)

## Cierres por ID (anteriores al 12 de octubre)

### Anteriores al 1 de octubre

| ID | Cierre |
|---|---|
| `E2E-STALE-001` | Reproducidos los tres fallos de specs: drawer Netskope con fixture sin `device_evidence`, selector que aún buscaba Relaciones Netskope retirado del switcher, y editor que exigía ≥15 opciones aunque el catálogo tiene 14. Fixture actualizado… |
| `AUD-DOC-001` | `AGENTS.md` describe `local`/`oidc`/`hybrid` y RBAC por dominios/roles compuestos, en línea con `auth.py`, `test_config.py`, `test_oidc_mapping.py` y la matriz HTTP. No certifica OIDC puro en producción. |
| `AUD-DOC-002` | `AGENTS.md` y `docs/operations/deployment.md` separan el host systemd del diseño Docker/Compose futuro. Es corrección documental, no una prueba de infraestructura externa. |
| `AUD-DOC-003` | Documentados los cuatro remotos locales `itti`, `gvz`, `origin`, `Cybersecurity-Org` y el alias HTTPS duplicado, contrastados read-only. No se retiraron ni repuntaron aliases. |
| `BE-CFG-001` | Piloto adoptado en `AppSettings(BaseSettings)` (`backend/app/config.py`), con tipos, límites, validadores y conservación del contrato `RuntimeError` y de archivos secretos. `backend/tests/cross/test_config.py` protege configuraciones… |
| `FE-A11Y-001` | React Aria adoptado en frontend/src/components/compact-select.tsx; frontend/tests/e2e/compact-select.spec.ts cubre geometría, flechas, Home/End, typeahead, Enter/Space/Escape, Tab, restauración del foco, Agregar y Axe. La revisión… |
| `SIA-POL-001` | Inventario de políticas recurrentes presente en cliente `integrations/sia.py`, sync SIA, queries, API CMDB y `sia-workspace.tsx`. `backend/tests/cyberark/sia/test_sia.py` cubre paginación, totales inconsistentes y respuestas incompletas… |
| `UXB-009` | Catálogo con Plataformas/Conectores/Salud como destinos secundarios (`switcher:false`), manteniendo deep links y preferencias. Regresiones en `workspace-catalog.unit.test.ts`, `workspaces.unit.test.ts`, `pam.spec.ts` y… |
| `NSK-DEM-PROBE-001` | Probe `NSK-API-001/v2` ejecutado el 2026-09-29 exclusivamente sobre las 15 rutas GET DEM allowlisteadas, sin POST ni mutaciones y sin exponer valores o payloads. Resultado: 11 `200`, 3 `403` y 1 `400`; límite uniforme observado de 4 req/s… |
| `ACCESS-SEG-001` | Nueve permisos administrativos estrechos creados por la migración `068`, sin otorgarlos automáticamente a ningún rol o usuario. Backend y frontend separan lectura de directorio, cuentas locales, asignación de roles, catálogo de… |
| `ACCESS-MATRIX-001` | Matriz versionada de las 18 operaciones administrativas actualmente concentradas en `access:manage`, con nueve permisos estrechos objetivo, reglas de compatibilidad y techo de delegación en docs/architecture/access-permission-matrix.md… |
| `ACCESS-CEILING-001` | Techo de delegación: ningún actor puede otorgar más autoridad de la que él mismo posee. `repositories/access_delegation.py` (mismo estilo que `admin_invariant.py`) agrega `assert_delegation_ceiling` (rol directo: el bundle de permisos debe… |
| `ACCESS-OIDC-HEALTH-001` | Diagnóstico OIDC read-only en Administración. `GET /api/access/oidc-health` (`access:manage` o el permiso estrecho existente `access:oidc_mappings_read`, sin migración nueva) devuelve sólo configuración no secreta —modo… |
| `UX-AUD-001` | Overlays de workspace posicionados contra el viewport, no contra `<main>`. Se quitó `both` (fill-mode) de `.workspace-shell { animation: workspace-arrive … }` en `frontend/src/styles.css`: el estado base ya coincide con el keyframe final… |
| `UX-AUD-002` | El command center atrapa el foco. `global-search.tsx` adopta `useDialogFocusTrap` sobre el `role="dialog" aria-modal="true"` del portal con `initialFocusRef` al input de búsqueda: foco inicial en el buscador, Tab/Shift+Tab ciclan dentro de… |
| `UX-AUD-003` | Ningún overlay de pantalla completa filtra el scroll al body. Todas las capas fijas (`.global-search-layer`, `.drawer-layer`, `.user-detail-backdrop`, `.confirm-backdrop`, `.catalog-modal-backdrop`, `.catalog-manager-backdrop`… |
| `UX-AUD-004` | Escape cierra los popovers devolviendo el foco al disparador. `usePopover` captura el elemento enfocado al abrir y lo restaura en Escape (con `fallbackFocusRef` si quedó desconectado) sin robar foco en clicks externos; `useDialogFocusTrap`… |
| `UX-AUD-005` | Encabezados sticky visibles en tablas densas. Decisión: contenedor scrolleable con altura acotada (`min(62vh,720px)`) para `.compact-table-wrap` y `.activity-table-wrap`, igual que el patrón existente de Safes, y Safes conserva el límite… |
| `UX-AUD-006` | Contraste AA en las etiquetas de filtros de Administración: `.filter-row label` pasó de `#63707d` (3.70:1) a `--text-secondary`, medido en 7.18:1 en dark y 6.76:1 en light. e2e calcula el ratio real y corre axe sin `color-contrast` en… |
| `UX-AUD-007` | Las 5 tablas expandibles mueven la expansión a un `<button aria-expanded aria-controls>` en la primera celda y quitan `aria-expanded`/`aria-label`/`tabIndex` del `<tr>` (axe `aria-conditional-attr` y nombre accesible por columnas). e2e en… |
| `UX-AUD-008` | Con 17 opciones de accesos rápidos, `.workspace-editor-actions` queda sticky al pie del menú scrolleable con fondo elevado: "Guardar"/"Cancelar" visibles sin scrollear en los cuatro viewports de la auditoría. e2e con `toBeInViewport` y… |
| `UX-AUD-009` | Estado de sincronización traducido. `syncStatusLabel` vive en `lib/sync-source.ts` (antes local de `sync-runs-view.tsx`) y el intro del workspace ya no imprime el enum crudo. Unit de los cuatro estados del contrato + fallbacks y e2e con un… |
| `UX-AUD-010` | `identityFederations` dejó de anunciarse: `catalog:false`, fuera de la categoría `identity_sia`, componente huérfano y fetcher/tipos muertos eliminados; la ruta y el gate quedan para el redirect de bookmarks viejos. Unit: toda entrada… |
| `UX-AUD-011` | CSS muerto del FAB de permisos eliminado (~120 líneas: fab, popover, fan, panel y satélites) y `maxSharedStyleLines` bajado de 4219 al valor exacto 4005. `verify:styles` pasa; verificado restaurando el CSS bajo el tope nuevo (falla con… |
| `UX-AUD-012` | Ticks intradía y strip de un solo KPI. El widget `inventory_trend` conserva el timestamp (una línea de backend, sin cambios de esquema/datos/permisos) y `formatChartTickLabels` muestra HH:MM si todos los puntos caen el mismo día local… |
| `UX-AUD-013` | Lote de consistencia. (a) tabpanels asociados en los hubs de Administración/Identidades/SIA; (b) el tool «Próximamente» usa `aria-disabled` (enfocable y anunciado, click neutralizado); (c) Plataformas/Conectores/Salud PAM dejan de… |
| `AUD-SEC-001` | Matriz HTTP real con `httpx.AsyncClient` + `ASGITransport`; prueba permisos faltantes (`403`) y autorizados en usuarios, permisos, Safes y catálogos PAM/SIA. |
| `AUD-SEC-002` | Prueba que `safe_lifecycle.py` conserva el gate heredado de `safes.py` para auditoría y candidatos retirados. |
| `AUD-SEC-003` | Tests unitarios de `passwordChecks`, `passwordRequirements` y `generatePassword`. |
| `AUD-API-001` | Contrato OpenAPI ampliado para rutas sensibles de CMDB, Safes, permisos, usuarios y lifecycle. |
| `AUD-API-003` | Metadata `summary`/`description` agregada a rutas administrativas sensibles. |
| `AUD-A11Y-001` | Focus trap, foco inicial/restaurado, `Escape`, `Tab`/`Shift+Tab` y regresiones para diálogos anidados. |
| `AUD-A11Y-002` | `ConfirmDialog` compartido para confirmaciones destructivas y cierre por backdrop. |
| `AUD-SEC-004` | `.env.docker` protegido explícitamente en `.gitignore`. |
| `AUD-PERF-002` | `bulk_update_safe_assignment` batcheado a 4 round-trips totales (existencia+snapshot vía `ANY(%s)`, upsert multi-fila, auditoría multi-fila, evento de actividad multi-fila), sin perder ni una fila de auditoría por Safe. Validado también… |
| `AUD-UI-001` | Lista de "Personas" migrada a `StateBlock` (antes un `<p>` manual). `pie-chart.tsx`/`advanced-chart.tsx` quedaron deliberadamente sin migrar: son widgets compactos de dashboard (~112–128px) donde `StateBlock` completo generaría sobrecarga… |
| `AUD-CLEAN-001` | `account-table.tsx`, `integration-workspace.tsx` y `executive-overview.tsx` eliminados (sin imports en toda la app); CSS huérfano correspondiente removido con cuidado de no tocar selectores compartidos con clases activas… |
| `AUD-CLEAN-002` | 6 imports Python muertos eliminados; `get_group_details` conservado deliberadamente en `pam_inventory.py` porque los tests lo re-exportan desde ahí. |
| `AUD-CLEAN-003` | CSS legacy huérfano eliminado (`.workspace-nav*`, `.sidebar-*`, `.sync-menu*`, `.nav-soon`, `.workspace-subnav`, `.dashboard-kpis`, más `.workspace-sidebar`/`.workspace-content` de la misma feature abandonada), verificado clase por clase… |
| `PENTEST-001` | Cerrado el autorregistro público del primer admin: nueva variable `ALLOW_SELF_REGISTER_SETUP` (default `false`) en `app/auth.py`. Apagada, `POST /api/auth/register` responde `404` (igual que "auth local deshabilitada", sin revelar si la… |
| `PENTEST-002` | Cerrado el bypass de `must_change_password`: `require_read_access()`/`require_write_access()` (`app/auth.py`) ahora bloquean con `403` cualquier ruta de sesión mientras `must_change_password=true` en la sesión, salvo `GET… |
| `PENTEST-004` | Cerrada la revocación de sesiones: migración `045` agrega `access_users.session_version` (default `1`). `require_read_access()`/`require_write_access()` comparan la versión cacheada en la sesión contra la base en cada request (una consulta… |
| `PENTEST-007` | Cerrado el bypass del límite de body vía `Transfer-Encoding: chunked`: `ApiSecurityMiddleware` (`http_security.py`) mide los bytes reales, acotado a `max_body_bytes + 1`, corta con `413` y reproduce sin cambios los cuerpos válidos. El… |
| `AUD-PERF-001` | `upsert_objects`/`upsert_relationships` (`cmdb_persistence.py`) y el upsert de miembros por Safe (`ingestion_persistence.py`) pasaron de un `execute` por fila a `executemany(returning=True)`; la resolución de endpoints de relaciones… |
| `TEST-PG-001` | `npm run verify` levanta ahora un PostgreSQL 18 efímero y aislado: descubre binarios con `pg_config`, inicializa UTF-8 en un directorio temporal, usa sólo socket local con `trust`, aplica migraciones con `ENV_FILE=/dev/null` y exporta… |
| `FE-DATA-001` | Adoptado **TanStack Query** como capa de server state del frontend. Dependencia de runtime `@tanstack/react-query` 5.104 (MIT) que pasó la revisión de supply chain. Un único `QueryClient` (`lib/query-client.ts`) con `staleTime` 30 s… |
| `AUD-PERF-003` | Segunda ronda de la medición de renders de la tabla de Safes, con **465 Safes** (Playwright + API mockeada + un contador temporal dentro de `SafeTableRow`, no comiteado). La ronda anterior había estabilizado props y callbacks; quedaban dos… |
| `AUD-CLEAN-004` | Cerrado el código muerto identificado en la segunda tanda de `FE-DATA-001`: `use-access-concentration.ts`, `use-inventory-freshness.ts`, `use-pam-chain.ts`, `use-posture-snapshot.ts` y `use-ingestion-runs.ts` sin ningún importador en todo… |
| `CHAIN-011` | Filtro de texto opcional dentro de las columnas PAM. `GET /api/chains/pam/expand` acepta `q` (máx. 160, se recorta) y `expand_chain_node(query=...)` filtra por subcadena literal case-insensitive sobre los dos campos ya allowlisteados… |
| `TOOL-LINT-001` | Ruff 0.16.9 con reglas `F` y `B` (sin `S608`, documentado en `pyproject.toml`) como dependencia de desarrollo declarada en `backend/requirements-dev.txt`; `scripts/verify.sh` lo corre como paso [2/8] sobre `backend` y `scripts`. Al… |
| `AUD-API-002` | Cobertura de `response_model` completada en 9 tandas: **1)** auditoría/logs/eventos (`activity_models.py`); **2)** lecturas de inventario Safe/cuentas (`safe_read_models.py`, `safe_lifecycle_models.py`), validadas además contra datos… |
| `SIA-001` | Cerrado por decisión de producto explícita, no por implementación: se consultó si promover SIA a un segundo botón de dominio propio (backend ya listo desde la migración `044`: `domain:sia`/`sia_reader`/`access_domains.sia` activos) y la… |
| `NSK-DEV-002` | Drawer de detalle Netskope completada: muestra los atributos allowlisteados ya persistidos y un historial de hasta 20 snapshots del mismo `device_id`, con versión, SO, clasificación y último evento por corrida. Se añadió la tabla histórica… |
| `NSK-DUP-001` | Señal de higiene de identificadores Netskope: agrupa dispositivos activos por coincidencia exacta de `hostname` (con espacios externos recortados) y `username` (comparación insensible a mayúsculas), excluyendo valores vacíos y retirados… |
| `NSK-DEV-004` | Filtros operativos en Dispositivos Netskope: SO, versión de cliente, clasificación, estado de usuario y empresa (más el heartbeat existente). `DEVICE_FILTER_EXPRESSIONS` en `netskope_queries.py` es la allowlist compartida con las métricas… |
| `NSK-DEV-003` | Frescura de reporte de dispositivos Netskope. **Unidad confirmada contra el tenant (2026-09-23, consulta read-only):** `last_event_timestamp` es un número JSON en epoch **segundos** (10 dígitos; el máximo coincide con la última sync)… |
| `NSK-EVT-001` | Verificado contra el tenant (2026-09-23, read-only) antes de implementar: `last_seen_event` trae literales reales de desinstalación/deshabilitación (`Disconnected By Uninstall` 94, `Uninstalled` 58, `Admin Disabled` 14 de 8.891). `GET… |
| `NSK-CHG-001` | "Qué cambió desde la última sync": diff en SQL entre las dos últimas corridas Netskope **completas** (join a `cyberark_ingestion_runs.status = 'completed'`; una corrida fallida o en curso nunca se compara ni genera retirados) usando… |
| `NSK-VER-001` | Cumplimiento de versión del cliente Netskope contra **releases golden cargadas por un admin** (nunca inferidas de la versión más frecuente ni descargadas). Migración aditiva `059_netskope_baselines.sql` (tabla `netskope_baselines`, valor… |
| `NSK-FLT-001` | Composición de flota Netskope: fabricante, modelo, SO+versión y empresa con valores exactos (sólo `btrim`; verificado read-only que no hay variantes de mayúsculas y `HP`/`Hewlett-Packard` quedan separados a propósito). Mínimos de SO por… |
| `PENTEST-008` | Tabla `access_security_events` y migración 048 para telemetría persistente separada de la auditoría funcional: login exitoso/fallido, logout, bootstrap/autorregistro, rate limit, token técnico rechazado, sincronización OIDC y sesiones… |
| `PENTEST-005` | Corregida la frontera `X-Access-Token` vs sesión para que coincida con lo documentado en OpenAPI (lecturas sólo sesión; escrituras aceptan sesión o token). Los helpers `require_permission_read()`/`require_any_permission_read()` no tienen… |
| `PENTEST-011` | Eliminados los orígenes CORS implícitos `localhost:5173` y `127.0.0.1:5173`. Backend y middleware aceptan únicamente el `WEB_ORIGIN` configurado explícitamente; desarrollo local continúa cubierto porque `.env.example` ya declara su origen… |
| `PENTEST-006` | Rate limiting de login/bootstrap compartido entre workers mediante reserva atómica en PostgreSQL por IP y cuenta antes de ejecutar el KDF; hashes `scrypt` fuera del event loop en un pool dedicado limitado a 4 workers; contraseñas limitadas… |
| `IF-001` | Cerrado el crecimiento y la retención sin límite del rate limiter (revisión cruzada Codex, docs/ISSUES_FOUND_2026-09-12.md): cada `bucket_key` (IP/email) se hashea con HMAC-SHA256 (clave `SESSION_SECRET`) antes de tocar SQL, así que… |
| `IF-002` | Cerrada la falta de invariante transaccional "al menos un admin activo": nuevo `app/repositories/admin_invariant.py` con un lock compartido (`pg_advisory_xact_lock`) y una función de aserción, usados consistentemente por `update_user`… |
| `IF-003` | Cerrado el parche vacío silencioso: `UserUpdate` ahora rechaza con `422` un payload sin ningún campo, antes de llegar al repositorio. La reestructuración de `update_user` en una sola transacción (parte del fix de IF-002) ya había cerrado… |
| `IF-004` | Cerrada la asimetría de auditoría en `update_role`/`update_composite_role`: `before_data` ahora incluye los `permission_codes`/`level_refs` que el rol tenía antes del cambio (leídos de `access_role_permissions`/`access_custom_role_levels`… |
| `IF-005` | `backend/.python-version` fija `3.14` (el runtime realmente probado). Tres tests nuevos con timeout acotado prueban que `hash_password_async`/`verify_password_async` terminan bajo el loop asyncio por defecto (nunca uvloop) en 5-10s, solos… |
| `IF-006` | Nueva suite de integración contra PostgreSQL real, opt-in vía `CUSTODIA_TEST_DATABASE_URL` (nunca `.env.local`/`DATABASE_URL` — ver el incidente corregido en `a19f569`): el advisory lock de IF-002 serializa dos transacciones reales; 20… |
| `IF-007` | Se retiró .github/workflows/ci.yml porque los runners hospedados están deshabilitados para este repositorio. Se conservan los gates locales `npm run verify`, `npm run verify:e2e` y `npm run verify:supply-chain`, además de los runtimes… |
| `IF-014` | `backend/requirements.lock.txt`: lockfile con hashes generado con `pip-compile` contra PyPI real, confirmado instalable. |
| `IF-012` | `docs/operations/deployment.md` marca explícitamente los comandos de build de Docker como diseño futuro no ejecutable contra el estado actual del repo. |
| `PENTEST-010` | Nueva variable `EXPOSE_API_DOCS` (default `true`) gatea Swagger/ReDoc/`openapi.json` en `app/main.py` vía la función pura `app.config.api_docs_urls()`. `.env.example`/`docs/operations/deployment.md` exigen `EXPOSE_API_DOCS=false` en… |
| `PENTEST-012` | CSP de `frontend/nginx.conf`: `style-src` ya no lleva `unsafe-inline` (el frontend no usa `<style>`/`dangerouslySetInnerHTML`); `style-src-attr` lo conserva para los `style={{...}}` inline de React. Checklist de hardening de proxy/TLS… |
| `PENTEST-009` | Política de contraseñas alineada a NIST SP 800-63B/OWASP: mínimo 15 caracteres (antes 8), sin reglas de composición obligatorias, blocklist local estática de contraseñas comunes/filtradas (`app/services/common_passwords_blocklist.txt`, sin… |
| `NSK-ADEM-POP-001` | Código y contrato acotado contrastados en `2959fd6` el 2026-09-30: `get_adem_pops` en `integrations/netskope.py`, GET `/api/cmdb/netskope/experience/pops` en `cmdb_netskope.py`, ventanas 2/24/48 h y sólo códigos POP/período, sin… |
| `NSK-ADEM-USERPOP-001` | Código presente en `cmdb_netskope_experience.py`, cliente ADEM y workspace/drawer Netskope: detalle bajo demanda por usuario/dispositivo/ventana, IDs literales, procedencia y `activity_status` honesto… |
| `FE-MOTION-001` | Fase 1 del sistema de movimiento, sin dependencia nueva. `frontend/src/styles/motion.css` concentra los tokens (`--motion-fast` 140 ms, `--motion-base` 190 ms, `--motion-panel` 210 ms, curvas de entrada/salida) y se importa desde… |
| `HOME-WHEEL-001` | Rueda de Inicio rediseñada como círculo completo con las tres plataformas equidistantes a 120° alrededor del centro (Personas cuando el actor tiene acceso, Custodia si no). Geometría pura y determinista nueva en… |
| `DOCS-PORTAL-001` | Ayuda / Documentación: guía de producto separada de la referencia técnica. Entrada neutral del catálogo (`help`, ruta `/help`, gate `open` para todo actor autenticado, dominio Custodia) con índice editorial versionado en TypeScript… |
| `UX-PERSON-002` | Plataformas primero: se revierte la prominencia de Identity Administration y SIA que había creado `UX-PERSON-001`. Inicio vuelve a mostrar únicamente CyberArk, Netskope y BigID DSPM planned alrededor de Personas, sin satélites, líneas ni… |
| `UX-PERSON-001` | Personas e Inicio dejaron la órbita plana por una topología determinista compartida: Persona al centro; CyberArk PAM y Netskope como ramas principales; Identity Administration y SIA son los **dos únicos** hijos visuales de PAM. La… |
| `UX-SEARCH-001` | Command-K v2 deriva vistas navegables desde el catálogo autorizado y conserva las acciones imperativas separadas. Clasifica explícitamente cada resultado como `Vista`, `Acción`, `Widget` o `Inventario` y como CyberArk, Netskope o Custodia… |
| `UX-IA-001` | Personas dejó de presentarse como una vista de CyberArk PAM y pasó a ser capacidad transversal de **Custodia**, sin alterar su ruta `/chains/person`, gate ni permisos alternativos (`pam:catalogs_read`, `identity:catalogs_read`… |
| `FE-DEVTOOLS-001` | Piloto **adoptado** de `@tanstack/react-query-devtools@5.104.0`, agregado sólo como dependencia de desarrollo. `frontend/src/main.tsx` lo renderiza dentro del `QueryClientProvider` únicamente cuando `import.meta.env.DEV` es verdadero y… |
| `FE-TEST-001` | Piloto **adoptado** de React Testing Library + `jsdom` (dependencias de desarrollo) para reescribir `tests/pam-refresh-contract.unit.test.ts`: dejó de leer `use-dashboard-preferences.ts`/`use-executive-analytics.ts` con `readFileSync` y… |
| `TEST-PROP-001` | Piloto de **Hypothesis** (sólo dependencia de desarrollo, `hypothesis>=6,<7`) sobre cuatro parsers puros hasta ahora probados sólo con ejemplos elegidos a mano: `normalize_person_email`, `resolve_psm_server_id`, `_epoch_to_datetime` y… |
| `BE-RETRY-001` | El cálculo de "cuánto esperar" antes del próximo reintento estaba copiado a mano en tres transportes con diferencias sutiles (`services/cyberark_transport.py`, `integrations/netskope.py`, `integrations/oauth_client.py` compartido por… |
| `NSK-DEV-001` | **Enriquecimiento `observed_user` en dispositivos**, sin persistir una relación nueva. El inventario de dispositivos conserva `user_key`/`username` como atributo; la lectura operativa resuelve el usuario observado por igualdad exacta… |
| `NSK-XMET-001` | **Métricas cruzadas usuario-dispositivo** sobre la resolución exacta de `NSK-DEV-001`, calculadas una sola vez en SQL agregado server-side (`repositories/netskope_shared.py:observed_user_match_ctes`, reutilizada por… |
| `NSK-ALR-001` | **Inventario de alertas Netskope y alertas más frecuentes**, pipeline count-only con snapshots agregados en ventanas 7/30/90 días (migración `060_netskope_alert_aggregates.sql`), sin eventos individuales ni PII. Decisión cerrada: conservar… |
| `NSK-MET-COHORT-001` | Por ventana se selecciona una sola corrida Netskope completada; sus buckets y fechas no se mezclan con corridas anteriores. Total ausente se representa como `null`/`incomplete`, cero real sigue siendo `complete`, y snapshots de más de 24 h… |
| `NSK-MET-DENOM-001` | Rankings Netskope muestran población completa, conteos visibles y «Sin dato» por separado; porcentajes usan el denominador solo cuando es coherente. Las barras Top-N conservan el drill; el resto aparece solo si es válido y no es clicable… |
| `SIA-TGT-001` | Catálogo read-only de target sets de SIA, opcional (`CA_SIA_TARGET_SETS_PATH`, vacío por defecto) y aislado en `source_system = sia` con tipo propio `sia_target_set` (migración `074` y baseline regenerado). **Forma confirmada el 2026-10-02… |
| `CPM-001` | Aceptado por el dueño con alcance reducido; cierre 2026-10-03 |
| `NSK-DLP-001` | Alertas DLP mínimas por usuario, sin artefacto sensible. Migración aditiva `069` (`netskope_dlp_alerts` + `netskope_dlp_capture_state`) y permiso estrecho `netskope:dlp_read`, creado sin otorgarlo a ningún rol y sin ensanchar… |
| `NSK-DEM-INV-001` | Código cerrado en `eb9fc18` (2026-09-29): inventario read-only de sitios DEM opt-in con array directo y allowlist de identificador, nombre, revisión, fechas, conteos y `pop_tracing` reducido a `gslb`/`method`/`period`. Migración 070 agrega… |
| `NSK-XMET-003` | **Listado accionable de usuarios con actividad reciente.** La tarjeta “Usuarios con actividad reciente” abre Inventario → Usuarios con la ventana elegida (7/14/30 días) mediante el botón “Ver usuarios”. Nuevo filtro server-side… |
| `LIVE-001` | Actualización entre sesiones mediante eventos y polling pausado en pestañas ocultas. |
| `AUD-001` | Auditoría transaccional de corridas de sincronización. |
| `SRCH-001` | Buscador global agrupado y navegable sobre inventario no secreto. |
| `VIEW-005` | `25268ce` |
| `VIEW-003` | `4fc8110` |
| `VIEW-004` | `5726134`, `e648b82`, `3f447dc`, `aafa727` |
| `APIDOCS-001` | `fe1969f` |
| `SAFE-TYPE-001` | `a774de6` |
| `CHAIN-A1` | `b132085` |
| `CHAIN-DATA-001` | `d603f9a` |
| `CHAIN-009` | `758ad1f` |
| `CHAIN-005` | `57f967e`, `b15972f`, `4eede87` |
| `CHAIN-010` | `a599a3a` + rediseño radial (`feat/person-radial`) |
| `FE-API-001` | `c96e5d9` |
| `CHAIN-008` | `39001b5` |
| `CHAIN-013` | `5d43a29`, `3b44200` (más el fix `62dd812` de badges de vecinos) |
| `CHAIN-007` | cerrado con `CHAIN-010` |
| `CHAIN-DATA-002` | `d603f9a` |
| `JIRA-SYNC-001` | Sin commit de código; cierre 2026-10-01 con evidencia en Jira (épica `SECOPS26-807`) |
| `INT-002` | Sin commit (validación operativa contra el tenant; probe autorizado 2026-10-01) |
| `NSK-RBAC-PROBE-001` | Sin commit; probe ejecutado 2026-10-01 |
| `NSK-DEVCLS-PROBE-001` | Sin commit; probe ejecutado 2026-10-01 |
| `SIA-RES-001` | Inventario SIA de recursos Database/VM (nombre, tipo, servicio, método de autenticación, ubicación, strong account/certificate como referencia) |
| `SIA-CONN-001` | Inventario de SIA Connectors |
| `SIA-STRONG-001` | Catálogo de Strong accounts SIA (VM y Database) |
| `ID-001` | Directorios y políticas de Identity Administration |

### 1 a 3 de octubre

| ID | Cierre |
|---|---|
| `ACCESS-OIDC-GROUPS-OBSERVED-001` | Usuarios muestra los grupos mapeados y sus miembros observados en el último login. Persistencia aditiva en migración 076, sin inferir pertenencia desde roles ni rellenar identidades anteriores. Reemplazo auditado y atómico; lectura por… |
| `NSK-MET-LOAD-001` | Selección allowlisteada por registro, una proyección por filtros únicos, cola de dos solicitudes con cancelación y AA independiente del inventario SQL. |
| `NSK-MET-UX-001` | El selector de datos y gráficos agrupa los 28 widgets en inventario/cobertura (22) y alertas/protección (6); «Políticas y uso» no se muestra mientras no exista un binding aprobado. Cada tarjeta informa fuente, período y disponibilidad… |
| `FE-TEST-ORG-001` | 59 archivos unitarios y 25 specs E2E por plataforma/herramienta, con discovery recursivo y 353 ejecuciones E2E conservadas. |
| `NSK-MET-REGISTRY-001` | Registro SSE, aprobación AA y compatibilidad verificados; detalle a continuación. |
| `PAM-GRP-001` | Workspace de sólo lectura de grupos vacíos, conjuntos de miembros idénticos, grupos redundantes frente a un par con acceso, PSM sin plataformas, plataformas sin cuentas y Safes sin usuarios activos. Consulta server-side sobre inventario… |
| `SAFE-READ-UX-001` | Presentación de Safes: barra compacta (búsqueda, Estado, Unidad, Responsable, Exportar), «Más filtros (N)» y chips removibles de los diez filtros activos, incluido «Acción siguiente», con «Limpiar filtros» visible con el panel cerrado. Los… |
| `SIA-LINK-UX-001` | Políticas SIA: la fila expandida es la única superficie de «Destinatarios» (`sia-grantee-detail.tsx`) con resumen por lado autorizado (vinculados / ambiguos / sin coincidencia sobre N destinatarios, fuente visible), filtros locales de… |
| `NSK-INVENTORY-UX-001` | Inventario Netskope: buscador y señal de revisión como entrada rápida; filtros agrupados en «Identidad y equipo» y «Actividad observada» (`netskope-device-filters.tsx`), con indicador de activos y chips removibles… |
| `METRIC-READ-UX-001` | Piloto: nombre de negocio primero en los defaults y KR1 PAM con el código conservado como texto secundario; `metric-reading.tsx` presenta «qué mide / población / período» con disclosure por teclado (fórmula, fuente, límites) reutilizando… |
| `NSK-POSTURE-UX-001` | Vista de Postura Netskope en tres niveles («Qué revisar», «Evidencia de actividad», «Cumplimiento y composición»), con motivo y población en cada conteo y nota de superposición: los candidatos a revisar son la intersección de heartbeat… |
| `TEST-NSK-001` | Los dos unitarios Netskope que estaban en rojo quedaron verificados: `npm --prefix frontend run test:unit` = 311/311 en `46fed4e`, incluidos `chain-columns.unit.test.ts` (columnas fijas y aserción exacta de `{ node, relation }`) y… |
| `REL-001` | Vínculo read-only de grantees de usuario de políticas SIA con Identity/PAM por correo exacto 1-a-1, reutilizando `services/person_email_matching.py`; permisos por lado, sin migración ni aristas persistidas y sin ampliar cobertura ni KPIs… |
| `DOCS-TRACK-001` | Encabezados de `TO_IMPLEMENT.md` e `IMPLEMENTED.md` actualizados al commit contrastado `d947b37`. Verificado que lo entregado en `66cc359`, `4121e4f`, `2959fd6`, `dc58bd2` y `78697e0` tiene su registro en `IMPLEMENTED.md`… |
| `NSK-ADEM-UX-001` | Experiencia digital presentada como observaciones en ventana: cabecera «Dispositivos y POPs informados» con usuario Netskope, fuente y ventana; «ADEM»/«Experiencia digital» como nomenclatura secundaria; se retiraron el lenguaje de… |
| `FE-DEAD-001` | Barrido de imports/exports y entradas Vite (index, routers lazy, imports dinámicos, scripts, tests) y retiro, con aprobación archivo por archivo, de `domains/registry.ts`, `lib/pam-chain-layout.ts` y `lib/netskope-event-time.ts` con sus… |
| `FE-AVATAR-CONTRAST-001` | `styles.css`: el texto de `.identity-avatar.av-0…av-4` mezcla el tono de serie al 60 % con `--text-primary`, lo que lo oscurece en tema claro y lo aclara en oscuro. Contraste calculado ≥ 4.75:1 en ambos temas (antes 2.98–4.52 en claro y… |
| `PERSON-FOCUS-UX-001` | `person-client-coverage.tsx`: con una persona seleccionada, «Persona · detalle individual» (estado, causa y dispositivos) va antes del agregado, que queda en un grupo rotulado «POBLACIÓN TOTAL · CONEXIONES · CONN-001/v1»; el orden cambia… |
| `CONN-001` | Piloto `CONN-001/v1` de cliente Netskope activo y observado recientemente por persona: población de usuarios humanos activos de Identity Administration, vínculo exacto 1-a-1 por correo con Netskope, estados cubierta / parcial / brecha /… |
| `CONN-NAV-001` | Conexiones publicada como agrupación transversal de Custodia: categoría del selector, sección de Inicio, búsqueda y guía, con marca neutral `CustodiaMark`, que contiene sólo Personas; la cobertura `CONN-001/v1` vive dentro de Personas. El área… |
| `RISK-ENT-001` | Nombre de la entidad en los hallazgos de CyberArk Risk Management, con un permiso propio y estrecho. Decisión del dueño el 2026-10-02: hasta entonces la tabla mostraba sólo IDs opacos (`entityDisplayName` estaba excluido) y el operador… |
| `RISK-001` | Postura de riesgo de CyberArk en vivo y de sólo lectura junto a los hallazgos locales. Cliente GET-only de Risk Management (`https://{subdominio}.compass.cyberark.cloud`, subdominio derivado de `CA_PVWA_URL`, token OAuth del plano… |
| `POSTURE-REFRESH-001` | Un fallo del recálculo de hallazgos ya no deja la sincronización PAM como `completed`. `run_ingestion` calculaba el estado y finalizaba la corrida antes de llamar a `refresh_findings`, y un fallo sólo se registraba en el log: Postura… |
| `MOD-FE-001` | Cierre de la modularización del frontend por herramienta. Las dependencias que cruzan fronteras bajan de 34 a 9 y `cross/` ya no importa código de ninguna herramienta: los tipos genéricos (`AnalyticsBucket`, widgets del dashboard, contrato… |
| `UX-SYNC-001` | Sincronización informada por herramienta, no por feature. La cola de Actividad muestra una fila por herramienta y ciclo («CyberArk», «Netskope»; ventana de 15 min anclada a la corrida más reciente) con estado agregado (en curso > fallida >… |
| `CONN-UX-001` | Personas: buscador primero, chips de fuente sin apariencia deshabilitada, cobertura compacta con causa explícita y trazabilidad técnica desplegable, sin truncamiento a 1280×720 y 1440×900 en dark/light. Regresiones en… |
| `CONN-TEST-001` | Regresión de la rama `not_applicable` del detalle (fuentes vigentes) y de `unknown` (fuente vencida), y test que fija que cada rama devuelve exactamente los campos de `PersonClientCoverageDetail` con `devices_not_recent` y sin… |
| `PAM-CLEAN-UX-001` | Limpieza PAM: seis resúmenes globales siempre visibles, selector de categoría y búsqueda por objeto/par que acotan sólo el detalle («Mostrando N de M»), aviso de que las categorías se superponen y no suman objetos únicos, sin acciones de… |
| `PAM-CLEAN-FRESH-001` | La fecha de cálculo se separa de la última ingesta pertinente (estado y fechas de la corrida PAM), con «frescura no disponible» cuando falta evidencia y aviso de que recalcular no actualiza la ingesta; cero señales sin inventario no se… |
| `PAM-POSTURE-UX-001` | `/pam/posture`: tabla unificada de hallazgos con columna Fuente (Custodia / CyberArk), modelos, detalle y paginación independientes por origen, sin deduplicación, ranking ni totales combinados; filtros y seguimiento local sólo para Custodia… |

### 7 a 9 de octubre

| ID | Cierre |
|---|---|
| `ARCH-LAYERS-002` | Ningún módulo de `api/routes/` importa `repositories/`: el Controller llama a `services/`. Servicios con lógica de dominio (errores de persistencia traducidos a errores de dominio que la ruta sólo mapea a HTTP, orden de pasos y auditoría)… |
| `ARCH-LAYERS-001` | Ningún módulo de `services/` ejecuta SQL. `pam_accounts.py` delega en `cyberark/pam/repositories/account_sync.py` (cuentas, retiro de ausentes y `retention_hold` con su auditoría siguen en una sola transacción); `ingestion_persistence.py`… |
| `DOCS-GEN-002` | `scripts/generate_access_catalog.py` genera `docs/architecture/access-catalog.md` (dominios y niveles, roles y permisos con los roles que los conceden) leyendo el catálogo de un PostgreSQL con las migraciones aplicadas: reutiliza… |
| `DOCS-GEN-001` | `scripts/generate_api_reference.py` genera `docs/architecture/api-reference.md` (182 operaciones y el recuento de permisos) desde las rutas montadas y sus dependencias de autorización, sin servidor ni base de datos. Reconoce… |
| `DOCS-ADR-001` | Cinco ADR cortos en `docs/architecture/decisions/` (contexto, decisión, aprobación, límites y test que la hace cumplir): puente Identity→PAM por `source_id` (2026-08-29), vínculo de personas por correo (2026-09-25), acceso por rol por… |
| `DOCS-META-001` | Los 51 `.md` de `docs/` empiezan con `estado` (vigente o histórico), `dueño` y `revisado`. `npm run docs:check` falla si falta o es inválido (estado, dueño, fecha, fecha futura, carpeta de registros con estado vigente) y avisa de los… |
| `DOCS-LINT-001` | `scripts/check-docs.mjs` valida en `verify` tres cosas: enlaces relativos y anclas entre docs, rutas del repo citadas en `AGENTS.md` y `docs/`, e IDs de tracker citados fuera de los trackers. Cada error dice archivo, línea y cómo… |
| `DOCS-IDX-001` | `IMPLEMENTED.md` (1.667 líneas) pasó a ser un índice de 102 líneas con una entrada por sección y sus IDs; el detalle se movió sin cambios a docs/tracking/done/ en cinco archivos por periodo (de 242 a 483 líneas), con los enlaces… |
| `FE-CSS-001` | `frontend/src/styles.css` pasó de 3.846 a 786 líneas sin cambiar el resultado visual. Se eliminaron 202 reglas y 24 selectores muertos (435 líneas) y 160 declaraciones siempre anuladas por una regla posterior. Los estilos de cada… |
| `UX-AUD2-009` | Cerrado el 2026-10-08 contra las 17 filas de la lista previa del checkpoint. Formato absoluto común con tooltip relativo («en…» para fechas futuras), epoch en segundos convertido explícitamente, ISO original en `datetime` y «Sin fecha»… |
| `UX-AUD2-024` | Cerrado el 2026-10-08 contra las trece filas de la lista previa del checkpoint. Buscadores del sistema en Actividad/Logs/Errores, Políticas/UCI, destinatarios SIA, Limpieza y Roles, conservando filtros y flujos. Unidad sin asignar neutra… |
| `UX-AUD2-023` | Cerrado el 2026-10-08 contra las siete filas de la lista previa del checkpoint. Conectores PSM reparten las columnas y conservan nombres completos y navegación; SIA mantiene versiones atómicas. Dispositivos Netskope reserva espacio para… |
| `UX-AUD2-022` | Cerrado el 2026-10-08 contra las trece filas de la lista previa del checkpoint. SIA › Políticas usa un único drawer de detalle (foco contenido, Escape restaura el botón, scroll interno) sin panel lateral ni fila expandida duplicada; la… |
| `UX-AUD2-021` | Cerrado el 2026-10-08 contra las nueve filas de la lista previa del checkpoint. PAM y SSE conservan un título por sección, sin capas de bienvenida, subtítulos metodológicos ni contadores de datos/bloques redundantes. Lectura, edición… |
| `UX-AUD2-015` | Cerrado el 2026-10-08 contra la lista previa de catorce filas del checkpoint. Safes (Vigentes/Retiradas), Identity, roles PAM, SIA, Access, infraestructura, conectores, plataformas e inventario Netskope conservan un H1 y una descripción de… |
| `UX-AUD2-019` | Cerrado el 2026-10-08. Se quitaron columnas independientes de Tipo en Identity, Fuente/Categoría en Hallazgos, Estado en Access, Tipo/Ubicación en VMs SIA, Primera/Última observación en usuarios Netskope y Diagnóstico en equipos Netskope… |
| `UX-AUD2-008` | Cerrado el 2026-10-08. Header, Métricas e Inventario (equipos y usuarios) comparten el estado y la frescura del último intento del inventario de clientes Netskope, con el mismo texto y una petición compartida. El estado es visible para… |
| `UX-AUD2-004` | Cerrado el 2026-10-08. Código: distribuciones Netskope compartidas, doce → seis consultas. El dueño midió treinta rondas por variante con backend caliente y código 3920897b/e739c951: todas 200; p95 0,59 s Cobertura, 0,76 s overview, 0,40 s… |
| `UX-AUD2-018` | Ayuda junto al título de Salud PAM; método y límites del vínculo Netskope reunidos en ayuda; filtros activos vacíos omitidos; Hallazgos mantiene alcance y procedencia sin repetir la aclaración. Completa Limpieza, Relaciones y Steering ya… |
| `UX-AUD2-017` | Vistas en lugar de workspace, evidencia Standard explicada y Target traducido a Destino. Test de copy sin snake_case en seis rutas, con exclusión de nombres/IDs reales; prueba propietaria de Limpieza cubre la séptima superficie. Mantiene… |
| `UX-AUD2-014` | Resultados remotos omiten subtítulo idéntico e insignia Inventario redundante con el grupo; mantienen detalles distintos. Conserva un cierre en la barra y aplica el filtro del Safe al seleccionar. Regresión dark/light falla antes por texto… |
| `UX-AUD2-020` | VMs, cuentas BD, target sets y activos Access evitan repetir IDs iguales al nombre; conservan IDs distintos y el botón de copiar el original. Tipos BD/target set se muestran una vez en su columna. Ocho E2E en dark/light prueban texto y… |
| `UX-AUD2-013` | Usuarios y Actividad alinean sus bordes con la navegación; grupos Okta tienen padding; el pie de fuente Netskope alinea su texto con el contexto del inventario. Geometría desktop en ambos temas, con regresiones anteriores de 36 px y 24 px. |
| `UX-AUD2-007` | Etiquetas propietarias declaradas en `source.ts` para breadcrumb y selector. Cinco destinos E2E distinguen PAM, Identity, SIA, Access y SSE; tres etiquetas fallaban antes. |
| `UX-AUD2-010` | Ticks de inventario conservan fecha/hora entre días y segundos entre muestras del mismo minuto, sin descartar puntos. Regresión del formatter pasa de dos a seis etiquetas distintas; `<1%` conserva su E2E previo. |
| `UX-AUD2-016` | Inicio conserva un selector de herramienta y un logo; omite el selector de workspace redundante. E2E dark/light y control negativo que repone el selector y falla ambos casos. |
| `UX-AUD2-025` | Una fila de pestañas SIA, raíz Identity como alias canónico sin historia intermedia, Ayuda neutral y Administración restringida. Mantiene permisos, teclado, recarga, destinos legacy y APIs por herramienta. |
| `UX-AUD2-003` | El diff selecciona las dos últimas corridas completas Netskope con equipos antes de leer snapshots. Conserva fechas de captura y excluye flujos sin equipos. `EXPLAIN ANALYZE` real: 751,844 y 532,971 ms, frente al timeout de 15 s. Cuatro… |
| `UX-AUD2-005` | Se completó la cobertura del cambio de caché de sesión de `ca0989a5`: cinco E2E cuentan una lectura de preferencias y de cada recurso Netskope observado. Un build temporal con el efecto anterior reproduce seis recursos duplicados y falla… |
| `UX-AUD2-001` | Resumen Safes toma únicamente la última corrida PAM, aunque Netskope tenga una más reciente. Regresión PostgreSQL con ambas fuentes. |
| `UX-AUD2-002` | La fecha de Actividad no se recorta. E2E comprueba el texto dentro de todos sus ancestros que recortan; falla con la regla CSS anterior. |
| `UX-AUD2-006` | Un deep link Netskope sin permiso vuelve a una vista autorizada Netskope y explica la redirección. E2E restringido identifica el aviso aunque exista un estado de carga simultáneo. |
| `UX-AUD2-011` | Tabla y drawer evitan repetir la marca en el modelo del equipo, con variantes HP/Hewlett-Packard y pruebas del helper. |
| `UX-AUD2-012` | La ausencia de correo en Identity muestra «—» en Federación; conserva los estados reales de conciliación. Prueba de resolución. |
| `UX-AUD2-026` | Salud PAM explica «N de D conectados» y traduce tres métricas conocidas; Steering presenta kilómetros. E2E de conectividad y prueba de conversión. |

### 10 de octubre

| ID | Cierre |
|---|---|
| `NSK-STEER-RET-001` | Se retiraron la vista "Túneles de steering", la tarea `netskope_steering`, la ruta `GET /api/cmdb/netskope/steering` y `NETSKOPE_STEERING_PATH`: el catálogo de POPs es igual para todos los clientes de Netskope y el tenant no tiene túneles… |
| `NSK-POSTURE-001` | Vista `/netskope/posture` (Resumen · Hallazgos agrupados por chequeo · Chequeos) y `GET /api/cmdb/netskope/posture` (`netskope:read` o `access:manage`). Chequeos evaluados al leer sobre el inventario ya sincronizado: cliente desinstalado o… |
| `NSK-POL-RETHINK-001` | La página Políticas se retiró: su tabla de políticas observadas en alertas (`GET /api/cmdb/netskope/observed-policies`, sin cambios) es la pestaña "Actividad de políticas" de Postura, con una nota visible que dice qué es el dato (nombres… |
| `NSK-EXP-DISCOVERY-001` | Probe de sólo lectura `scripts/probe_netskope_experience.py` (modos por defecto, `--client-tally` y `--uba`): informa forma y clase de campos sin imprimir IPs, correos ni identificadores. Resultados en `netskope-api.md`: On-Premises… |
| `UX-QA-001` | El encabezado distingue corrida fallida ("Última sincronización fallida", con fuente y hora en el `title`) y herramienta sin corridas ("Sin sincronizaciones todavía") de "Sincronización pendiente", que queda para estados no reconocidos con… |
| `UX-QA-002` | La tarjeta "En usuarios" (y "En equipos") de Postura Netskope muestra "No evaluado" cuando todos los chequeos de esa entidad están pendientes; `0` sólo con evaluación completa (`postureSummary` ahora cuenta chequeos evaluados por entidad)… |
| `UX-QA-003` | Personas con una búsqueda sin coincidencias sugiere ajustar el término y oculta "Elegí una persona…"; el estado inicial no cambia. E2E. |
| `UX-QA-005` | Plataformas PAM muestra el tipo en español (`pam/lib/pam-platform-types.ts`, con los 14 valores observados en el tenant) y conserva el valor de CyberArk en el `title`; un valor nuevo se muestra tal cual. Pruebas unitaria y E2E. |
| `NSK-EXP-ONPREM-001` | El sync de equipos guarda `onprem_status`, `onprem_method`, `client_config` y `steering_config` (categorías; sin IPs ni `match_ip`, test `test_onprem_detection_is_kept_as_categories_and_never_as_addresses`). `GET… |
| `NSK-EXP-USERLOC-001` | Al elegir un usuario, Experiencia digital muestra "Ubicación": veredicto (en oficina, fuera de oficina, sin dato, sin señal reciente, sin equipos) y la tabla de sus equipos con ubicación según On-Premises Detection, client config y última… |
| `UX-HELP-SHORT-001` | La ayuda de las tarjetas de datos Netskope queda en "Qué mide" + link a Ayuda; el detalle largo (conciliación con el «Total Users» de la consola, filas repetidas, diferencias esperadas frente a la consola) pasó a la guía de producto… |

### 11 de octubre

| ID | Cierre |
|---|---|
| `FE-AUD-001` | el hook expone error y reintento de la consulta de roles; test en `identity.spec.ts` |
| `FE-AUD-002` | `use-dashboard.ts` guarda el error de la lectura filtrada y vacía las filas de la página 0; `SafeTable` muestra error con reintento; test E2E en `safes.spec.ts` |
| `FE-AUD-003` | opciones sin conteo cuando falta el resumen (`cross/lib/connection-filter-options.ts`), aviso «Conteos no disponibles» con reintento; tests unitario y E2E |
| `FE-AUD-004` | «Captura completa»; una captura completa de más de 24 h queda en atención y lo dice (`netskope-dlp.ts`); tests unitario y E2E |
| `FE-AUD-005` | las cinco vistas de Actividad reciben `onUnauthorized` (admin router → ActivityWorkspace) y derivan el 401 al inicio de sesión; test E2E en `auth.spec.ts` |
| `FE-AUD-006` | `aria.label` de ECharts desactivado (conserva el nombre en español y los decal), bloque «Ver datos» con tabla y botones «Abrir» por teclado (`advanced-chart-rows.ts`, `advanced-chart.css`); tests unitario y E2E |
| `FE-AUD-007` | dos plataformas por PSM y «+N más» con `aria-expanded` (`ConnectorPlatforms`); test E2E a 1280 px con Axe |
| `FE-AUD-008` | búsqueda, estado y asiento estándar viajan en la URL (`identity-users-url.ts`, valores permitidos únicamente); recargar y compartir el enlace conservan el contexto; tests unitario y E2E |
| `NSK-IA-001` | Cuatro fases. 1: ficha de usuario con una sola tabla de equipos (ADR 006, nombre exacto y único). 2: «Dónde se conectan los equipos» vive en Equipos. 3: vista **Usuarios** (`/netskope/experience`: cola, Riesgo por empresa con… |
| `CA-IA-001` | Regla: máximo dos niveles (menú y pestañas). Fase 1: **Postura** con pestañas Riesgos y Depuración. Fase 2: **Servicio** con Salud y Conectores; Safes queda con Safes y Plataformas. Fase 3: Relaciones pasa a **Acceso**; Identidades queda… |
| `ACCESS-ROLES-002` | Migración 094, sólo altas. `admin` lista los permisos estrechos que ya alcanzaba por `access:manage` (los nueve `access:*`/auditoría, catálogos PAM, SIA e Identity) y suma `netskope:read` (métricas AA), `access:roles_manage` (plantillas… |
| `ACCESS-ROLES-003` | Migración 098, sólo altas: `admin` recibe todos los permisos activos, incluidos DLP y UCI de Netskope (decisión del dueño, revierte esa exclusión de `ACCESS-ROLES-002`). Un test exige que todo permiso activo futuro también se conceda a… |

### Movidos desde el tracker (2026-10-16)

| ID | Cierre |
|---|---|
| `NSK-INV-002` | Implementado (2026-10-13) — **Inventario: consulta, no clasificación.** Título «Inventario»; columnas Dispositivo · Usuario · Empresa · Señal (punto + tiempo relativo) · SO · Cliente; la fila se abre en una ficha corta (equipo, usuario, señal, experiencia ADEM del equipo con POP y puntaje, anomalías UEBA del usuario con `netskope:uba_read`) en vez del panel lateral; sin ID ni capturas. Postura agrupa los equipos sin… |
| `NSK-POLICY-004` | Implementado (2026-10-12) y pausada del menú (2026-10-13, decisión del dueño) — **Alertas DLP por política.** La vista deja de ser una tabla de alertas sueltas con usuario sin resolver y pasa a una fila por política (volumen de 30 días, últimos 7 contra los 7 anteriores, severidad, acción, última alerta) con los 5 incidentes recientes al abrirla: `GET /api/cmdb/netskope/dlp/policies`. Sin columna ni conteo de… |
| `NSK-AA-001` | Cerrado por reemplazo (2026-10-12) — **Severidad desde AA.** El tenant no tiene un widget de dos columnas con todas las alertas; `alerts_by_severity` salió del selector y la severidad por tipo se consume con el mapa (`NSK-AA-CHARTS-001`, «Malware por severidad»). El código del contrato con aprobación queda sin uso hasta decidir su retiro. — Reabrir sólo si el equipo pide la severidad de todas las alertas: requiere… |
