import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.activity_events import list_activity_events, record_activity_event
from app.repositories.audit import record_audit


class ActivityEventsTests(unittest.TestCase):
    def test_events_are_listed_after_the_requested_cursor(self):
        rows = [{
            "event_id": 17,
            "kind": "sync",
            "actor_id": "system:scheduler",
            "actor_name": "system:scheduler",
            "created_at": "2026-09-10T01:00:00Z",
        }]
        with patch("app.repositories.activity_events.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_activity_events(object(), since=12, limit=20))

        self.assertEqual(result["rows"], rows)
        query = fetch_all.await_args.args[1]
        self.assertIn("event.event_id > %s", query)
        self.assertIn("ORDER BY event.event_id ASC", query)
        self.assertEqual(fetch_all.await_args.args[2], (12, 20))

    def test_classification_event_uses_the_mutation_connection(self):
        connection = AsyncMock()
        asyncio.run(record_audit(
            object(),
            connection=connection,
            actor_id="operator@example.com",
            action="update",
            entity_type="safe_metadata",
            entity_id="380",
            after_data={"workflow_status": "in_progress"},
        ))

        self.assertEqual(connection.execute.await_count, 2)
        audit_query = connection.execute.await_args_list[0].args[0]
        event_query, event_params = connection.execute.await_args_list[1].args
        self.assertIn("INSERT INTO public.access_audit_log", audit_query)
        self.assertIn("INSERT INTO public.activity_events", event_query)
        self.assertEqual(event_params, ("classification", "operator@example.com"))

    def test_completed_sync_emits_a_sync_event(self):
        connection = AsyncMock()
        asyncio.run(record_audit(
            object(),
            connection=connection,
            actor_id="system:scheduler",
            action="sync_complete",
            entity_type="ingestion_run",
            entity_id="run-1",
            after_data={"status": "completed"},
        ))

        self.assertEqual(connection.execute.await_args_list[1].args[1], ("sync", "system:scheduler"))

    def test_direct_event_write_uses_the_supplied_transaction_connection(self):
        connection = AsyncMock()
        asyncio.run(record_activity_event(
            object(),
            connection=connection,
            kind="import",
            actor_id="operator@example.com",
        ))

        connection.execute.assert_awaited_once()
        self.assertEqual(
            connection.execute.await_args.args[1],
            ("import", "operator@example.com"),
        )


if __name__ == "__main__":
    unittest.main()
