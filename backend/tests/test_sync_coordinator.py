"""Regression coverage for the sync coordinator's dispatch-loop wake gap.

Without _on_source_task_done re-waking the dispatcher, a run enqueued for a
source while another run of that same source was still executing would sit
in the queue until the dispatcher's 30s poll timeout, since the immediate
wake() call from the enqueue endpoint is a no-op while a task for that
source_system is already active.
"""
import asyncio
import unittest

from app.sync_coordinator import SyncCoordinator


class SyncCoordinatorDoneCallbackTests(unittest.IsolatedAsyncioTestCase):
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


if __name__ == "__main__":
    unittest.main()
