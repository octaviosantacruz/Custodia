from uuid import uuid4

from app.cross.repositories.sync_run_stages import latest_stage_freshness, list_stage_history, save_sync_stages
from app.cross.services.sync_stages import StageOutcome
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class StageFreshnessPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.run_ids = []
        self.addAsyncCleanup(self.cleanup)

    async def cleanup(self):
        async with self.pool.connection() as conn:
            for run_id in self.run_ids:
                await conn.execute("DELETE FROM cyberark_ingestion_runs WHERE run_id = %s", (run_id,))
            await conn.commit()

    async def finished_run(self, offset_minutes, outcomes):
        run_id = uuid4()
        self.run_ids.append(run_id)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO cyberark_ingestion_runs(run_id, source_system, source_file, status, completed_at)
                   VALUES (%s, 'access', 'freshness-test', 'completed', now() - make_interval(mins => %s))""",
                (run_id, offset_minutes),
            )
            await conn.commit()
        await save_sync_stages(self.pool, run_id, outcomes)

    async def test_reports_last_success_separately_from_last_attempt(self):
        await self.finished_run(60, [StageOutcome("extra", False, "completed", 5, 3)])
        await self.finished_run(5, [
            StageOutcome("extra", False, "failed", 5, error_kind="RuntimeError"),
            StageOutcome("opt", False, "skipped", 0, detail="sin configurar"),
        ])
        rows = {row["stage"]: row for row in await latest_stage_freshness(self.pool, "access")}
        self.assertNotIn("opt", rows)
        self.assertEqual(rows["extra"]["last_status"], "failed")
        self.assertLess(rows["extra"]["last_success_at"], rows["extra"]["last_attempt_at"])

    async def test_history_lists_latest_runs_newest_first_without_skipped_or_stageless_runs(self):
        await self.finished_run(300, [StageOutcome("extra", False, "completed", 1, 10)])
        await self.finished_run(200, [StageOutcome("extra", False, "completed", 2, 20)])
        await self.finished_run(100, [
            StageOutcome("extra", False, "failed", 3, error_kind="RuntimeError"),
            StageOutcome("opt", False, "skipped", 0, detail="sin configurar"),
        ])
        await self.finished_run(50, [])
        rows = await list_stage_history(self.pool, "access", 2)
        self.assertEqual([(row["stage"], row["status"], row["item_count"]) for row in rows],
                         [("extra", "failed", None), ("extra", "completed", 20)])
        self.assertEqual({row["duration_ms"] for row in rows}, {3, 2})
        self.assertGreater(rows[0]["completed_at"], rows[1]["completed_at"])


class SourceRunHistoryPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.run_ids = []
        self.addAsyncCleanup(self.cleanup)

    async def cleanup(self):
        async with self.pool.connection() as conn:
            for run_id in self.run_ids:
                await conn.execute("DELETE FROM cyberark_ingestion_runs WHERE run_id = %s", (run_id,))
            await conn.commit()

    async def run_row(self, status, minutes_ago):
        run_id = uuid4()
        self.run_ids.append(run_id)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO cyberark_ingestion_runs(run_id, source_system, source_file, status, completed_at)
                   VALUES (%s, 'access', 'history-test', %s,
                           CASE WHEN %s IN ('completed', 'partial', 'failed') THEN now() - make_interval(mins => %s) END)""",
                (run_id, status, status, minutes_ago),
            )
            await conn.commit()

    async def test_counts_failures_since_the_last_success_and_treats_partial_as_success(self):
        from app.cross.repositories.ingestion import source_run_history
        await self.run_row("failed", 90)
        await self.run_row("partial", 60)
        await self.run_row("failed", 30)
        await self.run_row("failed", 10)
        history = (await source_run_history(self.pool))["access"]
        self.assertEqual(history.consecutive_failures, 2)
        self.assertIsNotNone(history.last_success_at)
        self.assertGreater(history.last_failure_at, history.last_success_at)
        self.assertFalse(history.active)
        await self.run_row("queued", 0)
        self.assertTrue((await source_run_history(self.pool))["access"].active)


class TaskIdentityPostgresTests(PostgresIntegrationTestCase):
    """SYNC-TASK-001: tasks of one source keep independent run history."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.run_ids = []
        self.addAsyncCleanup(self.cleanup)

    async def cleanup(self):
        async with self.pool.connection() as conn:
            for run_id in self.run_ids:
                await conn.execute("DELETE FROM cyberark_ingestion_runs WHERE run_id = %s", (run_id,))
            await conn.commit()

    async def run_row(self, task_key, status, minutes_ago):
        run_id = uuid4()
        self.run_ids.append(run_id)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO cyberark_ingestion_runs(run_id, source_system, source_file, task_key, status, completed_at)
                   VALUES (%s, 'netskope', %s, %s, %s, now() - make_interval(mins => %s))""",
                (run_id, f"{task_key}-test", task_key, status, minutes_ago),
            )
            await conn.commit()

    async def test_a_failing_task_does_not_change_its_sibling_history(self):
        from app.cross.repositories.ingestion import source_run_history
        await self.run_row("netskope_inventory", "completed", 30)
        await self.run_row("netskope_dlp", "completed", 90)
        await self.run_row("netskope_dlp", "failed", 20)
        await self.run_row("netskope_dlp", "failed", 10)
        history = await source_run_history(self.pool)
        self.assertEqual(history["netskope_inventory"].consecutive_failures, 0)
        self.assertEqual(history["netskope_dlp"].consecutive_failures, 2)

    async def test_a_run_inserted_without_a_task_takes_its_source(self):
        run_id = uuid4()
        self.run_ids.append(run_id)
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                """INSERT INTO cyberark_ingestion_runs(run_id, source_system, source_file, status)
                   VALUES (%s, 'sia', 'task-default-test', 'queued') RETURNING task_key""",
                (run_id,),
            )
            self.assertEqual((await cursor.fetchone())["task_key"], "sia")
            await conn.commit()

    async def test_pam_runs_resolve_to_their_own_task_by_default(self):
        rows = {}
        async with self.pool.connection() as conn:
            for name, source_file, options in (
                ("safes", "cyberark-api", "{}"),
                ("psm_file", "cyberark-psm-api", "{}"),
                ("psm_option", "cyberark-api", '{"psm_only": true}'),
            ):
                run_id = uuid4()
                self.run_ids.append(run_id)
                cursor = await conn.execute(
                    """INSERT INTO cyberark_ingestion_runs(run_id, source_system, source_file, status, run_options)
                       VALUES (%s, 'cyberark', %s, 'queued', %s::jsonb) RETURNING task_key""",
                    (run_id, source_file, options),
                )
                rows[name] = (await cursor.fetchone())["task_key"]
            await conn.commit()
        self.assertEqual(rows, {"safes": "pam_safes", "psm_file": "pam_psm", "psm_option": "pam_psm"})
