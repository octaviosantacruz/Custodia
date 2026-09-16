"""IF-006: proves claim_next_sync_run()'s `FOR UPDATE SKIP LOCKED` genuinely
prevents two concurrent workers from claiming the same queued job -- a
fake cursor can't demonstrate this, since the whole risk is two real,
simultaneous transactions racing over the same row. Opt-in only; see
tests/pg_integration_base.py."""

import asyncio
import uuid

from app.repositories.sync_queue import claim_next_sync_run, enqueue_sync_run
from tests.pg_integration_base import PostgresIntegrationTestCase


class SyncQueueClaimConcurrencyPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.cyberark_ingestion_runs WHERE triggered_by = 'test-suite'")

    async def asyncTearDown(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.cyberark_ingestion_runs WHERE triggered_by = 'test-suite'")

    async def test_two_concurrent_workers_never_claim_the_same_queued_run(self):
        source_system = "cyberark"
        run_ids = [uuid.uuid4() for _ in range(6)]
        for run_id in run_ids:
            await enqueue_sync_run(
                self.pool,
                run_id,
                source_system=source_system,
                source_file=f"test-{run_id}.csv",
                triggered_by="test-suite",
                options={},
            )

        # Two workers race for the same source; SKIP LOCKED means each
        # claims a distinct row instead of blocking on (or duplicating) the
        # other's in-flight row.
        claimed = await asyncio.gather(*(
            claim_next_sync_run(self.pool, source_system=source_system, worker_id=f"worker-{i}")
            for i in range(2)
        ))
        claimed_ids = [row["run_id"] for row in claimed if row is not None]

        self.assertEqual(len(claimed_ids), 2)
        self.assertEqual(len(set(claimed_ids)), 2)  # no duplicate claim
        self.assertTrue(set(claimed_ids).issubset(set(run_ids)))

        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT status FROM public.cyberark_ingestion_runs WHERE run_id = ANY(%s)",
                (claimed_ids,),
            )
            statuses = [row["status"] for row in await cursor.fetchall()]
        self.assertEqual(statuses, ["running", "running"])

    async def test_claiming_an_empty_queue_returns_none_without_blocking(self):
        result = await claim_next_sync_run(self.pool, source_system="sia", worker_id="worker-empty")
        self.assertIsNone(result)


if __name__ == "__main__":
    import unittest
    unittest.main()
