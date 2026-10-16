"""Regression for record_device_snapshots against real PostgreSQL.

A fully-mocked cursor test would not have caught this: the bug was calling
executemany on the AsyncConnection instead of a cursor, which only surfaces
against the real psycopg driver. See tests/support/pg_integration_base.py."""

from datetime import datetime, timezone
from uuid import uuid4

from app.netskope.sse.repositories.netskope_mutations import record_device_snapshots
from tests.support.netskope_pg_fixtures import reset_netskope_runs, seed_run
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class NetskopeDeviceSnapshotsPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope_runs(self.pool)
        self.addAsyncCleanup(reset_netskope_runs, self.pool)

    async def test_persists_and_upserts_by_source_run_and_device(self):
        run_id = uuid4()
        await seed_run(self.pool, run_id, "running", datetime.now(timezone.utc))

        await record_device_snapshots(self.pool, run_id, [
            {"source_id": "dev-1", "attributes": {"hostname": "NB-1"}},
            {"source_id": "dev-2", "attributes": {"hostname": "NB-2"}},
        ])
        # Re-running the same run_id/device_id pair upserts instead of
        # duplicating or raising a unique-violation.
        await record_device_snapshots(self.pool, run_id, [
            {"source_id": "dev-1", "attributes": {"hostname": "NB-1-RENAMED"}},
        ])

        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT device_id, attributes FROM public.netskope_device_snapshots"
                " WHERE source_run_id = %s ORDER BY device_id",
                (run_id,),
            )
            rows = await cursor.fetchall()

        self.assertEqual([row["device_id"] for row in rows], ["dev-1", "dev-2"])
        self.assertEqual(rows[0]["attributes"]["hostname"], "NB-1-RENAMED")
