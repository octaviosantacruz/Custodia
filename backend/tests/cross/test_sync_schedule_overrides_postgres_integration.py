"""Postgres proof for durable schedule overrides and transactional audit."""

from unittest.mock import AsyncMock, patch

from app.cross.repositories.ingestion import set_sync_schedule_override
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class SyncScheduleOverridePostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.sync_schedule_overrides WHERE task_key = 'test_schedule_task'")
            await conn.execute("DELETE FROM public.access_audit_log WHERE entity_type = 'sync_schedule' AND entity_id = 'test_schedule_task'")

    async def asyncTearDown(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.sync_schedule_overrides WHERE task_key = 'test_schedule_task'")
            await conn.execute("DELETE FROM public.access_audit_log WHERE entity_type = 'sync_schedule' AND entity_id = 'test_schedule_task'")

    async def test_override_and_audit_persist_together_and_removal_is_audited(self):
        await set_sync_schedule_override(
            self.pool, task_key="test_schedule_task", interval_minutes=30, actor_id="test-admin",
        )
        async with self.pool.connection() as conn:
            saved = await (await conn.execute(
                "SELECT interval_minutes, updated_by FROM public.sync_schedule_overrides WHERE task_key = %s",
                ("test_schedule_task",),
            )).fetchone()
            audit = await (await conn.execute(
                "SELECT actor_id, before_data, after_data FROM public.access_audit_log WHERE entity_type = 'sync_schedule' AND entity_id = %s",
                ("test_schedule_task",),
            )).fetchone()
        self.assertEqual(float(saved["interval_minutes"]), 30)
        self.assertEqual(saved["updated_by"], "test-admin")
        self.assertEqual(audit["actor_id"], "test-admin")
        self.assertIsNone(audit["before_data"])
        self.assertEqual(audit["after_data"]["interval_minutes"], 30)

        await set_sync_schedule_override(
            self.pool, task_key="test_schedule_task", interval_minutes=None, actor_id="test-admin",
        )
        async with self.pool.connection() as conn:
            remaining = await (await conn.execute(
                "SELECT 1 FROM public.sync_schedule_overrides WHERE task_key = %s", ("test_schedule_task",),
            )).fetchone()
            audit_count = await (await conn.execute(
                "SELECT count(*) AS count FROM public.access_audit_log WHERE entity_type = 'sync_schedule' AND entity_id = %s",
                ("test_schedule_task",),
            )).fetchone()
        self.assertIsNone(remaining)
        self.assertEqual(audit_count["count"], 2)

    async def test_audit_failure_rolls_back_the_override(self):
        with patch("app.cross.repositories.ingestion.record_audit", new=AsyncMock(side_effect=RuntimeError("audit unavailable"))):
            with self.assertRaisesRegex(RuntimeError, "audit unavailable"):
                await set_sync_schedule_override(
                    self.pool, task_key="test_schedule_task", interval_minutes=15, actor_id="test-admin",
                )
        async with self.pool.connection() as conn:
            persisted = await (await conn.execute(
                "SELECT 1 FROM public.sync_schedule_overrides WHERE task_key = %s", ("test_schedule_task",),
            )).fetchone()
        self.assertIsNone(persisted)
