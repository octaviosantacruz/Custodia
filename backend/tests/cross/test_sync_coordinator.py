"""Regression coverage for the sync coordinator's dispatch-loop wake gap.

Without _on_source_task_done re-waking the dispatcher, a run enqueued for a
source while another run of that same source was still executing would sit
in the queue until the dispatcher's 30s poll timeout, since the immediate
wake() call from the enqueue endpoint is a no-op while a task for that
source_system is already active.
"""
import asyncio
import unittest
from contextlib import asynccontextmanager
from dataclasses import replace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.sync_coordinator import SyncCoordinator


class SyncCoordinatorDoneCallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_source_budget_leaves_capacity_for_interactive_database_work(self):
        coordinator = SyncCoordinator(pool=object(), max_concurrent_sources=2)
        active = 0
        peak = 0
        release = asyncio.Event()

        async def blocked_run(_source_system: str) -> None:
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await release.wait()
            active -= 1

        with patch.object(coordinator, "_run_locked_source", new=blocked_run):
            tasks = [asyncio.create_task(coordinator._run_source(source)) for source in ("cyberark", "sia", "netskope")]
            await asyncio.sleep(0)
            self.assertEqual(peak, 2)
            release.set()
            await asyncio.gather(*tasks)

    async def test_finishing_a_source_task_wakes_the_dispatcher_immediately(self):
        coordinator = SyncCoordinator(pool=object())
        coordinator._wake_event.clear()
        self.assertFalse(coordinator._wake_event.is_set())

        async def noop() -> None:
            return None

        task = asyncio.create_task(noop(), name="sync-source-sia")
        coordinator._source_tasks.add(task)
        task.add_done_callback(coordinator._on_source_task_done)

        await task
        await asyncio.sleep(0)  # let the done-callback (call_soon) run

        self.assertTrue(coordinator._wake_event.is_set())
        self.assertNotIn(task, coordinator._source_tasks)

    async def test_a_failed_source_task_still_wakes_the_dispatcher(self):
        """A task that raised must not leave the dispatcher waiting either --
        the next queued run for a different source (or a retry of this one)
        still deserves a prompt dispatch, not the 30s fallback."""
        coordinator = SyncCoordinator(pool=object())
        coordinator._wake_event.clear()

        async def boom() -> None:
            raise RuntimeError("simulated source failure")

        task = asyncio.create_task(boom(), name="sync-source-access")
        coordinator._source_tasks.add(task)
        task.add_done_callback(coordinator._on_source_task_done)

        with self.assertRaises(RuntimeError):
            await task
        await asyncio.sleep(0)

        self.assertTrue(coordinator._wake_event.is_set())
        self.assertNotIn(task, coordinator._source_tasks)


class SyncCoordinatorStageStatusTests(unittest.IsolatedAsyncioTestCase):
    async def _finish_status(self, stage_rows, result=None, task_key=None):
        coordinator = SyncCoordinator(pool=object())
        spec = replace(
            __import__("app.sources", fromlist=["SOURCES_BY_SYSTEM"]).SOURCES_BY_SYSTEM["identity_administration"],
            synchronizer=AsyncMock(return_value=result or {"objects": 1}),
        )

        @asynccontextmanager
        async def acquired(*_args):
            yield True

        finish = AsyncMock()
        run = {"run_id": uuid4(), "task_key": task_key}
        with patch("app.sync_coordinator.SOURCES_BY_SYSTEM", {"identity_administration": spec}), \
             patch("app.sync_coordinator.source_sync_lock", acquired), \
             patch("app.sync_coordinator.claim_next_sync_run", AsyncMock(return_value=run)), \
             patch("app.sync_coordinator.update_ingestion_progress", AsyncMock()), \
             patch("app.sync_coordinator.list_sync_stages", AsyncMock(return_value=stage_rows)), \
             patch("app.sync_coordinator.finish_ingestion_run", finish):
            await coordinator._run_locked_source("identity_administration")
        return finish.await_args.args[2], finish.await_args.args[5]

    async def test_a_source_that_exceeds_its_timeout_fails_with_a_sanitized_kind(self):
        from app.source_contract import SyncPolicy

        async def slow(*_args):
            await asyncio.sleep(5)

        coordinator = SyncCoordinator(pool=object())
        spec = replace(
            __import__("app.sources", fromlist=["SOURCES_BY_SYSTEM"]).SOURCES_BY_SYSTEM["identity_administration"],
            synchronizer=slow, policy=SyncPolicy(timeout_seconds=0.01),
        )

        @asynccontextmanager
        async def acquired(*_args):
            yield True

        finish = AsyncMock()
        with patch("app.sync_coordinator.SOURCES_BY_SYSTEM", {"identity_administration": spec}), \
             patch("app.sync_coordinator.source_sync_lock", acquired), \
             patch("app.sync_coordinator.claim_next_sync_run", AsyncMock(return_value={"run_id": uuid4()})), \
             patch("app.sync_coordinator.update_ingestion_progress", AsyncMock()), \
             patch("app.sync_coordinator.finish_ingestion_run", finish):
            await coordinator._run_locked_source("identity_administration")
        self.assertEqual(finish.await_args.args[2], "failed")
        self.assertEqual(finish.await_args.args[5][0]["error_kind"], "TimeoutError")

    async def test_failed_optional_stage_finishes_partial_with_warning(self):
        status, errors = await self._finish_status([
            {"source_system": "identity_administration", "stage": "members_directory",
             "required": False, "status": "failed", "error_kind": "RuntimeError"},
        ])
        self.assertEqual(status, "partial")
        self.assertEqual(errors[0]["stage"], "members_directory")

    async def test_a_run_that_left_work_for_the_next_cycle_finishes_partial(self):
        # SYNC-TASK-001: a bounded DLP capture that has not caught up must not
        # be recorded as a complete capture.
        status, errors = await self._finish_status(
            [], result={"objects": 3, "run_partial": 1}, task_key="netskope_dlp",
        )
        self.assertEqual(status, "partial")
        self.assertEqual((errors[0]["stage"], errors[0]["error_kind"]), ("netskope_dlp", "PartialRun"))

    async def test_clean_stages_finish_completed(self):
        status, errors = await self._finish_status([
            {"source_system": "identity_administration", "stage": "users",
             "required": True, "status": "completed", "error_kind": None},
        ])
        self.assertEqual((status, errors), ("completed", []))


if __name__ == "__main__":
    unittest.main()


class FailureMessageTests(unittest.TestCase):
    """A run that fails because the backend that took it has no credentials must say so, without leaking text."""

    def test_a_missing_configuration_names_the_worker_and_the_likely_cause(self):
        from app.cyberark.pam.services.cyberark_settings import CyberArkError
        from app.netskope.sse.integrations.netskope import NetskopeNotConfigured
        from app.sync_coordinator import GENERIC_FAILURE, failure_message

        class SiaNotConfigured(Exception):
            pass

        for error in (SiaNotConfigured("x"), NetskopeNotConfigured("Faltan variables del contrato Netskope: URL"), CyberArkError("CA_CLIENT_SECRET o CA_SECRET_FILE es obligatorio")):
            message = failure_message(error, "sync-coordinator-1234abcd-0000-0000-0000-cee04d3f")
            self.assertIn("cee04d3f", message, type(error).__name__)
            self.assertIn("más de un backend", message)
            self.assertNotEqual(message, GENERIC_FAILURE)
            self.assertNotIn("URL", message, "the exception text is never copied")

    def test_any_other_failure_keeps_the_generic_sanitized_text(self):
        from app.cyberark.pam.services.cyberark_settings import CyberArkError
        from app.sync_coordinator import GENERIC_FAILURE, failure_message

        for error in (RuntimeError("password=hunter2"), CyberArkError("HTTP 401 from the server"), TimeoutError()):
            self.assertEqual(failure_message(error, "w-1"), GENERIC_FAILURE)
