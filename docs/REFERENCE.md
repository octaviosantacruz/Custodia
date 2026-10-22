---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Revisión de la versión anterior y limpieza

Base examinada: `f6a7acc`, actualización externa ya recibida y checkout limpio
al comenzar. Se revisaron código y contratos; no se ejecutaron integraciones,
migraciones, backups o despliegues. La observación de UI es estática, sin
auditoría visual en navegador ni afirmación de cobertura exhaustiva.

## Evidencia que orienta el nuevo producto

Rutas históricas consultables con `git show f6a7acc:RUTA`; **no existen en
el árbol del producto**.

| Área | Evidencia en la referencia | Qué conservar o cambiar |
|---|---|---|
| Registro | `backend/app/source_contract.py`, `backend/app/sources.py`, `frontend/src/sources.ts` | Registro explícito; quitar defaults de fabricante y uniones rígidas de plataformas. |
| Sync | `backend/app/sync_coordinator.py`, `backend/app/cross/repositories/sync_queue.py` | Cola durable, leases y completitud; aislar ahora por conexión, no sólo fuente. |
| Inventario | `backend/app/cross/cmdb_sync.py`, `backend/app/cross/repositories/cmdb_persistence.py` | Procedencia y reconciliación; la identidad nueva distingue dos conexiones del mismo proveedor. |
| Revisión humana | `backend/tests/cross/test_cmdb_sync.py`, `backend/tests/cyberark/pam/test_account_retirement_postgres_integration.py` | Sync no pisa decisiones. Las excepciones de retención PAM no son reglas universales. |
| APIs externas | `backend/app/cyberark/shared/integrations/oauth_client.py`, `backend/app/netskope/sse/integrations/netskope.py` | TLS, límites y contratos por API. No copiar permisos concedidos a un tenant. |
| Acceso | `backend/app/auth.py`, `backend/app/cross/api/routes/auth_session.py` | Permisos efectivos en backend y auditoría; rehacer autenticación y configuración de QA. |
| UI | `frontend/src/source-contract.ts`, `frontend/src/cross/components/app-header.tsx`, `frontend/src/styles/foundation.css` | Tablas densas y tokens; simplificar navegación por tarea y conexión. |

## Qué se retiró del árbol nuevo

Se removió el árbol heredado de 1499 archivos versionados y se crearon una
entrada y documentos nuevos. Esto incluye backend Python, frontend anterior,
migraciones históricas, scripts de probes/despliegue, configuración de
autenticación anterior, documentación laboral, herramientas de agentes
vendorizadas y archivos de editor. Algunos nombres raíz se reutilizan para
su nueva función, no para conservar su contenido anterior.

No se copió un archivo `.env`, credencial, inventario ni fixture laboral.
No se trasladaron tickets corporativos al tracker del producto. La historia
Git permanece y puede contener material anterior: limpiar el árbol no es
sanear la historia para distribución. `PROD-DIST-001` cubre esa revisión.

## Por qué se hizo en otro worktree

Las unidades locales `custodia-api-dev.service` y
`custodia-panel-dev.service` apuntan a `/home/saint/projects/Custodia`.
Limpiar ese directorio podía activar recargas o romper esos servicios.
Por eso el producto vive en `/home/saint/projects/Custodia-product`, rama
`product/go-reset`, desde el mismo commit. No se copiaron configuraciones
locales ni se cambiaron unidades, puertos, bases o servicios.

Se descartó traducir toda la aplicación: conservaría el acoplamiento laboral
y demoraría Portfolio. Tampoco basta una landing sin caso de uso. La ruta
elegida es demo acotada y producto Go construido por recorridos, conservando
garantías en vez de todo el backlog. Ver [producto](PRODUCT.md).
