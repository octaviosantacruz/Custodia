import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from app.cyberark.access.api.routes.ingestion import start_access_ingestion
from app.cross.api.routes.ingestion import start_all_ingestion
from app.cyberark.identity_administration.api.routes.ingestion import start_identity_admin_ingestion
from app.cyberark.pam.api.routes.ingestion import start_ingestion, start_pam_connectors_ingestion
from app.netskope.sse.api.routes.ingestion import start_netskope_ingestion
from app.netskope.sse.integrations.netskope import DLP_INCIDENT_PATH
from app.cyberark.sia.api.routes.ingestion import start_sia_ingestion
from app.cyberark.pam.schemas import IngestionStart


class SourceIngestionRouteTests(unittest.TestCase):
    def setUp(self):
        self.request = SimpleNamespace(state=SimpleNamespace(), app=SimpleNamespace())
        self.coordinator = SimpleNamespace(wake=Mock())
        self.request.app.state = SimpleNamespace(db=object(), sync_coordinator=self.coordinator)

    def test_sia_route_enqueues_without_calling_the_external_synchronizer(self):
        queued = {"run_id": "run-sia", "status": "queued"}

        async def persisted(*args, **kwargs):
            self.coordinator.wake.assert_not_called()
            return queued

        with patch('app.cross.services.sync_control.enqueue_sync_run', new=AsyncMock(side_effect=persisted)) as enqueue:
            result = asyncio.run(start_sia_ingestion(self.request, 'operator@example.com'))
        self.assertEqual(result, queued)
        self.assertEqual(enqueue.await_args.kwargs["source_system"], "sia")
        self.assertEqual(enqueue.await_args.kwargs["source_file"], "sia-api")
        self.assertEqual(enqueue.await_args.kwargs["options"], {})
        self.coordinator.wake.assert_called_once()

    def test_failed_enqueue_does_not_wake_the_dispatcher(self):
        with patch('app.cross.services.sync_control.enqueue_sync_run', new=AsyncMock(side_effect=RuntimeError('queue unavailable'))):
            with self.assertRaisesRegex(RuntimeError, 'queue unavailable'):
                asyncio.run(start_sia_ingestion(self.request, 'operator@example.com'))
        self.coordinator.wake.assert_not_called()

    def test_identity_route_enqueues_with_its_own_source(self):
        queued = {"run_id": "run-identity", "status": "queued"}
        with patch('app.cross.services.sync_control.enqueue_sync_run', new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(start_identity_admin_ingestion(self.request, 'operator@example.com'))
        self.assertEqual(result, queued)
        self.assertEqual(enqueue.await_args.kwargs["source_system"], "identity_administration")
        self.assertEqual(enqueue.await_args.kwargs["source_file"], "identity-administration-scim")
        self.coordinator.wake.assert_called_once()

    def test_access_route_enqueues_with_its_own_source(self):
        queued = {"run_id": "run-access", "status": "queued"}
        with patch('app.cross.services.sync_control.enqueue_sync_run', new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(start_access_ingestion(self.request, 'operator@example.com'))
        self.assertEqual(result, queued)
        self.assertEqual(enqueue.await_args.kwargs["source_system"], "access")
        self.assertEqual(enqueue.await_args.kwargs["source_file"], "access-api")
        self.assertEqual(enqueue.await_args.kwargs["options"], {})
        self.coordinator.wake.assert_called_once()

    def test_netskope_route_enqueues_only_configured_tasks(self):
        queued = [{"run_id": "run-inventory", "status": "queued", "source_system": "netskope", "task_key": "netskope_inventory"}]
        with patch.dict(os.environ, {}, clear=True), \
             patch('app.netskope.sse.api.routes.ingestion.enqueue_sync_runs', new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(start_netskope_ingestion(self.request, 'operator@example.com'))
        self.assertEqual(result["run_id"], "run-inventory")
        self.assertEqual([run["task_key"] for run in result["runs"]], ["netskope_inventory"])
        jobs = enqueue.await_args.args[1]
        self.assertEqual([(job["source_system"], job["task_key"], job["source_file"]) for job in jobs],
                         [("netskope", "netskope_inventory", "netskope-api")])
        self.coordinator.wake.assert_called_once()

    def test_netskope_route_enqueues_the_three_independent_tasks_when_configured(self):
        queued = [
            {"run_id": "run-inventory", "status": "queued", "source_system": "netskope", "task_key": "netskope_inventory"},
            {"run_id": "a", "status": "queued", "source_system": "netskope", "task_key": "netskope_alerts"},
            {"run_id": "b", "status": "queued", "source_system": "netskope", "task_key": "netskope_dlp"},
        ]
        env = {"NETSKOPE_ALERT_PATH": "/api/v2/events/dataexport/alerts", "NETSKOPE_DLP_INCIDENTS_PATH": DLP_INCIDENT_PATH}
        with patch.dict(os.environ, env, clear=True), \
             patch('app.netskope.sse.api.routes.ingestion.enqueue_sync_runs', new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(start_netskope_ingestion(self.request, 'operator@example.com'))
        self.assertEqual(result["run_id"], "run-inventory")
        # The response lists every task so a caller cannot mistake the
        # inventory run for the whole refresh.
        self.assertEqual([run["task_key"] for run in result["runs"]], ["netskope_inventory", "netskope_alerts", "netskope_dlp"])
        jobs = enqueue.await_args.args[1]
        self.assertEqual([job["task_key"] for job in jobs], ["netskope_inventory", "netskope_alerts", "netskope_dlp"])
        self.assertEqual({job["source_system"] for job in jobs}, {"netskope"})

    def test_pam_route_enqueues_validated_options(self):
        queued = {"run_id": "run-pam", "status": "queued"}
        payload = IngestionStart(page_size=50, member_delay_seconds=1, reconcile_complete=True)
        with patch('app.cross.services.sync_control.enqueue_sync_run', new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(start_ingestion(self.request, payload, 'operator@example.com'))
        self.assertEqual(result, queued)
        self.assertEqual(enqueue.await_args.kwargs["source_system"], "cyberark")
        self.assertEqual(
            enqueue.await_args.kwargs["options"],
            {"max_safes": 0, "page_size": 50, "member_delay_seconds": 1.0, "member_concurrency": 4, "reconcile_complete": True},
        )

    def test_pam_connectors_route_enqueues_isolated_catalog_refresh(self):
        queued = {"run_id": "run-psm", "status": "queued"}
        with patch('app.cross.services.sync_control.enqueue_sync_run', new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(start_pam_connectors_ingestion(self.request, 'operator@example.com'))
        self.assertEqual(result, queued)
        self.assertEqual(enqueue.await_args.kwargs["source_system"], "cyberark")
        self.assertEqual(enqueue.await_args.kwargs["source_file"], "cyberark-psm-api")
        self.assertEqual(enqueue.await_args.kwargs["options"], {"psm_only": True, "page_size": 100})
        self.coordinator.wake.assert_called_once()

    def test_manual_safes_task_does_not_enable_retirement_without_preview_confirmation(self):
        from app.cross.api.routes.ingestion import run_sync_task

        queued = [{"run_id": "manual-safes", "status": "queued", "source_system": "cyberark", "task_key": "pam_safes"}]
        with patch("app.cross.api.routes.ingestion.enqueue_sync_runs", new=AsyncMock(return_value=queued)) as enqueue:
            result = asyncio.run(run_sync_task("pam_safes", self.request, "operator@example.com"))
        self.assertEqual(result["run_id"], "manual-safes")
        job = enqueue.await_args.args[1][0]
        self.assertEqual(job["task_key"], "pam_safes")
        self.assertFalse(job["options"]["reconcile_complete"])

    def test_complete_sync_enqueues_full_sources_and_isolated_psm_refresh(self):
        payload = IngestionStart(page_size=50, member_delay_seconds=1, reconcile_complete=True)
        queued = [
            {"run_id": "run-pam", "status": "queued", "source_system": "cyberark", "task_key": "cyberark"},
            {"run_id": "run-psm", "status": "queued", "source_system": "cyberark", "task_key": "cyberark"},
            {"run_id": "run-identity", "status": "queued", "source_system": "identity_administration", "task_key": "identity_administration"},
            {"run_id": "run-sia", "status": "queued", "source_system": "sia", "task_key": "sia"},
            {"run_id": "run-access", "status": "queued", "source_system": "access", "task_key": "access"},
        ]
        optional_jobs = [
            ("identity_administration", "identity-administration-scim", {}, "identity_administration"),
            ("sia", "sia-api", {}, "sia"),
            ("access", "access-api", {}, "access"),
        ]
        with patch('app.cross.api.routes.ingestion.enqueue_sync_runs', new=AsyncMock(return_value=queued)) as enqueue, \
             patch('app.cross.api.routes.ingestion.configured_optional_source_jobs', return_value=optional_jobs):
            result = asyncio.run(start_all_ingestion(self.request, payload, 'operator@example.com'))
        self.assertEqual(result["runs"], queued)
        jobs = enqueue.await_args.args[1]
        self.assertEqual([job["source_system"] for job in jobs], ["cyberark", "cyberark", "identity_administration", "sia", "access"])
        self.assertEqual(jobs[0]["options"]["reconcile_complete"], True)
        self.assertEqual([job["task_key"] for job in jobs[:2]], ["pam_safes", "pam_psm"])
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
            {"run_id": "run-pam", "status": "queued", "source_system": "cyberark", "task_key": "cyberark"},
            {"run_id": "run-psm", "status": "queued", "source_system": "cyberark", "task_key": "cyberark"},
        ]
        with patch('app.cross.api.routes.ingestion.enqueue_sync_runs', new=AsyncMock(return_value=queued)) as enqueue, \
             patch('app.cross.api.routes.ingestion.configured_optional_source_jobs', return_value=[]):
            result = asyncio.run(start_all_ingestion(self.request, payload, 'operator@example.com'))
        self.assertEqual(result["runs"], queued)
        jobs = enqueue.await_args.args[1]
        self.assertEqual([job["source_system"] for job in jobs], ["cyberark", "cyberark"])
        self.assertEqual(jobs[1]["options"], {"psm_only": True, "page_size": 50})
        self.coordinator.wake.assert_called_once()

    def test_cyberark_scoped_sync_excludes_netskope_but_all_scope_keeps_it(self):
        payload = IngestionStart(reconcile_complete=True)
        optional_jobs = [
            ("identity_administration", "identity-administration-scim", {}, "identity_administration"),
            ("netskope", "netskope-api", {}, "netskope_inventory"),
        ]
        with patch('app.cross.api.routes.ingestion.enqueue_sync_runs', new=AsyncMock(return_value=[])) as enqueue, \
             patch('app.cross.api.routes.ingestion.configured_optional_source_jobs', return_value=optional_jobs):
            asyncio.run(start_all_ingestion(self.request, payload, 'operator@example.com', scope='cyberark'))
            scoped_sources = [job['source_system'] for job in enqueue.await_args.args[1]]
            asyncio.run(start_all_ingestion(self.request, payload, 'operator@example.com', scope='all'))
            all_sources = [job['source_system'] for job in enqueue.await_args.args[1]]
        self.assertEqual(scoped_sources, ['cyberark', 'cyberark', 'identity_administration'])
        self.assertEqual(all_sources, ['cyberark', 'cyberark', 'identity_administration', 'netskope'])


if __name__ == '__main__':
    unittest.main()
