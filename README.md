# Custodia

**Creado por Octavio Santacruz.**

Para mantener el proyecto sin contexto previo, empezá por
[MAINTAINING.md](MAINTAINING.md): explica los puntos de entrada, las capas,
el recorrido de los datos y cómo verificar un cambio.

Custodia es una CMDB operativa para inventario y gobierno de acceso
privilegiado. Consolida información de CyberArk PAM, Identity Administration,
SIA, Access space y Netskope en un único espacio de trabajo, manteniendo separadas las
fuentes de origen para que una sincronización parcial no mezcle ni borre datos
de otro sistema.

CyberArk sigue siendo la fuente de verdad de lo observado. Custodia conserva el
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
- **Netskope**: inventario de usuarios y dispositivos, experiencia,
  agregados de alertas y captura mínima DLP, con permisos y contratos propios.
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
- **Integraciones**: clientes HTTP dentro de cada plataforma/herramienta;
  transporte OAuth CyberArk compartido en `cyberark/shared/integrations/`.
  El acceso SQL pertenece a los repositorios y servicios de persistencia existentes.

## Estructura del proyecto

```text
backend/      API FastAPI, integraciones, servicios y repositorios
frontend/     Aplicación web React + TypeScript
migrations/   Historial ordenado e inmutable del esquema PostgreSQL
scripts/      Migraciones y utilidades operativas
docs/         Arquitectura, contratos, producto y operación
```

## Puesta en marcha local

Requisitos: Python con un entorno virtual, Node.js 24/npm y una instancia de
PostgreSQL accesible.

```bash
# Backend
backend/.venv/bin/python -m pip install 'pip>=26.2,<27'
backend/.venv/bin/pip install --require-hashes -r backend/requirements.lock.txt
backend/.venv/bin/pip install -r backend/requirements-dev.txt

# Frontend
npm ci && npm ci --prefix frontend

# Configuración local (completar los valores del template)
cp .env.example .env.local

# API en :8000 y frontend en :5174
npm run web
```

El lock del backend se genera con Python 3.14. Las herramientas de desarrollo
incluyen el linter, las pruebas de propiedades, la regeneración del lock y la
auditoría de dependencias. Para regenerarlo después de modificar
`backend/requirements.txt`:

```bash
cd backend
.venv/bin/python -m piptools compile --generate-hashes --no-emit-index-url \
  --output-file=requirements.lock.txt requirements.txt
```

`npm --prefix frontend run typecheck` invoca explícitamente TypeScript 7 y
forma parte del build. El alias `typescript5` se conserva para el generador
de tipos OpenAPI; ambos paquetes publican un ejecutable `tsc`, por lo que el
build evita depender de cuál enlace haya creado npm.

La configuración de base de datos, CyberArk y las integraciones opcionales se
define mediante variables de entorno; `.env.example` enumera las claves
disponibles. Para desarrollo local se puede usar `APP_WRITE_TOKEN`. En entornos
compartidos, `AUTH_MODE=oidc` habilita OIDC y asigna los grupos del proveedor a
los roles internos `reader`, `operator` y `admin`; `AUTH_MODE=hybrid` permite
una migración gradual.

Una sesión local u OIDC puede emitir un token Bearer personal y temporal para
consultar la API protegida desde Swagger o una herramienta externa, sin copiar
la cookie del navegador. Estos tokens son exclusivamente de lectura, conservan
los permisos efectivos del usuario y pueden revocarse. Ver
[`docs/operations/authentication.md`](docs/operations/authentication.md).

## Verificación

```bash
# Tests unitarios del backend
(cd backend && .venv/bin/python -m unittest discover -s tests)

# Backend, probes, build frontend y comprobaciones del repositorio
npm run verify

# Unitarios frontend (discovery recursivo por plataforma/herramienta)
npm --prefix frontend run test:unit

# E2E por plataforma y funciones compartidas
npm --prefix frontend run test:e2e:cyberark
npm --prefix frontend run test:e2e:netskope
npm --prefix frontend run test:e2e:cross

# Browser y accesibilidad (requiere Chromium de Playwright)
npm run verify:e2e
```

Las pruebas E2E usan respuestas API controladas y no requieren credenciales ni
una base de datos del tenant.

## Despliegue

El despliegue activo usa systemd y `npm run deploy`, con PostgreSQL externo.
Las migraciones se ejecutan con `scripts/migrate.sh` desde el checkout
configurado. Docker está documentado como diseño futuro; actualmente no hay
Dockerfiles ni Compose. Consultá la [guía de despliegue](docs/operations/deployment.md).

Para el mapa completo de la documentación, ver [docs/README.md](docs/README.md).
