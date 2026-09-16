# DS Hub

DS Hub es una CMDB operativa para inventario y gobierno de acceso
privilegiado. Consolida información de CyberArk PAM, Identity Administration,
SIA y Access space en un único espacio de trabajo, manteniendo separadas las
fuentes de origen para que una sincronización parcial no mezcle ni borre datos
de otro sistema.

CyberArk sigue siendo la fuente de verdad de lo observado. DS Hub conserva el
historial de sincronizaciones y los metadatos de operación —responsables,
clasificación, estado y próximas acciones— sin sobrescribir decisiones humanas
cuando llega una nueva actualización.

## Qué incluye

- **Inventario PAM**: Safes, miembros, cuentas, usuarios, roles, plataformas y
  conectores/servidores PSM.
- **Conectores unificados**: el workspace de conectores permite alternar entre
  PSM y SIA sin mezclar sus registros. La actualización PSM también puede
  ejecutarse de forma aislada para refrescar nombres y servidores aunque otra
  parte de la ingesta PAM falle.
- **Catálogos separados**: Identity Administration, SIA y Access space tienen
  sus propios objetos, permisos, rutas de sincronización y `source_system`.
- **Sincronización operativa**: el menú **Sincronizar datos** muestra una
  previsualización y luego encola PAM, el catálogo PSM y sólo las fuentes
  opcionales que tengan su contrato configurado. Cada corrida queda registrada
  con estado, errores, auditoría y seguridad ante resultados parciales.
- **Workspaces y dashboard**: búsqueda, filtros, métricas de salud y edición de
  metadatos operativos desde una interfaz React.

Las credenciales y secretos permanecen en el backend; nunca se envían al
frontend ni se versionan. Los contratos de las integraciones externas están
documentados en [docs/architecture/integration-contracts.md](docs/architecture/integration-contracts.md).

## Stack

- **Backend**: Python, FastAPI, PostgreSQL mediante `psycopg`.
- **Frontend**: React, TypeScript y Vite.
- **Persistencia**: migraciones SQL numeradas e inmutables, con
  `migrations/baseline.sql` para bases nuevas.
- **Integraciones**: clientes HTTP aislados en `backend/app/integrations/` y
  acceso SQL concentrado en repositorios.

## Estructura del proyecto

```text
backend/      API FastAPI, integraciones, servicios y repositorios
frontend/     Aplicación web React + TypeScript
migrations/   Historial ordenado e inmutable del esquema PostgreSQL
scripts/      Migraciones y utilidades operativas
docs/         Arquitectura, contratos, producto y operación
```

## Puesta en marcha local

Requisitos: Python con un entorno virtual, Node.js/npm y una instancia de
PostgreSQL accesible.

```bash
# Backend
backend/.venv/bin/pip install -r backend/requirements.txt

# Frontend
npm install && npm install --prefix frontend

# Configuración local (completar los valores del template)
cp .env.example .env.local

# API en :8000 y frontend en :5173
npm run web
```

La configuración de base de datos, CyberArk y las integraciones opcionales se
define mediante variables de entorno; `.env.example` enumera las claves
disponibles. Para desarrollo local se puede usar `APP_WRITE_TOKEN`. En entornos
compartidos, `AUTH_MODE=oidc` habilita OIDC y asigna los grupos del proveedor a
los roles internos `reader`, `operator` y `admin`; `AUTH_MODE=hybrid` permite
una migración gradual.

## Verificación

```bash
# Tests unitarios del backend
cd backend && .venv/bin/python -m unittest discover -s tests

# Backend, probes, build frontend y comprobaciones del repositorio
npm run verify

# Browser y accesibilidad (requiere Chromium de Playwright)
npm run verify:e2e
```

Las pruebas E2E usan respuestas API controladas y no requieren credenciales ni
una base de datos del tenant.

## Despliegue

El repositorio entrega imágenes separadas de backend y frontend. PostgreSQL,
los secretos y la orquestación son externos; no se utiliza Docker Compose
dentro del repositorio. Las migraciones se ejecutan como un paso controlado del
despliegue. Consultá la [guía de despliegue](docs/operations/deployment.md).

Para el mapa completo de la documentación, ver [docs/README.md](docs/README.md).
