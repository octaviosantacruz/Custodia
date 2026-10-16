import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
import unittest
from unittest.mock import ANY, AsyncMock, patch
from uuid import uuid4

from app.cross.repositories.ingestion import create_ingestion_run, finish_ingestion_run, set_sync_schedule_override
from app.cross.api.routes.ingestion_models import SyncScheduleOverrideUpdate


class FakeConnection:
    def __init__(self, completed_run=None, fetchone_values=None):
        self._fetchone_values = list(fetchone_values or [])

        async def fetchone():
            if self._fetchone_values:
                return self._fetchone_values.pop(0)
            return completed_run

        self.execute = AsyncMock(
            return_value=SimpleNamespace(fetchone=AsyncMock(side_effect=fetchone))
        )

    @asynccontextmanager
    async def transaction(self):
        yield self


class FakePool:
    def __init__(self, connection):
        self._connection = connection

    @asynccontextmanager
    async def connection(self):
        yield self._connection


class IngestionAuditTests(unittest.TestCase):
    def test_schedule_override_rejects_intervals_below_scheduler_floor(self):
        from pydantic import ValidationError
        for value in (-1, 1, 4.99, 525601):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                SyncScheduleOverrideUpdate(interval_minutes=value)
        self.assertEqual(SyncScheduleOverrideUpdate(interval_minutes=0).interval_minutes, 0)
        self.assertEqual(SyncScheduleOverrideUpdate(interval_minutes=5).interval_minutes, 5)
        self.assertIsNone(SyncScheduleOverrideUpdate(interval_minutes=None).interval_minutes)

    def test_schedule_override_and_audit_share_one_transaction(self):
        connection = FakeConnection(fetchone_values=[
            {"task_key": "netskope_inventory", "interval_minutes": 15.0},
            {"task_key": "netskope_inventory", "interval_minutes": 30.0},
        ])
        pool = FakePool(connection)
        with patch("app.cross.repositories.ingestion.record_audit", new=AsyncMock()) as audit:
            asyncio.run(set_sync_schedule_override(
                pool, task_key="netskope_inventory", interval_minutes=30, actor_id="admin-1",
            ))
        self.assertIn("pg_advisory_xact_lock", connection.execute.await_args_list[0].args[0])
        self.assertTrue(any("INSERT INTO public.sync_schedule_overrides" in call.args[0] for call in connection.execute.await_args_list))
        audit.assert_awaited_once_with(
            pool, connection=connection, actor_id="admin-1", action="update",
            entity_type="sync_schedule", entity_id="netskope_inventory",
            before_data={"task_key": "netskope_inventory", "interval_minutes": 15.0},
            after_data={"task_key": "netskope_inventory", "interval_minutes": 30.0},
        )

    def test_start_is_audited_in_the_run_creation_transaction(self):
        connection = FakeConnection()
        run_id = uuid4()
        with patch("app.cross.repositories.ingestion.record_audit", new=AsyncMock()) as record_audit, \
             patch("app.cross.repositories.ingestion.record_operational_log", new=AsyncMock()):
            asyncio.run(create_ingestion_run(
                FakePool(connection),
                run_id,
                triggered_by="operator@example.com",
                source_system="sia",
                source_file="sia-api",
            ))

        self.assertIn("INSERT INTO public.cyberark_ingestion_runs", connection.execute.await_args.args[0])
        record_audit.assert_awaited_once_with(
            ANY,
            connection=connection,
            actor_id="operator@example.com",
            action="sync_start",
            entity_type="ingestion_run",
            entity_id=str(run_id),
            after_data={
                "source_system": "sia",
                "source_file": "sia-api",
                "status": "running",
                "expected_safe_count": None,
            },
        )

    def test_completion_audit_records_counts_in_the_same_transaction(self):
        connection = FakeConnection({
            "source_system": "cyberark",
            "source_file": "cyberark-api",
            "triggered_by": "system:scheduler",
        })
        run_id = uuid4()
        with patch("app.cross.repositories.ingestion.record_audit", new=AsyncMock()) as record_audit, \
             patch("app.cross.repositories.ingestion.record_operational_log", new=AsyncMock()):
            asyncio.run(finish_ingestion_run(
                FakePool(connection),
                run_id,
                "completed",
                safe_count=4,
                member_count=9,
                errors=[],
                breakdown={"safes_retired": 1, "members_retired": 2},
            ))

        self.assertIn("RETURNING source_system, source_file, triggered_by", connection.execute.await_args.args[0])
        record_audit.assert_awaited_once_with(
            ANY,
            connection=connection,
            actor_id="system:scheduler",
            action="sync_complete",
            entity_type="ingestion_run",
            entity_id=str(run_id),
            after_data={
                "source_system": "cyberark",
                "source_file": "cyberark-api",
                "status": "completed",
                "received_objects": 4,
                "received_relationships": 9,
                "retired_objects": 1,
                "retired_relationships": 2,
                "error_count": 0,
            },
        )


    def test_completion_log_carries_psm_and_skipped_counters(self):
        """B1: the ambiguous-PSM counter (and mapping gaps) has no fixed run
        column, so it travels in the completion log metadata."""
        connection = FakeConnection({
            "source_system": "cyberark",
            "source_file": "cyberark-api",
            "triggered_by": "system:scheduler",
        })
        run_id = uuid4()
        with patch("app.cross.repositories.ingestion.record_audit", new=AsyncMock()), \
             patch("app.cross.repositories.ingestion.record_operational_log", new=AsyncMock()) as log:
            asyncio.run(finish_ingestion_run(
                FakePool(connection),
                run_id,
                "completed",
                safe_count=4,
                member_count=9,
                errors=[],
                breakdown={
                    "psm_references_ambiguous": 1,
                    "psm_references_catalog_missing": 2,
                    "skipped_accounts": 3,
                    "safes_retired": 1,
                },
            ))

        metadata = log.await_args.kwargs["metadata"]
        self.assertEqual(metadata["psm_references_ambiguous"], 1)
        self.assertEqual(metadata["psm_references_catalog_missing"], 2)
        self.assertEqual(metadata["skipped_accounts"], 3)
        self.assertNotIn("safes_retired", metadata)
        self.assertEqual(metadata["error_count"], 0)


if __name__ == "__main__":
    unittest.main()
