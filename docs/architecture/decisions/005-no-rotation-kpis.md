---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-09
---

# ADR 005 — No deducir KPIs de rotación de credenciales

## Contexto

Un KPI de rotación (porcentaje de credenciales rotadas en 90 días, antigüedad de la última
verificación) parece fácil de derivar de otros campos de la cuenta, pero esa deducción sería falsa. El
inventario sólo persiste datos operativos (nombre, usuario, dirección, Safe y plataforma) y nunca
secretos, atributos de credencial ni el payload completo de la cuenta.

## Decisión

Los KPIs de rotación **no están implementados y no se simulan** con otros campos. `CPM-001` habilitó,
con alcance reducido, una lista mínima de datos no secretos de `secretManagement`: sólo
`automatic_management_enabled`, `management_status` y `secret_modified_at`, guardados en
`cyberark_accounts.attributes`. Un dato ausente se muestra como «Sin dato», nunca como «deshabilitada».
`lastReconciledTime` y `lastVerifiedTime` no existen en este tenant y no se persisten ni se muestran;
`manualManagementReason`, `platformAccountProperties` y el payload no se guardan nunca.

La interfaz rotula la fecha como «Último cambio de secreto o alta» y aclara que no equivale a rotación.
`GET /api/analytics/account-management` devuelve conteos con su denominador y
`GET /api/analytics/freshness` informa sólo la antigüedad de `last_modification_time` de los Safes y la
escasez o desactualización del inventario de cuentas, rotulada como frescura. `membershipExpirationDate`
tampoco permite inferir rotación o vencimiento.

## Aprobación

La lista mínima: 2026-10-03 (`CPM-001`, aceptada con alcance reducido). La regla de no inferir rotación
es de `AGENTS.md` desde el inicio del producto y no tiene fecha de aprobación aparte.

## Cómo se habilitaría un KPI de rotación

Con una decisión de producto nueva, registrada aquí, y un dato que hoy no existe en el tenant (una marca de
verificación o reconciliación). Además: ampliar la lista mínima con su mapeo de ingesta, una nota en
[Contratos de integración](../integration-contracts.md) y un test de regresión.

## Cumplimiento

`backend/tests/cyberark/pam/test_pam_account_mapping.py` (sólo pasa la lista mínima; el texto libre
sensible y las propiedades de plataforma nunca se guardan),
`backend/tests/cyberark/pam/test_account_management_summary_postgres_integration.py` (denominador,
buckets y «sin dato») y `frontend/tests/e2e/cyberark/pam/safes.spec.ts` (el rótulo «Último cambio de
secreto o alta»). En el frontend, `frontend/tests/cyberark/pam/dashboard-metrics.unit.test.ts` comprueba
que el atajo de cumplimiento declara que no mide rotación.
