from uuid import uuid4

from app.cyberark.pam.repositories.analytics import get_summary
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class SummarySourceIntegrationTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.pam_run_id = uuid4()
        self.netskope_run_id = uuid4()
        self.addAsyncCleanup(self._cleanup)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.cyberark_ingestion_runs
                   (run_id, source_system, source_file, status, started_at)
                   VALUES (%s, 'cyberark', 'test-pam', 'completed', now() - interval '1 hour'),
                          (%s, 'netskope', 'test-netskope', 'failed', now())""",
                (self.pam_run_id, self.netskope_run_id),
            )

    async def _cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute(
                "DELETE FROM public.cyberark_ingestion_runs WHERE run_id = ANY(%s)",
                ([self.pam_run_id, self.netskope_run_id],),
            )

    async def test_summary_uses_latest_pam_run_when_another_source_is_newer(self):
        summary = await get_summary(self.pool)

        self.assertEqual(summary["latest_run"]["run_id"], str(self.pam_run_id))
        self.assertEqual(summary["latest_run"]["source_system"], "cyberark")
