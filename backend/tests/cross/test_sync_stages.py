import asyncio
import unittest

from app.cross.services.sync_stages import StageRecorder, degraded_stage_errors


class StageRecorderTests(unittest.TestCase):
    def test_optional_failure_is_recorded_and_degrades_without_raising(self):
        async def boom():
            raise ValueError("secret detail")
        recorder = StageRecorder()
        self.assertIsNone(asyncio.run(recorder.run("extra", boom, required=False)))
        self.assertTrue(recorder.degraded)
        self.assertTrue(recorder.failed("extra"))
        self.assertEqual(recorder.outcomes[0].error_kind, "ValueError")
        self.assertNotIn("secret", repr(recorder.outcomes))

    def test_required_failure_propagates_and_is_not_degraded(self):
        async def boom():
            raise ValueError("x")
        recorder = StageRecorder()
        with self.assertRaises(ValueError):
            asyncio.run(recorder.run("core", boom))
        self.assertFalse(recorder.degraded)
        self.assertEqual(recorder.outcomes[0].status, "failed")

    def test_success_counts_items_and_skip_is_not_degraded(self):
        async def ok():
            return [1, 2, 3]
        recorder = StageRecorder()
        self.assertEqual(asyncio.run(recorder.run("rows", ok, count=len)), [1, 2, 3])
        recorder.skip("opt", "sin configurar")
        self.assertEqual(recorder.outcomes[0].item_count, 3)
        self.assertEqual(recorder.outcomes[1].status, "skipped")
        self.assertFalse(recorder.degraded)

    def test_run_errors_list_only_failed_optional_stages(self):
        rows = [
            {"source_system": "s", "stage": "a", "required": False, "status": "failed", "error_kind": "E"},
            {"source_system": "s", "stage": "b", "required": False, "status": "skipped", "error_kind": None},
            {"source_system": "s", "stage": "c", "required": True, "status": "completed", "error_kind": None},
        ]
        errors = degraded_stage_errors(rows)
        self.assertEqual([item["stage"] for item in errors], ["a"])
        self.assertNotIn("detail", errors[0])
