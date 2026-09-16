# Suite de integración contra PostgreSQL real (IF-006)

## Por qué existe

La mayoría de la suite backend usa dobles (`AsyncMock`, cursores falsos,
inspección de strings SQL). Eso es suficiente para lógica pura, pero no
puede demostrar comportamiento que depende de PostgreSQL real: adquisición
efectiva de un advisory lock entre dos conexiones concurrentes, que un
`UPSERT` realmente serializa incrementos concurrentes sobre la misma fila,
o que `FOR UPDATE SKIP LOCKED` evita que dos workers reclamen el mismo job
de la cola. Un cursor falso no tiene noción de una segunda transacción
independiente bloqueada sobre el mismo recurso.

Estas pruebas son **opt-in**: requieren la variable `DSHUB_TEST_DATABASE_URL`
apuntando a una base descartable. Nunca leen `.env.local` ni usan
`DATABASE_URL` como fallback — una versión anterior de una de estas pruebas
sí lo hacía, reutilizaba en silencio la RDS real de este repo, e intentaba
conectarse a ella en cualquier máquina donde ese host no fuera alcanzable
(la resolución DNS contra un host privado inalcanzable puede bloquear mucho
más allá de cualquier timeout de conexión). Eso colgó el gate en vez de
saltear limpio. Ver `backend/tests/pg_integration_base.py`.

Sin la variable configurada, estas pruebas se saltan de forma instantánea,
sin tocar red ni archivos.

## Levantar una base de test local desde cero

Requiere PostgreSQL instalado localmente (`postgresql`, cualquier versión
reciente sirve). Ejemplo con un cluster ya corriendo:

```bash
sudo -u postgres psql -c "CREATE ROLE dshub_test LOGIN PASSWORD 'elegí-algo-local'"
sudo -u postgres psql -c "CREATE DATABASE dshub_test OWNER dshub_test"

# Aplicar las 47 migraciones desde cero -- ENV_FILE=/dev/null evita que el
# runner cargue .env.local encima de este DATABASE_URL explícito.
ENV_FILE=/dev/null DATABASE_URL="postgresql://dshub_test:elegí-algo-local@localhost:5432/dshub_test" \
    backend/.venv/bin/python scripts/migrate.py
```

Confirmar que las 47 migraciones quedaron registradas:

```bash
PGPASSWORD=elegí-algo-local psql -h localhost -U dshub_test -d dshub_test \
    -tAc "SELECT count(*) FROM public.schema_migrations"
```

## Correr la suite de integración

```bash
DSHUB_TEST_DATABASE_URL="postgresql://dshub_test:elegí-algo-local@localhost:5432/dshub_test" \
    PYTHONPATH=backend backend/.venv/bin/python -m unittest discover -s backend/tests -k Postgres -v
```

Cubre hoy:

- **`test_admin_invariant_postgres_integration.py`** (IF-002): el
  advisory lock compartido de `lock_admin_invariant()` realmente serializa
  dos transacciones concurrentes.
- **`test_rate_limiting_postgres_integration.py`** (IF-001): 20
  reservas verdaderamente concurrentes contra el mismo `bucket_key`
  producen exactamente los conteos 1..20 sin duplicados ni huecos (ninguna
  actualización se pierde); buckets distintos no interfieren entre sí.
- **`test_sync_queue_postgres_integration.py`**: dos workers que
  reclaman de la misma cola con `FOR UPDATE SKIP LOCKED` nunca reclaman el
  mismo job; reclamar una cola vacía no bloquea y devuelve `None`.

Ninguna de estas pruebas escribe contra una base compartida entre
corridas de forma persistente: cada una limpia sus propias filas de test
en `setUp`/`tearDown`.

## Pendiente

No forma parte todavía del gate automatizado (`npm run verify`): requiere
una base de test provisionada, y no hay CI versionado en el repositorio
(ver IF-007). Extender esta suite a autenticación/RBAC completo y
reconciliación de fuentes queda para una siguiente iteración si se
prioriza.
