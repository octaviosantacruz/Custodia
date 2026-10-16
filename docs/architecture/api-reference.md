---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-09
generado: sí
---

# Referencia de la API (generada)

> **Archivo generado. No editar a mano.** Se regenera con `backend/.venv/bin/python scripts/generate_api_reference.py` a partir de las rutas
> montadas en la app y de las dependencias de autorización de cada una. El test
> `backend/tests/cross/test_api_reference.py` falla si este archivo está desactualizado.

La columna «Acceso» sale de las dependencias reales de cada ruta: el permiso que exige y si
acepta sesión, token de escritura (`X-Access-Token`) o token Bearer de lectura. Qué permisos reúne
cada rol: [Catálogo de roles y permisos](access-catalog.md) (generado desde las migraciones).
Contratos, límites y ejemplos de cada integración: [Contratos de integración](integration-contracts.md).

210 operaciones.

| Método | Ruta | Acceso | Etiqueta |
|---|---|---|---|
| GET | `/api/access/domains` | `access:manage` o `access:roles_read` o `access:roles_manage` o `access:permissions_manage` o `access:role_assignments_manage` o `access:oidc_mappings_read` (lectura) | Acceso y permisos |
| PUT | `/api/access/oidc-group-roles` | `access:manage` o `access:role_assignments_manage` (escritura) | Acceso y permisos |
| GET | `/api/access/oidc-health` | `access:manage` o `access:oidc_mappings_read` (lectura) | Acceso y permisos |
| GET | `/api/access/permissions` | `access:manage` o `access:roles_read` o `access:roles_manage` o `access:permissions_manage` o `access:role_assignments_manage` o `access:oidc_mappings_read` (lectura) | Acceso y permisos |
| POST | `/api/access/permissions` | `access:manage` o `access:permissions_manage` (escritura) | Acceso y permisos |
| GET | `/api/access/roles` | `access:manage` o `access:roles_read` o `access:roles_manage` o `access:permissions_manage` o `access:role_assignments_manage` o `access:oidc_mappings_read` (lectura) | Acceso y permisos |
| POST | `/api/access/roles` | `access:manage` o `access:roles_manage` (escritura) | Acceso y permisos |
| POST | `/api/access/roles/composite` | `access:manage` o `access:roles_manage` (escritura) | Acceso y permisos |
| PATCH | `/api/access/roles/{role_code}` | `access:manage` o `access:roles_manage` (escritura) | Acceso y permisos |
| PATCH | `/api/access/roles/{role_code}/composite` | `access:manage` o `access:roles_manage` (escritura) | Acceso y permisos |
| GET | `/api/accounts` | `safes:read` (lectura) | Safes |
| GET | `/api/accounts/export.csv` | `inventory:export` (lectura) | Safes |
| PATCH | `/api/accounts/{safe_number}/{account_id}/classification` | `safes:manage` (escritura) | Safes |
| GET | `/api/activity` | `access:manage` o `audit:read` (lectura) | Actividad |
| GET | `/api/activity/export.csv` | `inventory:export` (lectura) | Actividad |
| GET | `/api/analytics` | `inventory:read` | Analítica |
| GET | `/api/analytics/account-management` | `inventory:read` | Analítica |
| GET | `/api/analytics/account-platform-coverage` | `inventory:read` | Analítica |
| GET | `/api/analytics/concentration` | `inventory:read` | Analítica |
| GET | `/api/analytics/executive` | `inventory:read` | Analítica |
| GET | `/api/analytics/freshness` | `inventory:read` | Analítica |
| GET | `/api/analytics/license-reconciliation` | `inventory:read` | Analítica |
| GET | `/api/auth/access-review` | `access:manage` o `access:directory_read` o `access:local_users_manage` o `access:role_assignments_manage` (lectura) | Usuarios y permisos |
| GET | `/api/auth/api-tokens` | sesión del navegador (sin token) | Autenticación |
| POST | `/api/auth/api-tokens` | sesión del navegador (sin token) | Autenticación |
| DELETE | `/api/auth/api-tokens/{token_id}` | sesión del navegador (sin token) | Autenticación |
| POST | `/api/auth/bootstrap` | pública (sin dependencia de autorización) | Autenticación |
| GET | `/api/auth/callback` | pública (sin dependencia de autorización) | Autenticación |
| GET | `/api/auth/login` | pública (sin dependencia de autorización) | Autenticación |
| POST | `/api/auth/login` | pública (sin dependencia de autorización) | Autenticación |
| POST | `/api/auth/logout` | pública (sin dependencia de autorización) | Autenticación |
| GET | `/api/auth/me` | sesión o token Bearer de lectura, sin permiso específico | Autenticación |
| PATCH | `/api/auth/me` | `inventory:read` | Autenticación |
| GET | `/api/auth/oidc-groups` | `access:manage` o `access:directory_read` o `access:local_users_manage` o `access:role_assignments_manage` (lectura) | Usuarios y permisos |
| GET | `/api/auth/oidc/login` | pública (sin dependencia de autorización) | Autenticación |
| POST | `/api/auth/password` | `inventory:read` | Autenticación |
| GET | `/api/auth/people` | `access:manage` o `access:directory_read` o `access:local_users_manage` o `access:role_assignments_manage` (lectura) | Usuarios y permisos |
| POST | `/api/auth/register` | pública (sin dependencia de autorización) | Autenticación |
| GET | `/api/auth/setup-status` | pública (sin dependencia de autorización) | Autenticación |
| GET | `/api/auth/status` | pública (sin dependencia de autorización) | Autenticación |
| GET | `/api/auth/users` | `access:manage` o `access:directory_read` o `access:local_users_manage` o `access:role_assignments_manage` (lectura) | Usuarios y permisos |
| POST | `/api/auth/users` | `access:manage` o `access:local_users_manage` (escritura) | Usuarios y permisos |
| DELETE | `/api/auth/users/{user_id}` | `access:manage` o `access:local_users_manage` (escritura) | Usuarios y permisos |
| PATCH | `/api/auth/users/{user_id}` | `access:manage` o `access:local_users_manage` o `access:role_assignments_manage` (escritura) | Usuarios y permisos |
| POST | `/api/auth/users/{user_id}/reissue-temp-password` | `access:manage` o `access:local_users_manage` (escritura) | Usuarios y permisos |
| POST | `/api/auth/users/{user_id}/roles` | `access:manage` o `access:role_assignments_manage` (escritura) | Usuarios y permisos |
| DELETE | `/api/auth/users/{user_id}/roles/{role_code}` | `access:manage` o `access:role_assignments_manage` (escritura) | Usuarios y permisos |
| POST | `/api/business-units` | `catalogs:manage` (escritura) | Catálogos |
| PATCH | `/api/business-units/{business_unit_id}` | `catalogs:manage` (escritura) | Catálogos |
| GET | `/api/catalogs` | `inventory:read` | Catálogos |
| GET | `/api/chains/netskope/expand` | `access:manage` o `netskope:read` (lectura) | Cadenas Netskope |
| GET | `/api/chains/netskope/node` | `access:manage` o `netskope:read` (lectura) | Cadenas Netskope |
| GET | `/api/chains/netskope/search` | `access:manage` o `netskope:read` (lectura) | Cadenas Netskope |
| GET | `/api/chains/pam/expand` | `access:manage` o `pam:catalogs_read` (lectura) | Cadenas PAM |
| GET | `/api/chains/pam/node` | `access:manage` o `pam:catalogs_read` (lectura) | Cadenas PAM |
| GET | `/api/chains/pam/search` | `access:manage` o `pam:catalogs_read` (lectura) | Cadenas PAM |
| GET | `/api/chains/person` | `access:manage` o `pam:catalogs_read` o `identity:catalogs_read` o `netskope:read` (lectura) | Cadenas Persona |
| GET | `/api/chains/person/coverage` | dependencia propia `require_person_client_coverage_read` | Cadenas Persona |
| GET | `/api/chains/person/coverage/detail` | dependencia propia `require_person_client_coverage_read` | Cadenas Persona |
| GET | `/api/chains/person/search` | `access:manage` o `pam:catalogs_read` o `identity:catalogs_read` o `netskope:read` (lectura) | Cadenas Persona |
| GET | `/api/cmdb/access-assets` | `inventory:read`; `access:manage` o `pam:catalogs_read` (lectura) | Access space |
| GET | `/api/cmdb/coverage` | `inventory:read` | Cobertura CMDB |
| GET | `/api/cmdb/identity-federations` | `inventory:read`; `access:manage` o `identity:catalogs_read` (lectura) | Identity Administration |
| GET | `/api/cmdb/identity-federations/{object_id}` | `inventory:read`; `access:manage` o `identity:catalogs_read` (lectura) | Identity Administration |
| GET | `/api/cmdb/identity-roles` | `inventory:read` | Identity Administration |
| GET | `/api/cmdb/identity-roles/member-matches` | `inventory:read`; `access:manage` o `identity:catalogs_read` (lectura) | Identity Administration |
| GET | `/api/cmdb/identity-roles/{object_id}` | `inventory:read` | Identity Administration |
| GET | `/api/cmdb/identity-roles/{object_id}/membership` | `inventory:read` | Identity Administration |
| GET | `/api/cmdb/identity-users` | `inventory:read` | Identity Administration |
| GET | `/api/cmdb/identity-users/{object_id}` | `inventory:read` | Identity Administration |
| GET | `/api/cmdb/identity-users/{object_id}/pam-chain` | `inventory:read` | Identity Administration |
| GET | `/api/cmdb/netskope/aa/charts` | `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/aa/charts/{key}` | `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/aa/severity` | `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/admin-roles` | dependencia propia `require_admin_inventory_read` | Administradores Netskope |
| GET | `/api/cmdb/netskope/admin-roles/{role_id}` | dependencia propia `require_admin_inventory_read` | Administradores Netskope |
| GET | `/api/cmdb/netskope/admins` | dependencia propia `require_admin_inventory_read` | Administradores Netskope |
| GET | `/api/cmdb/netskope/alerts` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/dem/sites` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/device-reviews/summary` | `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/devices` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/devices/changes` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/devices/client-compliance` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/devices/client-events` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/devices/duplicates` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/devices/facets` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/devices/fleet` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/devices/fleet-groups` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/devices/freshness` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/devices/{device_id}/history` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/dlp/policies` | dependencia propia `require_dlp_read` | Alertas DLP Netskope |
| GET | `/api/cmdb/netskope/dlp/status` | dependencia propia `require_dlp_read` | Alertas DLP Netskope |
| GET | `/api/cmdb/netskope/experience/attention` | dependencia propia `require_uba_read` | UCI Netskope |
| GET | `/api/cmdb/netskope/experience/pops` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/experience/presence` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/groups` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/groups/{group_id}/members` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/investigations` | dependencia propia `require_dlp_read` | Alertas DLP Netskope |
| GET | `/api/cmdb/netskope/metrics` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/observed-policies` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/policy-groups` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/posture` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/sync-evidence` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/uci` | dependencia propia `require_uba_read` | UCI Netskope |
| GET | `/api/cmdb/netskope/uci/companies` | dependencia propia `require_uba_read` | UCI Netskope |
| GET | `/api/cmdb/netskope/users` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/users/retired-activity` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/users/{object_id}/anomalies` | dependencia propia `require_uba_read` | UCI Netskope |
| GET | `/api/cmdb/netskope/users/{object_id}/experience/devices` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/users/{object_id}/experience/devices/{device_id}` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/netskope/users/{object_id}/experience/score` | `inventory:read`; `access:manage` o `netskope:read` (lectura) | Inventario Netskope |
| GET | `/api/cmdb/pam-cleanup-signals` | `inventory:read`; `access:manage` o `pam:catalogs_read` (lectura) | PAM |
| GET | `/api/cmdb/pam-components` | `inventory:read`; `access:manage` o `pam:catalogs_read` (lectura) | PAM |
| GET | `/api/cmdb/pam-connectors` | `inventory:read`; `access:manage` o `pam:catalogs_read` (lectura) | PAM |
| GET | `/api/cmdb/pam-platform-catalogs` | `inventory:read`; `access:manage` o `pam:catalogs_read` (lectura) | PAM |
| GET | `/api/cmdb/pam-platform-targets` | `inventory:read`; `access:manage` o `pam:catalogs_read` (lectura) | PAM |
| GET | `/api/cmdb/pam-platforms` | `inventory:read`; `access:manage` o `pam:catalogs_read` (lectura) | PAM |
| GET | `/api/cmdb/pam-psm-connector-types` | `inventory:read`; `access:manage` o `pam:catalogs_read` (lectura) | PAM |
| GET | `/api/cmdb/pam-roles` | `inventory:read` | PAM |
| GET | `/api/cmdb/pam-roles/{object_id}` | `inventory:read` | PAM |
| GET | `/api/cmdb/pam-users` | `inventory:read`; `access:manage` o `pam:catalogs_read` (lectura) | PAM |
| GET | `/api/cmdb/pam-users/{object_id}/chain` | `inventory:read`; `access:manage` o `pam:catalogs_read` (lectura) | PAM |
| GET | `/api/cmdb/sia-connectors` | `inventory:read`; `access:manage` o `sia:catalogs_read` (lectura) | SIA |
| GET | `/api/cmdb/sia-database-accounts` | `inventory:read`; `access:manage` o `sia:catalogs_read` (lectura) | SIA |
| GET | `/api/cmdb/sia-destinations` | `inventory:read` | SIA |
| GET | `/api/cmdb/sia-policies` | `inventory:read` | SIA |
| GET | `/api/cmdb/sia-policies/{object_id}` | `inventory:read` | SIA |
| GET | `/api/cmdb/sia-resources` | `inventory:read`; `access:manage` o `sia:catalogs_read` (lectura) | SIA |
| GET | `/api/cmdb/sia-target-sets` | `inventory:read`; `access:manage` o `sia:catalogs_read` (lectura) | SIA |
| GET | `/api/connection-inventory` | `coverage:read` (lectura) | Inventario de conexiones |
| POST | `/api/connection-inventory` | `coverage:manage` (escritura) | Inventario de conexiones |
| POST | `/api/connection-inventory/bulk-update` | `coverage:manage` (escritura) | Inventario de conexiones |
| GET | `/api/connection-inventory/deviations` | `coverage:read` (lectura) | Inventario de conexiones |
| GET | `/api/connection-inventory/export.csv` | `coverage:manage` (lectura) | Inventario de conexiones |
| POST | `/api/connection-inventory/import` | `coverage:manage` (escritura) | Inventario de conexiones |
| POST | `/api/connection-inventory/import/preview` | `coverage:manage` (escritura) | Inventario de conexiones |
| GET | `/api/connection-inventory/progress` | `coverage:read` (lectura) | Inventario de conexiones |
| POST | `/api/connection-inventory/progress/snapshot` | `coverage:manage` (escritura) | Inventario de conexiones |
| GET | `/api/connection-inventory/sia-policies` | `coverage:read` (lectura) | Inventario de conexiones |
| PUT | `/api/connection-inventory/sia-policies` | `coverage:manage` (escritura) | Inventario de conexiones |
| GET | `/api/connection-inventory/stale` | `coverage:read` (lectura) | Inventario de conexiones |
| GET | `/api/connection-inventory/uninventoried` | `coverage:read` (lectura) | Inventario de conexiones |
| PATCH | `/api/connection-inventory/{inventory_id}` | `coverage:manage` (escritura) | Inventario de conexiones |
| GET | `/api/connection-inventory/{inventory_id}/history` | `coverage:read` (lectura) | Inventario de conexiones |
| GET | `/api/cyberark-risk/findings` | `pam:risk_read` (lectura) | CyberArk Risk Management |
| GET | `/api/cyberark-risk/findings/all` | `pam:risk_read` (lectura) | CyberArk Risk Management |
| GET | `/api/cyberark-risk/overview` | `pam:risk_read` (lectura) | CyberArk Risk Management |
| GET | `/api/dashboard/netskope/contracts` | `access:manage` o `netskope:read` (lectura); `netskope:read` (lectura) | Analítica |
| GET | `/api/dashboard/netskope/preferences` | `access:manage` o `netskope:read` (lectura); `inventory:read` | Analítica |
| PUT | `/api/dashboard/netskope/preferences` | `access:manage` o `netskope:read` (lectura); `inventory:read` | Analítica |
| POST | `/api/dashboard/netskope/preferences/preview` | `access:manage` o `netskope:read` (lectura); `inventory:read` | Analítica |
| GET | `/api/dashboard/netskope/preferences/templates` | `access:manage` o `netskope:read` (lectura); `inventory:read` | Analítica |
| PUT | `/api/dashboard/netskope/preferences/templates/{role_code}` | `access:manage` o `netskope:read` (lectura); `access:roles_manage` (escritura) | Analítica |
| GET | `/api/dashboard/preferences` | `inventory:read` | Analítica |
| PUT | `/api/dashboard/preferences` | `inventory:read` | Analítica |
| POST | `/api/dashboard/preferences/preview` | `inventory:read` | Analítica |
| GET | `/api/dashboard/preferences/templates` | `inventory:read` | Analítica |
| PUT | `/api/dashboard/preferences/templates/{role_code}` | `access:roles_manage` (escritura) | Analítica |
| GET | `/api/events` | `inventory:read` | Eventos |
| GET | `/api/findings` | `inventory:read` | Hallazgos |
| POST | `/api/findings/refresh` | `findings:manage` (escritura) | Hallazgos |
| PATCH | `/api/findings/{finding_id}` | `findings:manage` (escritura) | Hallazgos |
| GET | `/api/health` | pública (sin dependencia de autorización) | Salud y estado |
| GET | `/api/health/live` | pública (sin dependencia de autorización) | Salud y estado |
| GET | `/api/health/ready` | pública (sin dependencia de autorización) | Salud y estado |
| POST | `/api/ingestion/access/runs` | `ingestion:run` (escritura) | Ingesta |
| POST | `/api/ingestion/all/runs` | `ingestion:run` (escritura) | Ingesta |
| POST | `/api/ingestion/identity-admin/runs` | `ingestion:run` (escritura) | Ingesta |
| POST | `/api/ingestion/netskope/runs` | `ingestion:run` (escritura) | Ingesta |
| POST | `/api/ingestion/pam-connectors/runs` | `ingestion:run` (escritura) | Ingesta |
| POST | `/api/ingestion/preview` | `ingestion:preview` (escritura) | Ingesta |
| GET | `/api/ingestion/runs` | `inventory:read` | Ingesta |
| POST | `/api/ingestion/runs` | `ingestion:run` (escritura) | Ingesta |
| GET | `/api/ingestion/runs/{run_id}` | `inventory:read` | Ingesta |
| GET | `/api/ingestion/runs/{run_id}/stages` | `inventory:read` | Ingesta |
| GET | `/api/ingestion/schedule` | `inventory:read` | Ingesta |
| GET | `/api/ingestion/schedules` | `inventory:read` | Ingesta |
| PUT | `/api/ingestion/schedules/{task_key}` | `access:manage` (escritura) | Ingesta |
| POST | `/api/ingestion/schedules/{task_key}/runs` | `ingestion:run` (escritura) | Ingesta |
| POST | `/api/ingestion/sia/runs` | `ingestion:run` (escritura) | Ingesta |
| GET | `/api/ingestion/sources/{source_system}/stages/history` | `inventory:read` | Ingesta |
| GET | `/api/ingestion/sources/{source_system}/stages/latest` | `inventory:read` | Ingesta |
| GET | `/api/integrations/status` | `inventory:read` | Salud y estado |
| GET | `/api/lifecycle/retired` | `inventory:read` | Safes |
| GET | `/api/netskope/baselines` | `access:manage` o `netskope:read` (lectura) | Postura Netskope |
| PUT | `/api/netskope/baselines/client-golden-releases` | `netskope:admin` (escritura) | Postura Netskope |
| PUT | `/api/netskope/baselines/os-minimum-versions` | `netskope:admin` (escritura) | Postura Netskope |
| GET | `/api/operational-errors` | `access:manage` o `audit:read` (lectura) | Actividad |
| GET | `/api/operational-logs` | `access:manage` o `audit:read` (lectura) | Actividad |
| POST | `/api/responsibles` | `catalogs:manage` (escritura) | Catálogos |
| PATCH | `/api/responsibles/{responsible_id}` | `catalogs:manage` (escritura) | Catálogos |
| GET | `/api/safes` | `safes:read` (lectura) | Safes |
| POST | `/api/safes/bulk-assignment` | `safes:manage` (escritura) | Safes |
| GET | `/api/safes/export.csv` | `inventory:export` (lectura) | Safes |
| GET | `/api/safes/{safe_number}` | `safes:read` (lectura) | Safes |
| PATCH | `/api/safes/{safe_number}/account-type` | `safes:manage` (escritura) | Safes |
| GET | `/api/safes/{safe_number}/accounts` | `safes:read` (lectura) | Safes |
| PATCH | `/api/safes/{safe_number}/assignment` | `safes:manage` (escritura) | Safes |
| GET | `/api/safes/{safe_number}/audit` | `inventory:read` | Safes |
| PATCH | `/api/safes/{safe_number}/metadata` | `safes:manage` (escritura) | Safes |
| PATCH | `/api/safes/{safe_number}/quick-update` | `safes:manage` (escritura) | Safes |
| PATCH | `/api/safes/{safe_number}/scope` | `safes:manage` (escritura) | Safes |
| GET | `/api/search` | `inventory:read` | Búsqueda |
| GET | `/api/security-events` | `access:manage` o `security:events_read` (lectura) | Actividad |
| GET | `/api/summary` | `inventory:read` | Analítica |
| GET | `/api/workspaces/preferences` | `inventory:read` | Preferencias de workspace |
| PUT | `/api/workspaces/preferences` | `inventory:read` | Preferencias de workspace |
| GET | `/health` | pública (sin dependencia de autorización) | Salud y estado |
| GET | `/health/live` | pública (sin dependencia de autorización) | Salud y estado |
| GET | `/health/ready` | pública (sin dependencia de autorización) | Salud y estado |

## Permisos usados por las rutas

| Permiso | Operaciones |
|---|---|
| `access:directory_read` | 4 |
| `access:local_users_manage` | 8 |
| `access:manage` | 84 |
| `access:oidc_mappings_read` | 4 |
| `access:permissions_manage` | 4 |
| `access:role_assignments_manage` | 11 |
| `access:roles_manage` | 9 |
| `access:roles_read` | 3 |
| `audit:read` | 3 |
| `catalogs:manage` | 4 |
| `coverage:manage` | 8 |
| `coverage:read` | 7 |
| `findings:manage` | 2 |
| `identity:catalogs_read` | 5 |
| `ingestion:preview` | 1 |
| `ingestion:run` | 8 |
| `inventory:export` | 3 |
| `inventory:read` | 89 |
| `netskope:admin` | 2 |
| `netskope:read` | 43 |
| `pam:catalogs_read` | 15 |
| `pam:risk_read` | 3 |
| `safes:manage` | 7 |
| `safes:read` | 4 |
| `security:events_read` | 1 |
| `sia:catalogs_read` | 4 |
