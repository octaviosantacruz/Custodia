import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from app.api.routes.ingestion import (
    start_access_ingestion, start_all_ingestion, start_identity_admin_ingestion, start_ingestion,
    start_pam_connectors_ingestion, start_sia_ingestion,
)
from app.schemas import IngestionStart


class SourceIngestionRouteTests(unittest.TestCase):
    def setUp(self):
        self.request = SimpleNamespace(state=SimpleNamespace(), app=SimpleNamespace())
        self.coordinator = SimpleNamespace(wake=Mock())
        self.request.app.state = SimpleNamespace(db=object(), sync_coordinator=self.coordinator)

    def test_sia_route_enqueues_without_calling_the_external_synchronizer(self):
        queued = {"run_id": "run-sia", "status": "queued"}
        with patch('app.api.routes.ingestion.enqueue_sync_run', new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(start_sia_ingestion(self.request, 'operator@example.com'))
        self.assertEqual(result, queued)
        self.assertEqual(enqueue.await_args.kwargs["source_system"], "sia")
        self.assertEqual(enqueue.await_args.kwargs["source_file"], "sia-api")
        self.assertEqual(enqueue.await_args.kwargs["options"], {})
        self.coordinator.wake.assert_called_once()

    def test_identity_route_enqueues_with_its_own_source(self):
        queued = {"run_id": "run-identity", "status": "queued"}
        with patch('app.api.routes.ingestion.enqueue_sync_run', new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(start_identity_admin_ingestion(self.request, 'operator@example.com'))
        self.assertEqual(result, queued)
        self.assertEqual(enqueue.await_args.kwargs["source_system"], "identity_administration")
        self.assertEqual(enqueue.await_args.kwargs["source_file"], "identity-administration-scim")
        self.coordinator.wake.assert_called_once()

    def test_access_route_enqueues_with_its_own_source(self):
        queued = {"run_id": "run-access", "status": "queued"}
        with patch('app.api.routes.ingestion.enqueue_sync_run', new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(start_access_ingestion(self.request, 'operator@example.com'))
        self.assertEqual(result, queued)
        self.assertEqual(enqueue.await_args.kwargs["source_system"], "access")
        self.assertEqual(enqueue.await_args.kwargs["source_file"], "access-api")
        self.assertEqual(enqueue.await_args.kwargs["options"], {})
        self.coordinator.wake.assert_called_once()

    def test_pam_route_enqueues_validated_options(self):
        queued = {"run_id": "run-pam", "status": "queued"}
        payload = IngestionStart(page_size=50, member_delay_seconds=1, reconcile_complete=True)
        with patch('app.api.routes.ingestion.enqueue_sync_run', new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(start_ingestion(self.request, payload, 'operator@example.com'))
        self.assertEqual(result, queued)
        self.assertEqual(enqueue.await_args.kwargs["source_system"], "cyberark")
        self.assertEqual(
            enqueue.await_args.kwargs["options"],
            {"max_safes": 0, "page_size": 50, "member_delay_seconds": 1.0, "reconcile_complete": True},
        )

    def test_pam_connectors_route_enqueues_isolated_catalog_refresh(self):
        queued = {"run_id": "run-psm", "status": "queued"}
        with patch('app.api.routes.ingestion.enqueue_sync_run', new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(start_pam_connectors_ingestion(self.request, 'operator@example.com'))
        self.assertEqual(result, queued)
        self.assertEqual(enqueue.await_args.kwargs["source_system"], "cyberark")
        self.assertEqual(enqueue.await_args.kwargs["source_file"], "cyberark-psm-api")
        self.assertEqual(enqueue.await_args.kwargs["options"], {"psm_only": True, "page_size": 100})
        self.coordinator.wake.assert_called_once()

    def test_complete_sync_enqueues_full_sources_and_isolated_psm_refresh(self):
        payload = IngestionStart(page_size=50, member_delay_seconds=1, reconcile_complete=True)
        queued = [
            {"run_id": "run-pam", "status": "queued", "source_system": "cyberark"},
            {"run_id": "run-psm", "status": "queued", "source_system": "cyberark"},
            {"run_id": "run-identity", "status": "queued", "source_system": "identity_administration"},
            {"run_id": "run-sia", "status": "queued", "source_system": "sia"},
            {"run_id": "run-access", "status": "queued", "source_system": "access"},
        ]
        optional_jobs = [
            ("identity_administration", "identity-administration-scim", {}),
            ("sia", "sia-api", {}),
            ("access", "access-api", {}),
        ]
        with patch('app.api.routes.ingestion.enqueue_sync_runs', new=AsyncMock(return_value=queued)) as enqueue, \
             patch('app.api.routes.ingestion.configured_optional_source_jobs', return_value=optional_jobs):
            result = asyncio.run(start_all_ingestion(self.request, payload, 'operator@example.com'))
        self.assertEqual(result["runs"], queued)
        jobs = enqueue.await_args.args[1]
        self.assertEqual([job["source_system"] for job in jobs], ["cyberark", "cyberark", "identity_administration", "sia", "access"])
        self.assertEqual(jobs[0]["options"]["reconcile_complete"], True)
        self.assertEqual(jobs[1]["source_file"], "cyberark-psm-api")
        self.assertEqual(jobs[1]["options"], {"psm_only": True, "page_size": 50})
        self.assertEqual(jobs[2]["options"], {})
        self.assertEqual(jobs[3]["options"], {})
        self.assertEqual(jobs[4]["options"], {})
        self.coordinator.wake.assert_called_once()

    def test_complete_sync_skips_sources_whose_contract_is_not_configured(self):
        """A manual 'sync everything' must never enqueue a job for a source
        whose contract isn't configured -- it would just fail once dequeued.
        This matches scheduled_source_jobs' behavior exactly (same helper)."""
        payload = IngestionStart(page_size=50, member_delay_seconds=1, reconcile_complete=True)
        queued = [
            {"run_id": "run-pam", "status": "queued", "source_system": "cyberark"},
            {"run_id": "run-psm", "status": "queued", "source_system": "cyberark"},
        ]
        with patch('app.api.routes.ingestion.enqueue_sync_runs', new=AsyncMock(return_value=queued)) as enqueue, \
             patch('app.api.routes.ingestion.configured_optional_source_jobs', return_value=[]):
            result = asyncio.run(start_all_ingestion(self.request, payload, 'operator@example.com'))
        self.assertEqual(result["runs"], queued)
        jobs = enqueue.await_args.args[1]
        self.assertEqual([job["source_system"] for job in jobs], ["cyberark", "cyberark"])
        self.assertEqual(jobs[1]["options"], {"psm_only": True, "page_size": 50})
        self.coordinator.wake.assert_called_once()


if __name__ == '__main__':
    unittest.main()
