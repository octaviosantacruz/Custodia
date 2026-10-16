---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-13
---

# Limpieza incremental posterior al barrido del 12/10

Se preservan los cambios de accesibilidad que ya estaban en el worktree.
Esta revisión aborda lotes acotados; el informe adjunto es un inventario de
candidatos, no una autorización para borrar contratos HTTP o datos históricos.
Sin migraciones ni escrituras sobre datos reales. Sin commit ni push.

## Evidencia por lote

Punto 1 — evidencia previa a cambios (2026-10-13)

- test_findings.py::test_current_rules_are_read_only_and_do_not_select_secrets detecta reglas retiradas o campos secretos en SQL, mediante collect_current_findings. Sin callers productivos de ese wrapper; refresh_findings ejecuta exactamente la misma consulta en su INSERT SELECT. Historial 1498bcfc conserva el wrapper tras modularización; revisión 12/10 lo conservó por seguridad. Retirar wrapper y trasladar aserciones de reglas/secretos a test_refresh_upserts_current_findings_and_marks_missing_open_findings_resolved; conservar garantía sobre la consulta ejecutada por producción. Riesgo: perder cobertura de seguridad si se borra el test sin trasladarla. Validación unittest findings + ingestion.
- test_sync_schedule.py::test_disabled_everywhere_means_no_scheduler sólo comprueba any(interval > 0) en scheduling_enabled, sin callers productivos. Historial b9728816: agenda administrativa, loop usa due_sources. Retirar predicate; probar tareas devueltas por due_sources (desactivado, habilitado y override administrativo), manteniendo NextAttemptTests y pruebas de precedencia. Riesgo: config ambiental; fixture ya neutraliza entorno. Validación unittest sync_schedule + lifecycle.
- test_pam_inventory.py::test_rejects_invalid_group_detail_concurrency conserva guardia real de get_group_details; alias pam_inventory explícitamente existe para tests, adquisición usa services.pam_mapping desde pam_source. Retirar sólo alias, importar test del propietario. test_safes_export.py conserva CSV seguro: ruta safe_read usa _safes_csv; safes es sólo compositor. Importar test desde safe_read y quitar reexport. Riesgo: imports inadvertidos; búsqueda global y verify.
- workspaces.unit.test.ts::categorized workspaces hide empty groups and unauthorized modules y ::each catalogued workspace maps to one browse category sólo ejercitan categorías derivadas sin consumidores productivos. Funciones/types workspaceCategories/categoryOfWorkspace/categorizedWorkspaces/workspaceRequiresAccessManage no tienen callers productivos; workspaceViews sólo tiene reexport en AppHeader, también sin importadores. Historial 4889d4ec mantiene helpers de navegación anterior al registro por herramienta. Retirar helpers/reexport; conservar rutas/permisos/aliases/canonicalización y contratos de visibilidad en catálogo real. workspace-catalog.unit.test.ts ya valida destinos categorizados; trasladar esa comprobación a REGISTERED_CATEGORIES/CATALOG_ENTRIES. No modificar registros de categorías ni permisos. Riesgo: perder contratos de URLs y separación; conservar tests respectivos. Validación node tests/cross/{workspaces,workspace-catalog,source-registry}.unit.test.ts + verify.
- source-registry.unit.test.ts::registered domains keep the editorial order and product labels y workspaces.unit.test.ts::CyberArk groups PAM, Identity and SIA while Netskope remains independent utilizan PRODUCT_META/productLabelForDomain (sin caller productivo); ProductId/PRODUCT_BY_DOMAIN sostienen estos derivados. Historial FE-DEAD-001 documentó postergación; tool-switcher y workspace-switcher hoy usan domainMeta().product directamente. Retirar derivados y afirmar etiquetas sobre domainMeta (propietario vivo); conservar orden, runtimes, aislamiento sync y dominios. Riesgo: etiquetas de herramientas; validar source-registry, workspaces y verify.


Punto 2 — evidencia previa a cambios (2026-10-13)

Historia: fd13ce24 retiró rutas de escritura y conservó save_device_review para sembrar datos de tests. Búsqueda completa app/tests: ningún caller productivo de save_device_review, validate_review, get_device_review; siguen vivos reviews_for_objects, review_filter_clause, suggestion_sql y get_device_review_summary.

- test_netskope_device_reviews_http.py::test_the_classification_routes_are_retired_even_for_netskope_admin verifica 404/405 y ausencia OpenAPI: conservar; quitar sólo mock save y assert_not_awaited porque jamás alcanza writer.
- test_netskope_device_reviews_postgres_integration.py::test_a_decision_is_saved_with_server_evidence_and_audited_in_the_same_transaction y ::test_only_an_active_netskope_device_can_be_classified protegen exclusivamente la escritura retirada. Eliminarlos junto al writer, no reemplazarlos: no queda contrato de escritura. Riesgo de reintroducción de endpoint cubierto por test HTTP anterior.
- test_netskope_device_review_rules.py::test_a_plain_classification_is_normalized, ::test_unknown_values_are_rejected, ::test_references_are_required_where_a_claim_needs_proof, ::test_an_undetermined_device_is_never_resolved, ::test_an_exception_needs_a_future_bounded_expiry_an_approver_and_a_reason, ::test_text_limits_are_enforced protegen exclusivamente validate_review. Eliminar estos seis, mantener las tres pruebas de filtros SQL/sugerencias vigentes. No modificar constraints/migraciones históricos.
- Otros ocho casos PostgreSQL del mismo archivo: conservación de decisión al retirar dispositivo/ON DELETE RESTRICT, filtros/proyección, resumen vs drill, guardia de aislamiento, sugerencias vs drill, ausencia de sync completo, atenciones vs drill, métricas no divididas por diagnóstico. Conservar todos; sembrar filas históricas mediante fixture exclusivo tests/support, sin validación, auditoría ni lógica de aplicación. Reemplazar get_device_review por reviews_for_objects donde corresponda. Riesgo: fixture diferente de datos persistidos; inspeccionada migración 085, cumplir constraints e incluir campos explícitos. Validación: tres archivos netskope focales y npm run verify (PG efímero, no datos reales).

Retiro habilitado: save_device_review, validate_review, get_device_review, _clean_text, _json_safe, _FIELDS, EXCEPTION_MAX_DAYS, AUDIT_ENTITY y dependencias de escritura/fechas no necesarias. Mantener tabla, reporting view, resumen HTTP, lecturas, permisos, migraciones y datos.


Punto 3 — evidencia previa

Dependencias confirmadas: cuatro rutas tool importan _enqueue privado de otra ruta cross; repositorios Netskope importan services para proyección pura de evidencia y selección estática de campos de métricas.

- test_ingestion_source_routes.py: SIA/Identity/Access/PAM/PSM comprueban fuente, opciones y wake; test_permission_http_matrix.py::test_writes_documented_as_token_compatible_now_accept_it protege 202 token compatible. Mantener todos y actualizar patch al propietario real. Mover enqueue+wake a sync_control (servicio), aceptar pool y coordinador explícitos, sin Request/FastAPI. Las rutas conservan autenticación, validación, UUID y respuesta. Añadir regresión de enqueue fallido que no despierta coordinador y conservar orden comprobando que wake no ocurrió durante enqueue. Historia: ARCH-LAYERS-002 creó fachadas, helper quedó en routes. Riesgo: wake antes de commit/retorno; tests y verify PG de cola.
- test_netskope_device_evidence.py, test_netskope_device_evidence_postgres_integration.py, test_netskope_stale_rule_postgres_integration.py y test_reporting_views_postgres_integration.py protegen clasificación temporal, comparación SQL/Python, tolerancia de futuro y sincronización fresca. Ninguna eliminación de tests. Mover módulo puro completo a raíz de herramienta device_evidence.py; actualizar importadores productivos y pruebas. Sin shim. Riesgo: imports/valores temporales; pruebas existentes + verify.
- netskope_metric_registry contiene contratos estáticos de dominio y resolución dinámica AA. Repositorio metrics sólo necesita inventory_metric_fields, que no requiere servicios. Extraer contratos estáticos y selección a metric_contracts.py en raíz de herramienta; registry conserva funciones que resuelven AA/config y depende del contrato. Actualizar modelos y ruta a propietario de tipos/constants, sin reexports test-only. Cobertura test_netskope_dashboard_preferences y PG métricas valida campos/denominadores/contratos HTTP y configuración. Sin cambios de contratos ni SQL. Riesgo: dependencia circular/AA; tests + verify.

Otros límites (transporte PAM, schema→dashboard service, auditoría de lecturas, fachadas) necesitan revisión acotada propia, no se moverán por tamaño ni por inventario estático. Punto 4 evalúa, no autoriza una abstracción genérica de repositorios ni mezcla fuentes.


## Punto 4: evaluación de duplicaciones

- **Edición de tableros frontend:** comparten estado de edición, borrador,
  cancelación, guardado y confirmación de plantilla. Una extracción futura
  podría limitarse a ese ciclo, manteniendo configuración, consultas, permisos
  y tipos en cada herramienta. Antes debe cubrirse cancelación con cambios,
  fallo de guardado y aplicación de plantilla en ambas vistas. No se extrae
  ahora una máquina completa basándose en líneas parecidas.
- **Movimiento de widgets:** la operación coincide, pero PAM identifica por
  `widget_id` y Netskope por `id`. La utilidad compartida actual exige
  `widget_id`; reutilizarla requiere diseñar un selector de identidad, sin
  cambiar los objetos persistidos. Las variantes de arrastre tampoco son
  equivalentes: PAM intercambia posiciones y Netskope inserta por orden.
- **Normalización de preferencias backend:** PAM migra medidas/títulos,
  conserva baseline de objetivos y evalúa widgets; Netskope adapta arrays
  heredados, elimina charts AA retirados y filtra ids/estilos. Se mantienen
  por herramienta; compartirlas enteras mezclaría contratos distintos.
- **Predicados SQL y matching usuario/dispositivo:** son candidatos a una
  revisión específica con fixtures de casos nulos, internos y ambiguos.
  No se crea un repositorio genérico ni se sustituyen consultas de Safes,
  cuentas y catálogos por una abstracción común.
- **Tamaño de archivos, CSS y scaffolds:** no constituyen por sí mismos un
  defecto. Quedan fuera de este lote. El registro `siaConnectors`, las URLs
  retiradas, aislamiento entre fuentes y guardias arquitectónicas permanecen.

## Pendientes acotados del informe

El resto de helpers frontend (layout, radial, wheel, password generator,
wrappers de dashboard y tipos) requiere su propio lote con evidencia de
consumidores y cobertura. No se declara cerrado el barrido completo.
Las propuestas de movimiento de transporte PAM, allowlist de dimensiones,
auditoría de lecturas y fachadas necesitan comprobar sus contratos de forma
separada. No se altera la decisión de producto desktop.

## Validación

Punto 1: 82 tests backend focales, tres archivos unitarios de navegación y
`npm run verify` completos: 1.618 backend y 434 unitarios frontend, además de
build, probes y verificaciones de documentación/trackers.
Punto 2: `npm run verify` completo con 1.610 backend y 434 unitarios frontend.
Se conservan los ocho casos de consultas históricas del archivo PostgreSQL,
los casos de reporting y el contrato HTTP de ausencia de rutas retiradas.

Punto 3: 89 pruebas focales de rutas, permisos HTTP, cola, evidencia y
preferencias pasaron. Se incorporó el caso de fallo de encolado sin despertar
al dispatcher y se comprueba el orden persistencia → wake en el caso exitoso.
`npm run verify` final completo: 1.611 tests backend (incluido PostgreSQL
efímero), 434 unitarios frontend, tipos generados, build, probes, estilos,
trackers, documentación y diff check. Log local:
`/tmp/dshub-cleanup-final-verify.log`.

Balance exclusivo de limpieza, contabilizando los módulos movidos:
producción +257/-440 (neto -183); tests y fixtures +106/-199 (neto -93).
Las ocho pruebas eliminadas de escritura/validación de revisiones y la
prueba del wrapper de hallazgos explican la reducción backend; se agregó
la prueba de fallo de encolado. En frontend se retiraron tres pruebas de
helpers obsoletos y se conservaron los contratos de navegación/permisos.

Los contratos puros Netskope ahora viven en `netskope/sse/device_evidence.py`
y `netskope/sse/metric_contracts.py`. La resolución dinámica AA permanece en
servicios y las cuatro rutas CyberArk usan `cross/services/sync_control.py`.
No quedan shims en las ubicaciones anteriores.
