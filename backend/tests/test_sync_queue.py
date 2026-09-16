import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
import unittest
from unittest.mock import ANY, AsyncMock, patch
from uuid import uuid4

from app.repositories.sync_queue import claim_next_sync_run, enqueue_sync_run, enqueue_sync_runs
from app.sync_coordinator import SyncCoordinator


@asynccontextmanager
async def acquired_source_lock(*_args):
    yield True


class FakeConnection:
    def __init__(self, rows):
        self.rows = iter(rows)
        self.execute = AsyncMock(side_effect=self._execute)

    async def _execute(self, *_args, **_kwargs):
        return SimpleNamespace(fetchone=AsyncMock(return_value=next(self.rows)))

    @asynccontextmanager
    async def transaction(self):
        yield self


class FakePool:
    def __init__(self, connection):
        self._connection = connection

    @asynccontextmanager
    async def connection(self):
        yield self._connection


class SyncQueueTests(unittest.TestCase):
    def test_enqueue_persists_audited_queued_job(self):
        run_id = uuid4()
        connection = FakeConnection([{"run_id": run_id, "status": "queued"}])
        with patch("app.repositories.sync_queue.record_audit", new=AsyncMock()) as audit:
            row = asyncio.run(enqueue_sync_run(
                FakePool(connection), run_id, source_system="sia", source_file="sia-api",
                triggered_by="operator@example.com", options={},
            ))

        self.assertEqual(row["status"], "queued")
        self.assertIn("'queued'", connection.execute.await_args.args[0])
        audit.assert_awaited_once_with(
            ANY, connection=connection, actor_id="operator@example.com",
            action="sync_queued", entity_type="ingestion_run", entity_id=str(run_id),
            after_data={"source_system": "sia", "status": "queued"},
        )

    def test_enqueue_batch_persists_isolated_jobs_in_one_transaction(self):
        pam_id, identity_id, sia_id = uuid4(), uuid4(), uuid4()
        connection = FakeConnection([
            {"run_id": pam_id, "status": "queued", "source_system": "cyberark"},
            {"run_id": identity_id, "status": "queued", "source_system": "identity_administration"},
            {"run_id": sia_id, "status": "queued", "source_system": "sia"},
        ])
        jobs = [
            {"run_id": pam_id, "source_system": "cyberark", "source_file": "cyberark-api", "options": {"reconcile_complete": True}},
            {"run_id": identity_id, "source_system": "identity_administration", "source_file": "identity-administration-scim", "options": {}},
            {"run_id": sia_id, "source_system": "sia", "source_file": "sia-api", "options": {}},
        ]
        with patch("app.repositories.sync_queue.record_audit", new=AsyncMock()) as audit:
            rows = asyncio.run(enqueue_sync_runs(
                FakePool(connection), jobs, triggered_by="operator@example.com",
            ))
        self.assertEqual([row["source_system"] for row in rows], ["cyberark", "identity_administration", "sia"])
        self.assertEqual(audit.await_count, 3)
        self.assertEqual(connection.execute.await_count, 3)

    def test_claim_transitions_only_its_source_and_audits_start(self):
        run_id = uuid4()
        queued = {
            "run_id": run_id, "source_system": "sia", "source_file": "sia-api",
            "triggered_by": "operator@example.com", "run_options": {},
        }
        connection = FakeConnection([queued, None])
        with patch("app.repositories.sync_queue.record_audit", new=AsyncMock()) as audit:
            run = asyncio.run(claim_next_sync_run(
                FakePool(connection), source_system="sia", worker_id="worker-1"
            ))

        self.assertEqual(run, queued)
        select = connection.execute.await_args_list[0].args[0]
        self.assertIn("source_system = %s AND status = 'queued'", select)
        self.assertIn("FOR UPDATE SKIP LOCKED", select)
        audit.assert_awaited_once()
        self.assertEqual(audit.await_args.kwargs["action"], "sync_start")

    def test_coordinator_dispatches_each_source_in_a_separate_task(self):
        coordinator = SyncCoordinator(object())
        coordinator._wake_event.set()
        queued_sources = ["sia", "identity_administration"]
        with patch("app.sync_coordinator.requeue_expired_sync_runs", new=AsyncMock(return_value=0)), \
             patch("app.sync_coordinator.list_queued_sync_sources", new=AsyncMock(return_value=queued_sources)), \
             patch.object(coordinator, "_run_source", new=AsyncMock(side_effect=asyncio.CancelledError)):
            async def dispatch_once():
                task = asyncio.create_task(coordinator._dispatch_loop())
                await asyncio.sleep(0)
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            asyncio.run(dispatch_once())

        self.assertEqual(len(coordinator._source_tasks), 0)

    def test_coordinator_executes_only_the_claimed_source_synchronizer(self):
        coordinator = SyncCoordinator(object())
        run = {
            "run_id": uuid4(), "source_system": "sia", "source_file": "sia-api",
            "triggered_by": "operator@example.com", "run_options": {},
        }
        with patch("app.sync_coordinator.source_sync_lock", acquired_source_lock), \
             patch("app.sync_coordinator.claim_next_sync_run", new=AsyncMock(return_value=run)), \
             patch("app.sync_coordinator.sync_sia_inventory", new=AsyncMock(return_value={"objects": 2})), \
             patch("app.sync_coordinator.sync_identity_admin_inventory", new=AsyncMock()) as identity_sync, \
             patch("app.sync_coordinator.sync_access_inventory", new=AsyncMock()) as access_sync, \
             patch("app.sync_coordinator.finish_ingestion_run", new=AsyncMock()) as finish, \
             patch("app.sync_coordinator.refresh_findings", new=AsyncMock()):
            asyncio.run(coordinator._run_source("sia"))

        identity_sync.assert_not_awaited()
        access_sync.assert_not_awaited()
        self.assertEqual(finish.await_args.args[2], "completed")
        self.assertEqual(finish.await_args.kwargs["source_counts"], {"objects": 2})

    def test_coordinator_dispatches_access_source_in_isolation(self):
        coordinator = SyncCoordinator(object())
        run = {
            "run_id": uuid4(), "source_system": "access", "source_file": "access-api",
            "triggered_by": "operator@example.com", "run_options": {},
        }
        with patch("app.sync_coordinator.source_sync_lock", acquired_source_lock), \
             patch("app.sync_coordinator.claim_next_sync_run", new=AsyncMock(return_value=run)), \
             patch("app.sync_coordinator.sync_access_inventory", new=AsyncMock(return_value={"objects": 7})) as access_sync, \
             patch("app.sync_coordinator.sync_sia_inventory", new=AsyncMock()) as sia_sync, \
             patch("app.sync_coordinator.sync_identity_admin_inventory", new=AsyncMock()) as identity_sync, \
             patch("app.sync_coordinator.finish_ingestion_run", new=AsyncMock()) as finish, \
             patch("app.sync_coordinator.refresh_findings", new=AsyncMock()):
            asyncio.run(coordinator._run_source("access"))

        access_sync.assert_awaited_once()
        sia_sync.assert_not_awaited()
        identity_sync.assert_not_awaited()
        self.assertEqual(finish.await_args.args[2], "completed")
        self.assertEqual(finish.await_args.kwargs["source_counts"], {"objects": 7})


if __name__ == "__main__":
    unittest.main()
