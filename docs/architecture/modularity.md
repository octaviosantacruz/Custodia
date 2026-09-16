# Modularidad de la aplicación

## Regla general

Las rutas HTTP coordinan autenticación, validación de entrada y respuestas. No
contienen SQL ni lógica de mapeo de CyberArk. Los servicios transforman y
validan datos; los repositorios son responsables de PostgreSQL; las
integraciones encapsulan HTTP externo y sus contratos.

## Backend

```text
api/routes/
  auth*.py                autenticación, sesión, OIDC y bootstrap
  safes*.py               lectura, escritura, ciclo de vida y catálogos de Safes
  cmdb.py                 lecturas normalizadas de Identity Administration y SIA
  ingestion.py            preview/run de CyberArk y sincronizaciones por fuente
  activity.py             bitácora administrativa

services/
  ingestion_*             comparación, fuente y persistencia de ingesta PAM
  pam_*                   mapeo, fuente y persistencia PAM
  cmdb_*                  modelos y persistencia normalizada
  identity_admin_mapping.py  mapeo SCIM a objetos y relaciones normalizadas
  sia_mapping.py          mapeo de políticas SIA a objetos normalizados
  cyberark_*              configuración, parsing y transporte externo

repositories/
  safe_queries.py, account_queries.py, safe_mutations.py
  catalog_queries.py, catalog_mutations.py
  identity_admin_queries.py, sia_queries.py
  analytics.py, ingestion.py, audit.py, cmdb.py

integrations/
  identity_admin.py       cliente SCIM contractual de Identity Administration
  sia.py                  cliente contractual de políticas SIA
  status.py               estado de configuración sin llamadas externas

identity_admin_sync.py    sincronización aislada por source_system
sia_sync.py               sincronización aislada por source_system
```

`main.py` es el composition root: crea FastAPI, middleware y routers. El
ciclo de vida del pool y el scheduler están en `lifecycle.py`. `cyberark.py`
es una fachada de endpoints; OAuth, reintentos y validación HTTP viven en
`cyberark_transport.py`.

## Frontend

- `App.tsx` compone el catálogo y los workspaces; la lógica de dominio vive en
  hooks.
- `app-header.tsx` compone layout, navegación, sincronización, notificaciones y
  perfil; cada popover vive en su componente.
- `general-workspace.tsx` presenta Métricas PAM y el panel personal de
  dashboard; la cobertura normalizada del CMDB se consume desde
  `lib/dashboard-api.ts` como una métrica más, no como un workspace propio.
- `safe-table.tsx` compone filtros, filas, cuentas y paginación.
- `identity-admin-workspace.tsx` y `sia-workspace.tsx` son vistas de solo
  lectura con sus hooks y clientes API propios.
- `lib/api.ts` es transporte común; las llamadas de dominio viven en
  `lib/*-api.ts`.
- `lib/password-policy.ts` es la única fuente de reglas de contraseña del
  frontend.

## Límites que se mantienen intencionalmente

- PAM, Identity Administration y SIA permanecen separados por `source_system`;
  una sincronización nunca reconcilia objetos de otra fuente.
- No inferir endpoints, scopes, payloads ni relaciones externas. Si falta una
  variable o el contrato no está aprobado, el cliente debe fallar de forma
  controlada y no inventar cobertura.
- No dividir `auth.py` por completo hasta contar con tests de integración para
  login local, cambio de contraseña, permisos y OIDC. Es código de control de
  acceso y una extracción mecánica sin esa cobertura agrega riesgo.
- No crear un repositorio genérico prematuro: las consultas de Safes, cuentas,
  catálogos, Identity y SIA tienen filtros y contratos distintos.

## Criterio para futuras extracciones

Una extracción se justifica cuando elimina una responsabilidad distinta, puede
mantener el contrato público mediante una fachada o adaptador, y tiene una
prueba que detecta regresiones. No se separan archivos únicamente por cantidad
de líneas.
