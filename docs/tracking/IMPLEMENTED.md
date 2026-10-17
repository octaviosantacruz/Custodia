---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-15
---

# Implementado en Custodia

Índice del trabajo cerrado. El detalle de cada cierre (entrega, evidencia, commit)
vive en `done/`, un archivo por periodo; aquí hay una línea por sección con sus IDs.
`scripts/check-task-trackers.mjs` lee este índice y todos los archivos de `done/`.

**Cómo registrar un cierre nuevo:** agregar la sección al archivo del periodo en
curso (el primero de la lista; crear uno nuevo cuando supere unas 400 líneas) y una
línea en este índice. No repetir IDs de `TO_IMPLEMENT.md`: al cerrarse salen de allí.

## 15 de octubre de 2026 — [`done/2026-10-15.md`](done/2026-10-15.md)

- [Sin inventariar: direcciones observadas y alta](done/2026-10-15.md#sin-inventariar-direcciones-observadas-y-alta) — `COV-008`
- [Revisión de accesos con señales](done/2026-10-15.md#revisión-de-accesos-con-señales) — `ACCESS-REVIEW-001`
- [Exportar Actividad auditada](done/2026-10-15.md#exportar-actividad-auditada) — `ACCESS-AUDIT-EXPORT-001`
- [Descartado: vencimiento de asignaciones manuales](done/2026-10-15.md#descartado-vencimiento-de-asignaciones-manuales) — `ACCESS-UI-002`
- [Menos texto en pantalla (cierre)](done/2026-10-15.md#cierre-de-ux-copy-001) — `UX-COPY-001`
- [Destinos sin movimiento en Avance](done/2026-10-15.md#destinos-sin-movimiento-en-avance) — `COV-007`
- [Avance de la cobertura por responsable](done/2026-10-15.md#avance-de-la-cobertura-por-responsable) — `COV-006`
- [Menú de usuario sin «Incluir internos»](done/2026-10-15.md#menú-de-usuario-sin-incluir-internos) — `UX-PROFILE-001`

## 14 de octubre de 2026 — [`done/2026-10-14.md`](done/2026-10-14.md)

- [Avance de la cobertura y tendencia semanal](done/2026-10-14.md#avance-de-la-cobertura-y-tendencia-semanal) — `COV-005`; con esto se cierra el plan de Cobertura
- [Estados de trabajo, responsable, nota e historial por destino](done/2026-10-14.md#estados-de-trabajo-responsable-nota-e-historial-por-destino) — `COV-004`
- [Declarado y observado por capacidad, con desvíos](done/2026-10-14.md#declarado-y-observado-por-capacidad-con-desvíos) — `COV-003`
- [Cobertura: ABM de destinos y rediseño](done/2026-10-14.md#cobertura-abm-de-destinos-y-rediseño) — alta, edición, retiro y lote; parte entregada de `COV-004`
- [Avisos con el logo de la herramienta](done/2026-10-14.md#avisos-con-el-logo-de-la-herramienta) — el aviso de una pantalla de CyberArk o Netskope lleva su logo
- [Inventario de destinos: importar con vista previa y exportar](done/2026-10-14.md#inventario-de-destinos-importar-con-vista-previa-y-exportar) — `COV-002`
- [Actualizar datos sin confirmación](done/2026-10-14.md#actualizar-datos-sin-confirmación) — se quita la comparación previa de Safes
- [Anomalías UBA por usuario](done/2026-10-14.md#anomalías-uba-por-usuario) — parte entregada de `NSK-UBA-003`
- [Tabla de Usuarios de Identity a 1280 px](done/2026-10-14.md#tabla-de-usuarios-de-identity-a-1280-px) — `UX-QA-006`
- [Linter del frontend con reglas de hooks](done/2026-10-14.md#linter-del-frontend-con-reglas-de-hooks) — `TOOL-LINT-002`
- [Score de experiencia ADEM por usuario y equipo](done/2026-10-14.md#score-de-experiencia-adem-por-usuario-y-equipo) — `NSK-ADEM-SCORE-001`
- [Permisos de lectura y gestión para Safes y Cobertura](done/2026-10-14.md#permisos-de-lectura-y-gestión-para-safes-y-cobertura) — `COV-001`
- [Administradores y roles de Netskope](done/2026-10-14.md#administradores-y-roles-de-netskope) — `NSK-RBAC-001`
- [Puente entre nodos en el login](done/2026-10-14.md#puente-entre-nodos-en-el-login) — `AUTH-LOGIN-UI-003`
- [Fondo del login y descripción del portal](done/2026-10-14.md#fondo-del-login-y-descripción-del-portal) — `AUTH-LOGIN-UI-002`
- [Pantalla de login en una tarjeta](done/2026-10-14.md#pantalla-de-login-en-una-tarjeta) — `AUTH-LOGIN-UI-001`
- [Grilla de gráficos común a PAM y Netskope](done/2026-10-14.md#grilla-de-gráficos-común-a-pam-y-netskope) — `DASH-GRID-001`

## 13 de octubre de 2026 — [`done/2026-10-13.md`](done/2026-10-13.md)

- [Login principal por Okta y cuenta local de automatización](done/2026-10-13.md#login-principal-por-okta-y-cuenta-local-de-automatización) — `AUTH-AGENT-001`

- [Contraste de tipos de rol de Identity](done/2026-10-13.md#contraste-de-tipos-de-rol-de-identity) — `FE-AUD-013`
- [Contraste del contador de Plataformas PAM](done/2026-10-13.md#contraste-del-contador-de-plataformas-pam) — `FE-AUD-010`

- [Contraste de las cuentas Okta en Usuarios y permisos](done/2026-10-13.md#contraste-de-las-cuentas-okta-en-usuarios-y-permisos) — `FE-AUD-014`

- [Contraste de la insignia Standard](done/2026-10-13.md#contraste-de-la-insignia-standard) — `FE-AUD-012`

- [Desplazamiento por teclado en Depuración](done/2026-10-13.md#desplazamiento-por-teclado-en-depuración) — `FE-AUD-011`

- [Revisión adicional de interfaz con datos reales](done/2026-10-13.md#revisión-adicional-de-interfaz-con-datos-reales) — `FE-AUD-009`

- [Vigencia del inventario en Equipos](done/2026-10-13.md#vigencia-del-inventario-en-equipos) — `NSK-FLEET-002`

- [Equipos y Postura, una pregunta cada una (cierre 2026-10-13)](done/2026-10-13.md#equipos-y-postura-una-pregunta-cada-una-cierre-2026-10-13) — `NSK-FLEET-001`

## 12 de octubre de 2026 — [`done/2026-10-12.md`](done/2026-10-12.md)

- [Gráficos de Métricas Netskope sin texto repetido (2026-10-12)](done/2026-10-12.md#gráficos-de-métricas-netskope-sin-texto-repetido-2026-10-12) — `NSK-MET-UX-002`
- [Retiro del ranking «Políticas observadas en alertas» (2026-10-12)](done/2026-10-12.md#retiro-del-ranking-políticas-observadas-en-alertas-2026-10-12) — `NSK-MET-POL-002`
- [Editor de bloques con panel lateral y gráficos dona/barras (2026-10-12)](done/2026-10-12.md#editor-de-bloques-con-panel-lateral-y-gráficos-donabarras-2026-10-12) — `NSK-MET-UX-003`

## 11 de octubre de 2026 — [`done/2026-10-11.md`](done/2026-10-11.md)

- [Auditoría de frontend, hallazgos validados (2026-10-11)](done/2026-10-11.md#auditoría-de-frontend-hallazgos-validados-2026-10-11) — `FE-AUD-001`, `FE-AUD-002`, `FE-AUD-003`, `FE-AUD-004`, `FE-AUD-005`, `FE-AUD-006`, `FE-AUD-007`, `FE-AUD-008`
- [Reordenar Netskope por pregunta (2026-10-11)](done/2026-10-11.md#reordenar-netskope-por-pregunta-2026-10-11) — `NSK-IA-001`
- [Reordenar CyberArk por pregunta (2026-10-11)](done/2026-10-11.md#reordenar-cyberark-por-pregunta-2026-10-11) — `CA-IA-001`
- [Roles sembrados al día (2026-10-11)](done/2026-10-11.md#roles-sembrados-al-día-2026-10-11) — `ACCESS-ROLES-002`, `ACCESS-ROLES-003`

## 10 de octubre de 2026 — [`done/2026-10-10.md`](done/2026-10-10.md)

- [Retiro de Túneles de steering (2026-10-10)](done/2026-10-10.md#retiro-de-túneles-de-steering-2026-10-10) — `NSK-STEER-RET-001`
- [Postura Netskope, fase 1 (2026-10-10)](done/2026-10-10.md#postura-netskope-fase-1-2026-10-10) — `NSK-POSTURE-001`
- [Políticas pasa a Postura (2026-10-10)](done/2026-10-10.md#políticas-pasa-a-postura-2026-10-10) — `NSK-POL-RETHINK-001`
- [Descubrimiento de Experiencia digital (2026-10-10)](done/2026-10-10.md#descubrimiento-de-experiencia-digital-2026-10-10) — `NSK-EXP-DISCOVERY-001`
- [Revisión UX exploratoria: cierres (2026-10-10)](done/2026-10-10.md#revisión-ux-exploratoria-cierres-2026-10-10) — `UX-QA-001`, `UX-QA-002`, `UX-QA-003`, `UX-QA-005`
- [Experiencia digital: dónde se conectan los equipos (2026-10-10)](done/2026-10-10.md#experiencia-digital-dónde-se-conectan-los-equipos-2026-10-10) — `NSK-EXP-ONPREM-001`
- [Experiencia digital: ubicación del usuario y menos texto (2026-10-10)](done/2026-10-10.md#experiencia-digital-ubicación-del-usuario-y-menos-texto-2026-10-10) — `NSK-EXP-USERLOC-001`
- [Ayuda corta en las tarjetas Netskope (2026-10-10)](done/2026-10-10.md#ayuda-corta-en-las-tarjetas-netskope-2026-10-10) — `UX-HELP-SHORT-001`

## 7 a 9 de octubre de 2026 — [`done/2026-10-07-a-09.md`](done/2026-10-07-a-09.md)

- [Cierre ARCH-LAYERS-002 — rutas sin repositorios (2026-10-09)](done/2026-10-07-a-09.md#cierre-arch-layers-002--rutas-sin-repositorios-2026-10-09) — `ARCH-LAYERS-002`
- [Cierre ARCH-LAYERS-001 — SQL fuera de los servicios (2026-10-09)](done/2026-10-07-a-09.md#cierre-arch-layers-001--sql-fuera-de-los-servicios-2026-10-09) — `ARCH-LAYERS-001`
- [Cierre DOCS-GEN-002 — catálogo de roles y permisos generado (2026-10-09)](done/2026-10-07-a-09.md#cierre-docs-gen-002--catálogo-de-roles-y-permisos-generado-2026-10-09) — `DOCS-GEN-002`
- [Cierre DOCS-GEN-001 — referencia de la API generada (2026-10-09)](done/2026-10-07-a-09.md#cierre-docs-gen-001--referencia-de-la-api-generada-2026-10-09) — `DOCS-GEN-001`
- [Cierre DOCS-ADR-001 — decisiones sancionadas como ADR (2026-10-09)](done/2026-10-07-a-09.md#cierre-docs-adr-001--decisiones-sancionadas-como-adr-2026-10-09) — `DOCS-ADR-001`
- [Cierre DOCS-META-001 — frontmatter en cada documento (2026-10-09)](done/2026-10-07-a-09.md#cierre-docs-meta-001--frontmatter-en-cada-documento-2026-10-09) — `DOCS-META-001`
- [Cierre DOCS-LINT-001 — chequeo de la documentación (2026-10-09)](done/2026-10-07-a-09.md#cierre-docs-lint-001--chequeo-de-la-documentación-2026-10-09) — `DOCS-LINT-001`
- [Cierre DOCS-IDX-001 — trackers partidos (2026-10-09)](done/2026-10-07-a-09.md#cierre-docs-idx-001--trackers-partidos-2026-10-09) — `DOCS-IDX-001`
- [Cierre FE-CSS-001 — modularización de `styles.css` (2026-10-09)](done/2026-10-07-a-09.md#cierre-fe-css-001--modularización-de-stylescss-2026-10-09) — `FE-CSS-001`
- [Cierre UX-AUD2-009 — fechas y relativos (2026-10-08)](done/2026-10-07-a-09.md#cierre-ux-aud2-009--fechas-y-relativos-2026-10-08) — `UX-AUD2-009`
- [Cierre UX-AUD2-024 — controles y copy (2026-10-08)](done/2026-10-07-a-09.md#cierre-ux-aud2-024--controles-y-copy-2026-10-08) — `UX-AUD2-024`
- [Cierre UX-AUD2-023 — celdas y columnas (2026-10-08)](done/2026-10-07-a-09.md#cierre-ux-aud2-023--celdas-y-columnas-2026-10-08) — `UX-AUD2-023`
- [Cierre UX-AUD2-022 — espacio vacío (2026-10-08)](done/2026-10-07-a-09.md#cierre-ux-aud2-022--espacio-vacío-2026-10-08) — `UX-AUD2-022`
- [Cierre UX-AUD2-021 — tableros y grillas (2026-10-08)](done/2026-10-07-a-09.md#cierre-ux-aud2-021--tableros-y-grillas-2026-10-08) — `UX-AUD2-021`
- [Cierre UX-AUD2-015 — una cabecera por vista (2026-10-08)](done/2026-10-07-a-09.md#cierre-ux-aud2-015--una-cabecera-por-vista-2026-10-08) — `UX-AUD2-015`
- [Cierre UX-AUD2-019 — columnas consolidadas (2026-10-08)](done/2026-10-07-a-09.md#cierre-ux-aud2-019--columnas-consolidadas-2026-10-08) — `UX-AUD2-019`
- [Cierre UX-AUD2-008 — estado compartido de Netskope (2026-10-08)](done/2026-10-07-a-09.md#cierre-ux-aud2-008--estado-compartido-de-netskope-2026-10-08) — `UX-AUD2-008`
- [Cierre UX-AUD2-004 — rendimiento HTTP (2026-10-08)](done/2026-10-07-a-09.md#cierre-ux-aud2-004--rendimiento-http-2026-10-08) — `UX-AUD2-004`
- [Avance UX/UI — aclaraciones repetidas (2026-10-07)](done/2026-10-07-a-09.md#avance-uxui--aclaraciones-repetidas-2026-10-07) — `UX-AUD2-018`
- [Avance UX/UI — textos de operador (2026-10-07)](done/2026-10-07-a-09.md#avance-uxui--textos-de-operador-2026-10-07) — `UX-AUD2-017`
- [Avance UX/UI — resultados de Command-K (2026-10-07)](done/2026-10-07-a-09.md#avance-uxui--resultados-de-command-k-2026-10-07) — `UX-AUD2-014`
- [Avance UX/UI — filas de catálogos SIA y Access (2026-10-07)](done/2026-10-07-a-09.md#avance-uxui--filas-de-catálogos-sia-y-access-2026-10-07) — `UX-AUD2-020`
- [Avance UX/UI — alineación de administración e inventario (2026-10-07)](done/2026-10-07-a-09.md#avance-uxui--alineación-de-administración-e-inventario-2026-10-07) — `UX-AUD2-013`
- [Avance UX/UI — herramientas, navegación y gráficos (2026-10-07)](done/2026-10-07-a-09.md#avance-uxui--herramientas-navegación-y-gráficos-2026-10-07) — `UX-AUD2-007`, `UX-AUD2-010`, `UX-AUD2-016`, `UX-AUD2-025`
- [Avance UX/UI — rendimiento y requests (2026-10-07)](done/2026-10-07-a-09.md#avance-uxui--rendimiento-y-requests-2026-10-07) — `UX-AUD2-003`, `UX-AUD2-005`
- [Checkpoint UX/UI — seis criterios cerrados (2026-10-07)](done/2026-10-07-a-09.md#checkpoint-uxui--seis-criterios-cerrados-2026-10-07) — `UX-AUD2-001`, `UX-AUD2-002`, `UX-AUD2-006`, `UX-AUD2-011`, `UX-AUD2-012`, `UX-AUD2-026`

## 5 y 6 de octubre de 2026 — [`done/2026-10-05-a-06.md`](done/2026-10-05-a-06.md)

- [Vistas SQL operativas de lectura (2026-10-05)](done/2026-10-05-a-06.md#vistas-sql-operativas-de-lectura-2026-10-05)
- [Conciliación de totales con la consola de Netskope y estado de usuarios (`NSK-REF-001`, `NSK-USR-001`, 2026-10-06)](done/2026-10-05-a-06.md#conciliación-de-totales-con-la-consola-de-netskope-y-estado-de-usuarios-nsk-ref-001-nsk-usr-001-2026-10-06) — `NSK-REF-001`, `NSK-USR-001`
- [Sugerencias, lote y widgets de equipos Netskope sin eventos, Fase 2 (`NSK-DEVREV-002`, 2026-10-06)](done/2026-10-05-a-06.md#sugerencias-lote-y-widgets-de-equipos-netskope-sin-eventos-fase-2-nsk-devrev-002-2026-10-06) — `NSK-DEVREV-002`
- [Clasificación humana de equipos Netskope sin eventos, Fase 1 (`NSK-DEVREV-001`, 2026-10-05)](done/2026-10-05-a-06.md#clasificación-humana-de-equipos-netskope-sin-eventos-fase-1-nsk-devrev-001-2026-10-05) — `NSK-DEVREV-001`
- [Heartbeat de Netskope fuera del estado, el inventario y las métricas (`NSK-HB-001`, 2026-10-05)](done/2026-10-05-a-06.md#heartbeat-de-netskope-fuera-del-estado-el-inventario-y-las-métricas-nsk-hb-001-2026-10-05) — `NSK-HB-001`
- [Logos de las herramientas en el selector (`TOOL-LOGO-001`, 2026-10-05)](done/2026-10-05-a-06.md#logos-de-las-herramientas-en-el-selector-tool-logo-001-2026-10-05) — `TOOL-LOGO-001`
- [Personas como espacio de la persona (`CONN-SPACE-001`, 2026-10-05)](done/2026-10-05-a-06.md#personas-como-espacio-de-la-persona-conn-space-001-2026-10-05) — `CONN-SPACE-001`
- [Conexiones y Administración separadas; Cobertura de cliente en su propia vista (`CONN-IA-001`, 2026-10-05)](done/2026-10-05-a-06.md#conexiones-y-administración-separadas-cobertura-de-cliente-en-su-propia-vista-conn-ia-001-2026-10-05) — `CONN-IA-001`
- [Home: nombres, aristas con iluminación y etiqueta del centro (`HOME-EDGE-001`, 2026-10-05)](done/2026-10-05-a-06.md#home-nombres-aristas-con-iluminación-y-etiqueta-del-centro-home-edge-001-2026-10-05) — `HOME-EDGE-001`
- [Steering IPsec y GRE (`NSK-IPSEC-001`, `NSK-GRE-001`, 2026-10-05)](done/2026-10-05-a-06.md#steering-ipsec-y-gre-nsk-ipsec-001-nsk-gre-001-2026-10-05) — `NSK-IPSEC-001`, `NSK-GRE-001`
- [Piloto de presentación de la tabla de Safes (`UX-TABLE-PRESENTATION-001`, 2026-10-05)](done/2026-10-05-a-06.md#piloto-de-presentación-de-la-tabla-de-safes-ux-table-presentation-001-2026-10-05) — `UX-TABLE-PRESENTATION-001`
- [Tablas, fase 3: Postura PAM, Actividad y clasificación de Safes (`UX-TABLES-001`, 2026-10-05)](done/2026-10-05-a-06.md#tablas-fase-3-postura-pam-actividad-y-clasificación-de-safes-ux-tables-001-2026-10-05) — `UX-TABLES-001`

## 4 de octubre de 2026 — [`done/2026-10-04.md`](done/2026-10-04.md)

- [Tablas, fase 2: patrón de Políticas y ayuda tras «?» (`UX-TABLES-001`, 2026-10-04)](done/2026-10-04.md#tablas-fase-2-patrón-de-políticas-y-ayuda-tras--ux-tables-001-2026-10-04) — `UX-TABLES-001`
- [Verificación de cadencia del scheduler (2026-10-04)](done/2026-10-04.md#verificación-de-cadencia-del-scheduler-2026-10-04)
- [Sincronización manual: toast y modal de confirmación (`SYNC-UX-001`, 2026-10-04)](done/2026-10-04.md#sincronización-manual-toast-y-modal-de-confirmación-sync-ux-001-2026-10-04) — `SYNC-UX-001`
- [Captura DLP: corridas sin novedades (`NSK-DLP-IDLE-001`, 2026-10-04)](done/2026-10-04.md#captura-dlp-corridas-sin-novedades-nsk-dlp-idle-001-2026-10-04) — `NSK-DLP-IDLE-001`
- [Representación de tablas, fase 1 (`UX-TABLES-001`, 2026-10-04)](done/2026-10-04.md#representación-de-tablas-fase-1-ux-tables-001-2026-10-04) — `UX-TABLES-001`
- [Índice de confianza (UCI) de usuarios Netskope (`NSK-UBA-002`, 2026-10-04)](done/2026-10-04.md#índice-de-confianza-uci-de-usuarios-netskope-nsk-uba-002-2026-10-04) — `NSK-UBA-002`
- [Probe v3 de Netskope y cierre de `NSK-SDK-001` (`NSK-PROBE-V3-001`, 2026-10-04)](done/2026-10-04.md#probe-v3-de-netskope-y-cierre-de-nsk-sdk-001-nsk-probe-v3-001-2026-10-04) — `NSK-SDK-001`, `NSK-PROBE-V3-001`
- [Inventario completo de métodos de la API de Netskope (`NSK-API-INVENTORY-001`, 2026-10-04)](done/2026-10-04.md#inventario-completo-de-métodos-de-la-api-de-netskope-nsk-api-inventory-001-2026-10-04) — `NSK-API-INVENTORY-001`
- [Vista «Políticas» de Netskope (`NSK-POL-VIEW-001`, 2026-10-04)](done/2026-10-04.md#vista-políticas-de-netskope-nsk-pol-view-001-2026-10-04) — `NSK-POL-VIEW-001`
- [Inventario de grupos Netskope y membresías (`NSK-GRP-001`, 2026-10-04)](done/2026-10-04.md#inventario-de-grupos-netskope-y-membresías-nsk-grp-001-2026-10-04) — `NSK-GRP-001`
- [Cierre de `CHAIN-012` como superado por el inventario único (2026-10-04)](done/2026-10-04.md#cierre-de-chain-012-como-superado-por-el-inventario-único-2026-10-04) — `CHAIN-012`
- [Observabilidad de la agenda y de las capas (`SYNC-OBS-001`, 2026-10-04)](done/2026-10-04.md#observabilidad-de-la-agenda-y-de-las-capas-sync-obs-001-2026-10-04) — `SYNC-OBS-001`
- [Cierre de capas de sync, política de agenda y vista de equipo (`SYNC-STAGES-001`, `SYNC-UI-001`, `SYNC-POLICY-OPS-001`, `VIEW-006`, 2026-10-04)](done/2026-10-04.md#cierre-de-capas-de-sync-política-de-agenda-y-vista-de-equipo-sync-stages-001-sync-ui-001-sync-policy-ops-001-view-006-2026-10-04) — `SYNC-STAGES-001`, `SYNC-UI-001`, `SYNC-POLICY-OPS-001`, `VIEW-006`
- [Primer widget de «Políticas y uso» (`NSK-MET-POL-001`, 2026-10-04)](done/2026-10-04.md#primer-widget-de-políticas-y-uso-nsk-met-pol-001-2026-10-04) — `NSK-MET-POL-001`
- [Teclado y Axe para políticas observadas (`NSK-POL-A11Y-001`, 2026-10-04)](done/2026-10-04.md#teclado-y-axe-para-políticas-observadas-nsk-pol-a11y-001-2026-10-04) — `NSK-POL-A11Y-001`
- [Tabla de políticas observadas: densidad y escaneo (`NSK-POL-003`, 2026-10-04)](done/2026-10-04.md#tabla-de-políticas-observadas-densidad-y-escaneo-nsk-pol-003-2026-10-04) — `NSK-POL-003`
- [Políticas Real-time observadas (`NSK-POL-001`, aceptada 2026-10-04)](done/2026-10-04.md#políticas-real-time-observadas-nsk-pol-001-aceptada-2026-10-04) — `NSK-POL-001`
- [Veracidad de las políticas observadas (`NSK-POL-002`, 2026-10-04)](done/2026-10-04.md#veracidad-de-las-políticas-observadas-nsk-pol-002-2026-10-04) — `NSK-POL-002`
- [Política de sincronización configurable (`SYNC-POLICY-001`, 2026-10-04)](done/2026-10-04.md#política-de-sincronización-configurable-sync-policy-001-2026-10-04) — `SYNC-POLICY-001`
- [Tareas programadas independientes por fuente (`SYNC-TASK-001`, 2026-10-04)](done/2026-10-04.md#tareas-programadas-independientes-por-fuente-sync-task-001-2026-10-04) — `SYNC-TASK-001`
- [Agenda de sincronización por tarea (`SYNC-UI-002`, 2026-10-04)](done/2026-10-04.md#agenda-de-sincronización-por-tarea-sync-ui-002-2026-10-04) — `SYNC-UI-002`
- [Tareas programadas de PAM (`SYNC-TASK-002`, 2026-10-04)](done/2026-10-04.md#tareas-programadas-de-pam-sync-task-002-2026-10-04) — `SYNC-TASK-002`
- [Coincidencia de miembros en Roles y grupos (`VIS-ROLE-CMP-001`, 2026-10-04)](done/2026-10-04.md#coincidencia-de-miembros-en-roles-y-grupos-vis-role-cmp-001-2026-10-04) — `VIS-ROLE-CMP-001`
- [Cuentas desde Safes con «Incluir cuentas» (`VIS-PAM-ACC-001`, 2026-10-04)](done/2026-10-04.md#cuentas-desde-safes-con-incluir-cuentas-vis-pam-acc-001-2026-10-04) — `VIS-PAM-ACC-001`

## 1 a 3 de octubre de 2026 — [`done/2026-10-01-a-03.md`](done/2026-10-01-a-03.md)

- [Safes retiradas (`VIS-PAM-RET-001`, 2026-10-03)](done/2026-10-01-a-03.md#safes-retiradas-vis-pam-ret-001-2026-10-03) — `VIS-PAM-RET-001`
- [Historial del equipo Netskope (`VIS-NSK-HIST-001`, 2026-10-03)](done/2026-10-01-a-03.md#historial-del-equipo-netskope-vis-nsk-hist-001-2026-10-03) — `VIS-NSK-HIST-001`
- [Identity — cuentas técnicas omitidas por SCIM (2026-10-03)](done/2026-10-01-a-03.md#identity--cuentas-técnicas-omitidas-por-scim-2026-10-03)
- [Identity — capas de membresía (`ID-002`, 2026-10-03)](done/2026-10-01-a-03.md#identity--capas-de-membresía-id-002-2026-10-03) — `ID-002`
- [Grupos OIDC observados en Usuarios (2026-10-03)](done/2026-10-01-a-03.md#grupos-oidc-observados-en-usuarios-2026-10-03) — `ACCESS-OIDC-GROUPS-OBSERVED-001`
- [Carga selectiva de métricas Netskope (2026-10-03)](done/2026-10-01-a-03.md#carga-selectiva-de-métricas-netskope-2026-10-03) — `NSK-MET-LOAD-001`
- [Oferta de métricas Netskope por familia (2026-10-03)](done/2026-10-01-a-03.md#oferta-de-métricas-netskope-por-familia-2026-10-03) — `NSK-MET-UX-001`
- [Organización de tests frontend (2026-10-02)](done/2026-10-01-a-03.md#organización-de-tests-frontend-2026-10-02) — `FE-TEST-ORG-001`
- [Netskope — contratos de métricas (2026-10-02)](done/2026-10-01-a-03.md#netskope--contratos-de-métricas-2026-10-02) — `NSK-MET-REGISTRY-001`
- [Netskope — recuperación del iterator (2026-10-02)](done/2026-10-01-a-03.md#netskope--recuperación-del-iterator-2026-10-02)
- [Señales de limpieza PAM (cierre 2026-10-01)](done/2026-10-01-a-03.md#señales-de-limpieza-pam-cierre-2026-10-01) — `PAM-GRP-001`
- [Claridad de Safes (cierre 2026-10-01)](done/2026-10-01-a-03.md#claridad-de-safes-cierre-2026-10-01) — `SAFE-READ-UX-001`
- [Claridad de SIA, Netskope y métricas (cierre 2026-10-01)](done/2026-10-01-a-03.md#claridad-de-sia-netskope-y-métricas-cierre-2026-10-01) — `SIA-LINK-UX-001`, `NSK-INVENTORY-UX-001`, `METRIC-READ-UX-001`
- [Postura de equipos Netskope (cierre 2026-10-01)](done/2026-10-01-a-03.md#postura-de-equipos-netskope-cierre-2026-10-01) — `NSK-POSTURE-UX-001`
- [Cierres de verificación (2026-10-01)](done/2026-10-01-a-03.md#cierres-de-verificación-2026-10-01) — `TEST-NSK-001`, `REL-001`, `DOCS-TRACK-001`, `NSK-ADEM-UX-001`, `FE-DEAD-001`
- [Contraste de avatares (cierre 2026-10-01)](done/2026-10-01-a-03.md#contraste-de-avatares-cierre-2026-10-01) — `FE-AVATAR-CONTRAST-001`
- [Foco individual en Personas (cierre 2026-10-01)](done/2026-10-01-a-03.md#foco-individual-en-personas-cierre-2026-10-01) — `PERSON-FOCUS-UX-001`
- [Cierres por aceptación del dueño: Conexiones y PAM (2026-10-01)](done/2026-10-01-a-03.md#cierres-por-aceptación-del-dueño-conexiones-y-pam-2026-10-01) — `CONN-001`, `CONN-NAV-001`, `RISK-ENT-001`, `RISK-001`, `POSTURE-REFRESH-001`, `MOD-FE-001`, `UX-SYNC-001`, `CONN-UX-001`, `CONN-TEST-001`, `PAM-CLEAN-UX-001`, `PAM-CLEAN-FRESH-001`, `PAM-POSTURE-UX-001`

## Anteriores al 1 de octubre de 2026 (incluye secciones sin fecha) — [`done/anteriores-a-2026-10-01.md`](done/anteriores-a-2026-10-01.md)

- [Auditoría técnica cerrada](done/anteriores-a-2026-10-01.md#auditoría-técnica-cerrada) — `E2E-STALE-001`, `AUD-DOC-001`, `AUD-DOC-002`, `AUD-DOC-003`, `BE-CFG-001`, `FE-A11Y-001`, `SIA-POL-001`, `UXB-009`, `NSK-DEM-PROBE-001`, `ACCESS-SEG-001`, `ACCESS-MATRIX-001`, `ACCESS-CEILING-001` y 64 más
- [Capacidades y refactors cerrados](done/anteriores-a-2026-10-01.md#capacidades-y-refactors-cerrados) — `NSK-ADEM-POP-001`, `NSK-ADEM-USERPOP-001`, `FE-MOTION-001`, `HOME-WHEEL-001`, `DOCS-PORTAL-001`, `UX-PERSON-002`, `UX-PERSON-001`, `UX-SEARCH-001`, `UX-IA-001`, `FE-DEVTOOLS-001`, `FE-TEST-001`, `TEST-PROP-001` y 33 más
- [Verificación de cierre](done/anteriores-a-2026-10-01.md#verificación-de-cierre)
- [Cierres de catálogo trasladados desde el backlog](done/anteriores-a-2026-10-01.md#cierres-de-catálogo-trasladados-desde-el-backlog) — `SIA-RES-001`, `SIA-CONN-001`, `SIA-STRONG-001`, `ID-001`
- [Registro histórico](done/anteriores-a-2026-10-01.md#registro-histórico)
- [Auditoría de baja prioridad IF-015–021 (2026-09-12)](done/anteriores-a-2026-10-01.md#auditoría-de-baja-prioridad-if-015021-2026-09-12)
