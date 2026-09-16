import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
import unittest
from unittest.mock import ANY, AsyncMock, patch
from uuid import uuid4

from app.repositories.ingestion import create_ingestion_run, finish_ingestion_run


class FakeConnection:
    def __init__(self, completed_run=None):
        self.execute = AsyncMock(
            return_value=SimpleNamespace(fetchone=AsyncMock(return_value=completed_run))
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
    def test_start_is_audited_in_the_run_creation_transaction(self):
        connection = FakeConnection()
        run_id = uuid4()
        with patch("app.repositories.ingestion.record_audit", new=AsyncMock()) as record_audit:
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
        with patch("app.repositories.ingestion.record_audit", new=AsyncMock()) as record_audit:
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


if __name__ == "__main__":
    unittest.main()
