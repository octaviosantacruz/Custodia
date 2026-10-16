"""Regression coverage for the single source registry (app/sources.py).

The registry replaced hardcoded source lists in the sync coordinator, the
lifecycle scheduler, the ingestion routes and the integration status
endpoint. These tests pin the invariants those consumers rely on, so adding a
tool is one SourceSpec instead of edits scattered across every consumer.
"""
import os
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

from app import sync_coordinator
from app.cross.integrations.status import get_integration_status
from app.sources import (
    OPTIONAL_SOURCES,
    PAM_SOURCE,
    SOURCES,
    SourceSpec,
    SOURCES_BY_SYSTEM,
    configured_optional_source_jobs,
    source_tasks,
)


@asynccontextmanager
async def acquired_lock(*_args, **_kwargs):
    yield True


class SourceRegistryTests(unittest.TestCase):
    def test_sources_have_unique_identifiers(self):
        systems = [spec.source_system for spec in SOURCES]
        self.assertEqual(len(systems), len(set(systems)))
        self.assertEqual(set(SOURCES_BY_SYSTEM), set(systems))

        from fastapi import APIRouter, FastAPI
        from fastapi.testclient import TestClient
        from app.source_contract import ToolRegistration
        from app.sources import registered_routers

        router = APIRouter()

        @router.get("/registered-tool")
        def registered_tool():
            return {"source_system": "test_source"}

        with patch("app.sources.TOOLS", (ToolRegistration(routers=((99, router),)),)):
            app = FastAPI()
            for tool_router in registered_routers():
                app.include_router(tool_router)
        with TestClient(app) as client:
            self.assertEqual(client.get("/registered-tool").json(), {"source_system": "test_source"})

    def test_sync_coordinator_known_sources_matches_the_registry(self):
        self.assertEqual(sync_coordinator.KNOWN_SOURCES, frozenset(SOURCES_BY_SYSTEM))

    def test_every_non_pam_source_declares_a_synchronizer(self):
        for spec in SOURCES:
            if spec.source_system == PAM_SOURCE:
                self.assertIsNone(spec.synchronizer)
                self.assertIsNotNone(spec.dispatcher)
            else:
                self.assertTrue(spec.synchronizer or spec.dispatcher, spec.source_system)

    def test_optional_sources_declare_a_complete_contract(self):
        for spec in OPTIONAL_SOURCES:
            self.assertIsNotNone(spec.settings_type, spec.source_system)
            self.assertTrue(spec.source_file, spec.source_system)
            self.assertTrue(spec.not_configured, spec.source_system)
            self.assertTrue(spec.status_required_env, spec.source_system)
            self.assertTrue(spec.status_secret_env, spec.source_system)

    def test_integration_status_covers_every_optional_source(self):
        with patch.dict(os.environ, {}, clear=True):
            status = get_integration_status()
        self.assertEqual(set(status), {spec.source_system for spec in OPTIONAL_SOURCES})

    def test_configured_optional_jobs_use_the_registered_source_files(self):
        with patch("app.cyberark.identity_administration.source.IdentityAdminSettings.from_environment"), \
             patch("app.cyberark.sia.source.SiaSettings.from_environment"), \
             patch("app.cyberark.access.source.AccessSettings.from_environment"), \
             patch("app.netskope.sse.source.NetskopeSettings.from_environment"):
            jobs = configured_optional_source_jobs()
        self.assertEqual(
            jobs,
            [
                (spec.source_system, task.source_file, {}, task.task_key)
                for spec in OPTIONAL_SOURCES
                for task in source_tasks(spec)
                if task.is_configured is None
            ],
        )


class SyncCoordinatorRegistryDispatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_registered_synchronizer_runs_and_reports_its_counts(self):
        calls = []

        async def fake_sync(pool, run_id, progress):
            calls.append(run_id)
            return {"user": 3}

        fake_spec = SourceSpec(source_system="fake_source", synchronizer=fake_sync)
        coordinator = sync_coordinator.SyncCoordinator(pool=object())
        with patch.object(sync_coordinator, "SOURCES_BY_SYSTEM", {"fake_source": fake_spec}), \
             patch.object(sync_coordinator, "source_sync_lock", acquired_lock), \
             patch.object(sync_coordinator, "claim_next_sync_run", new=AsyncMock(return_value={
                 "run_id": "run-1", "run_options": {}, "triggered_by": "tester",
             })), \
             patch.object(sync_coordinator, "update_ingestion_progress", new=AsyncMock()), \
             patch.object(sync_coordinator, "list_sync_stages", new=AsyncMock(return_value=[])), \
             patch.object(sync_coordinator, "finish_ingestion_run", new=AsyncMock()) as finish:
            await coordinator._run_locked_source("fake_source")

        self.assertEqual(calls, ["run-1"])
        self.assertEqual(finish.await_args.args[2], "completed")
        self.assertEqual(finish.await_args.kwargs["source_counts"], {"user": 3})

        # PAM preserves its own completion; the isolated PSM job still returns
        # counts through the coordinator. Neither changes the claimed lock.
        for psm_only in (False, True):
            with self.subTest(psm_only=psm_only):
                with patch.object(sync_coordinator, "source_sync_lock", acquired_lock), \
                     patch.object(sync_coordinator, "claim_next_sync_run", new=AsyncMock(return_value={
                         "run_id": "pam-run", "run_options": {"psm_only": psm_only, "page_size": 25},
                         "triggered_by": "tester",
                     })), \
                     patch.object(sync_coordinator, "update_ingestion_progress", new=AsyncMock()), \
                     patch.object(sync_coordinator, "list_sync_stages", new=AsyncMock(return_value=[])), \
                     patch.object(sync_coordinator, "finish_ingestion_run", new=AsyncMock()) as finish_pam, \
                     patch("app.cyberark.pam.source.run_ingestion", new=AsyncMock()) as safes, \
                     patch("app.cyberark.pam.source.sync_pam_connectors_inventory", new=AsyncMock(return_value={"psm": 2})) as psm:
                    await coordinator._run_locked_source(PAM_SOURCE)
                if psm_only:
                    safes.assert_not_awaited()
                    psm.assert_awaited_once_with(coordinator.pool, "pam-run", page_size=25)
                    self.assertEqual(finish_pam.await_args.kwargs["source_counts"], {"psm": 2})
                else:
                    psm.assert_not_awaited()
                    safes.assert_awaited_once()
                    self.assertTrue(safes.await_args.kwargs["run_already_claimed"])
                    self.assertEqual(safes.await_args.kwargs["triggered_by"], "tester")
                    finish_pam.assert_not_awaited()

    async def test_unknown_source_is_recorded_as_failed(self):
        coordinator = sync_coordinator.SyncCoordinator(pool=object())
        with patch.object(sync_coordinator, "source_sync_lock", acquired_lock), \
             patch.object(sync_coordinator, "claim_next_sync_run", new=AsyncMock(return_value={
                 "run_id": "run-2", "run_options": {}, "triggered_by": "tester",
             })), \
             patch.object(sync_coordinator, "update_ingestion_progress", new=AsyncMock()), \
             patch.object(sync_coordinator, "list_sync_stages", new=AsyncMock(return_value=[])), \
             patch.object(sync_coordinator, "finish_ingestion_run", new=AsyncMock()) as finish:
            await coordinator._run_locked_source("not_registered")

        self.assertEqual(finish.await_args.args[2], "failed")


if __name__ == "__main__":
    unittest.main()
