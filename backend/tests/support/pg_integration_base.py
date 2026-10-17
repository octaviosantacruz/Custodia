"""IF-006: shared scaffolding for tests that need a real PostgreSQL
instance instead of a mocked cursor. Every test module built on
PostgresIntegrationTestCase is opt-in only: it requires
CUSTODIA_TEST_DATABASE_URL to point at a disposable/test database and never
reads .env.local or a bare DATABASE_URL (see the incident documented in
test_admin_invariant_postgres_integration.py -- that variable used to
silently reuse this repo's real RDS instance and could hang the gate on
any machine where that host isn't reachable).

To provision a local throwaway database for these tests:

    sudo -u postgres psql -c "CREATE ROLE custodia_test LOGIN PASSWORD '...'"
    sudo -u postgres psql -c "CREATE DATABASE custodia_test OWNER custodia_test"
    ENV_FILE=/dev/null DATABASE_URL=postgresql://custodia_test:...@localhost:5432/custodia_test \
        backend/.venv/bin/python scripts/migrate.py
    CUSTODIA_TEST_DATABASE_URL=postgresql://custodia_test:...@localhost:5432/custodia_test \
        PYTHONPATH=backend backend/.venv/bin/python -m unittest discover -s backend/tests -k Postgres
"""

import os
import unittest

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

OPT_IN_ENV_VAR = "CUSTODIA_TEST_DATABASE_URL"


class PostgresIntegrationTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        database_url = os.environ.get(OPT_IN_ENV_VAR, "").strip()
        if not database_url:
            self.skipTest(
                f"{OPT_IN_ENV_VAR} no está configurada; ver IF-006 y "
                "tests/support/pg_integration_base.py para levantar una base de test local."
            )
        self.pool = AsyncConnectionPool(conninfo=database_url, kwargs={"row_factory": dict_row}, min_size=2, max_size=6, open=False)
        try:
            await self.pool.open(wait=True, timeout=5)
        except Exception as exc:
            self.skipTest(f"Postgres no alcanzable para esta prueba: {exc.__class__.__name__}")
        self.addAsyncCleanup(self.pool.close)
