import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.cross.repositories.activity_events import list_activity_events, record_activity_event
from app.cross.repositories.audit import record_audit


class ActivityEventsTests(unittest.TestCase):
    def test_events_are_listed_after_the_requested_cursor(self):
        rows = [{
            "event_id": 17,
            "kind": "sync",
            "actor_id": "system:scheduler",
            "actor_name": "system:scheduler",
            "run_id": "f3a89a7a-6c2e-40d7-8f03-0bd6db1c7ac9",
            "source_system": "netskope",
            "created_at": "2026-09-10T01:00:00Z",
        }]
        with patch("app.cross.repositories.activity_events.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_activity_events(object(), since=12, limit=20))

        self.assertEqual(result["rows"], rows)
        query = fetch_all.await_args.args[1]
        self.assertIn("event.event_id > %s", query)
        self.assertIn("event.run_id::text AS run_id", query)
        self.assertIn("event.source_system", query)
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
        self.assertEqual(event_params, ("classification", "operator@example.com", None, None))

    def test_only_completed_sync_emits_a_cross_session_event(self):
        connection = AsyncMock()
        for action in ("sync_queued", "sync_start", "sync_complete", "sync_requeued"):
            asyncio.run(record_audit(
                object(), connection=connection, actor_id="system:scheduler",
                action=action, entity_type="ingestion_run", entity_id=f"run-{action}",
                after_data={"status": "completed", "source_system": "netskope"},
            ))

        event_calls = [
            call for call in connection.execute.await_args_list
            if "INSERT INTO public.activity_events" in call.args[0]
        ]
        self.assertEqual(len(event_calls), 1)
        self.assertEqual(
            event_calls[0].args[1],
            ("sync", "system:scheduler", "run-sync_complete", "netskope"),
        )

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
            ("import", "operator@example.com", None, None),
        )

    def test_sync_event_keeps_its_own_run_when_sources_finish_concurrently(self):
        connection = AsyncMock()
        for run_id, source_system in (("pam-run", "cyberark"), ("dlp-run", "netskope")):
            asyncio.run(record_audit(
                object(), connection=connection, actor_id="system:scheduler",
                action="sync_complete", entity_type="ingestion_run", entity_id=run_id,
                after_data={"status": "completed", "source_system": source_system},
            ))

        event_calls = [
            call.args[1] for call in connection.execute.await_args_list
            if "INSERT INTO public.activity_events" in call.args[0]
        ]
        self.assertEqual(event_calls, [
            ("sync", "system:scheduler", "pam-run", "cyberark"),
            ("sync", "system:scheduler", "dlp-run", "netskope"),
        ])


if __name__ == "__main__":
    unittest.main()
