import asyncio
import unittest
from unittest.mock import AsyncMock

from app.cyberark.pam.repositories.safe_mutations import (
    bulk_update_safe_assignment, update_safe_assignment, update_safe_metadata,
)
from app.cyberark.pam.schemas import SafeAssignmentUpdate, SafeBulkAssignment, SafeMetadataUpdate, SafeQuickUpdate


class AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


class FakeCursor:
    def __init__(self):
        self.execute_calls = []
        self.fetchone_values = [(1,), {"data": {}} , {"safe_number": 380}]

    async def execute(self, query, params):
        self.execute_calls.append((query, params))

    async def fetchone(self):
        return self.fetchone_values.pop(0)


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor
        self.execute = AsyncMock()

    def transaction(self):
        return AsyncContext(None)

    def cursor(self):
        return AsyncContext(self.cursor_value)


class FakePool:
    def __init__(self, connection):
        self.connection_value = connection

    def connection(self):
        return AsyncContext(self.connection_value)


class RetentionHoldStatusTests(unittest.TestCase):
    def test_retention_hold_is_an_accepted_manual_workflow_status_that_keeps_the_action(self):
        payload = SafeQuickUpdate(workflow_status="retention_hold", next_action="Dar de baja")
        self.assertEqual(payload.workflow_status, "retention_hold")
        self.assertEqual(payload.next_action, "Dar de baja")

    def test_unknown_workflow_status_is_still_rejected(self):
        with self.assertRaises(ValueError):
            SafeQuickUpdate(workflow_status="deleted")

    def test_migration_allows_retention_hold_and_keeps_existing_statuses(self):
        from pathlib import Path
        sql = (Path(__file__).resolve().parents[4] / "migrations" / "089_safe_workflow_retention_hold.sql").read_text()
        for status in ("pending", "in_progress", "blocked", "resolved", "retired", "retention_hold"):
            self.assertIn(f"'{status}'", sql)


class SafeMutationQueryTests(unittest.TestCase):
    def test_resolved_safe_cannot_keep_a_next_action(self):
        payload = SafeQuickUpdate(workflow_status="resolved", next_action="Migrar a SIA")
        self.assertIsNone(payload.next_action)

    def test_assignment_casts_nullable_catalog_ids_before_postgres_checks_them(self):
        cursor = FakeCursor()
        pool = FakePool(FakeConnection(cursor))

        asyncio.run(update_safe_assignment(
            pool, 380, SafeAssignmentUpdate(business_unit_id=2), 'operator@example.com'
        ))

        query = cursor.execute_calls[2][0]
        self.assertIn(
            "CASE WHEN %s::BIGINT IS NOT NULL AND %s::BIGINT IS NOT NULL",
            query,
        )
        self.assertIn(
            "CASE WHEN %s::BIGINT IS NOT NULL OR %s::BIGINT IS NOT NULL",
            query,
        )

    def test_metadata_casts_nullable_catalog_ids_before_postgres_checks_them(self):
        cursor = FakeCursor()
        pool = FakePool(FakeConnection(cursor))

        asyncio.run(update_safe_metadata(
            pool,
            380,
            SafeMetadataUpdate(business_unit_id=2),
            'operator@example.com',
        ))

        query = cursor.execute_calls[2][0]
        self.assertIn(
            "CASE WHEN %s::BIGINT IS NOT NULL OR %s::BIGINT IS NOT NULL",
            query,
        )


class SequencedCursor:
    def __init__(self, fetchone_values=(), fetchall_values=()):
        self.execute_calls = []
        self.fetchone_values = list(fetchone_values)
        self.fetchall_values = list(fetchall_values)

    async def execute(self, query, params=None):
        self.execute_calls.append((query, params))

    async def fetchone(self):
        return self.fetchone_values.pop(0)

    async def fetchall(self):
        return self.fetchall_values.pop(0)


class BulkAssignmentTests(unittest.TestCase):
    """AUD-PERF-002: bulk_update_safe_assignment batches the existence+
    snapshot check, the upsert, the audit insert, and the activity-event
    insert into one round trip each -- 4 total queries regardless of how
    many Safes are selected, instead of ~5 sequential queries per Safe.
    """

    def test_owner_assignment_writes_one_audit_per_safe_and_reports_missing(self):
        # safe_numbers has a duplicate 380 -- SafeBulkAssignment's own
        # validator dedupes it before this function ever sees it.
        cursor = SequencedCursor(fetchall_values=[
            [{"safe_number": 380, "data": {"x": 1}}],  # existence+before: only 380 exists
            [{"safe_number": 380, "business_unit_id": 2, "responsible_id": 5}],  # upsert RETURNING *
        ])
        connection = FakeConnection(cursor)
        pool = FakePool(connection)

        result = asyncio.run(bulk_update_safe_assignment(
            pool,
            SafeBulkAssignment(safe_numbers=[380, 999, 380], business_unit_id=2, responsible_id=5),
            'operator@example.com',
        ))

        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["updated_safe_numbers"], [380])
        self.assertEqual(result["missing_safe_numbers"], [999])
        # Exactly 4 round trips total: existence+before, upsert, batched
        # audit insert, batched activity-event insert -- not one query set
        # per Safe.
        self.assertEqual(len(cursor.execute_calls), 4)

        existence_query = cursor.execute_calls[0][0]
        self.assertIn("LEFT JOIN public.cyberark_safe_metadata", existence_query)
        self.assertIn("= ANY(%s)", existence_query)

        insert_query = cursor.execute_calls[1][0]
        self.assertIn("classification_status", insert_query)
        self.assertIn("assigned_at", insert_query)

        audit_query, audit_params = cursor.execute_calls[2]
        self.assertIn("INSERT INTO public.access_audit_log", audit_query)
        self.assertEqual(audit_params[0], 'operator@example.com')
        self.assertEqual(audit_params[1], "bulk_update")
        self.assertEqual(audit_params[2], "safe_assignment")
        self.assertEqual(audit_params[3], "380")

        event_query, event_params = cursor.execute_calls[3]
        self.assertIn("INSERT INTO public.activity_events", event_query)
        self.assertEqual(event_params, ("classification", 'operator@example.com'))

    def test_workflow_only_bulk_does_not_touch_owner_columns(self):
        cursor = SequencedCursor(fetchall_values=[
            [{"safe_number": 380, "data": {}}],
            [{"safe_number": 380, "workflow_status": "in_progress"}],
        ])
        pool = FakePool(FakeConnection(cursor))

        asyncio.run(bulk_update_safe_assignment(
            pool, SafeBulkAssignment(safe_numbers=[380], workflow_status="in_progress"), 'operator@example.com',
        ))

        insert_query = cursor.execute_calls[1][0]
        self.assertIn("workflow_status", insert_query)
        self.assertNotIn("business_unit_id", insert_query)
        self.assertNotIn("assigned_by", insert_query)

    def test_all_requested_safes_missing_short_circuits_without_writes(self):
        cursor = SequencedCursor(fetchall_values=[[]])  # nothing matches
        pool = FakePool(FakeConnection(cursor))

        result = asyncio.run(bulk_update_safe_assignment(
            pool, SafeBulkAssignment(safe_numbers=[404, 405], workflow_status="in_progress"), 'operator@example.com',
        ))

        self.assertEqual(result, {"updated": 0, "updated_safe_numbers": [], "missing_safe_numbers": [404, 405]})
        # No upsert, audit, or activity-event query is issued when nothing exists.
        self.assertEqual(len(cursor.execute_calls), 1)


if __name__ == '__main__':
    unittest.main()
