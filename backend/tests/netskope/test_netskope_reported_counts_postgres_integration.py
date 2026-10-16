"""NSK-REF-001: the user total Netskope reports is a reference beside DS Hub's own count."""

from datetime import datetime, timezone

from psycopg.errors import CheckViolation

from app.netskope.sse.repositories.netskope_mutations import record_reported_counts
from app.netskope.sse.repositories.netskope_queries import get_netskope_metrics
from tests.support.netskope_pg_fixtures import (
    insert_netskope_run, reset_netskope, reset_netskope_runs, seed_netskope_user,
)
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class NetskopeReportedCountsPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self._clean()
        self.addAsyncCleanup(self._clean)

    async def _clean(self):
        await reset_netskope(self.pool)
        await reset_netskope_runs(self.pool)

    async def test_the_reference_is_null_until_a_completed_run_reports_it(self):
        metrics = await get_netskope_metrics(self.pool)
        self.assertIsNone(metrics["users_reported_total"])
        self.assertIsNone(metrics["users_reported_at"])
        self.assertIsNone(metrics["ous_reported_total"])
        self.assertIsNone(metrics["users_repeated_rows"])

    async def test_only_the_newest_completed_run_counts_and_it_never_changes_the_users_listed(self):
        await seed_netskope_user(self.pool, "u1", "Ana", "ana@x.com")
        await seed_netskope_user(self.pool, "u2", "Luis", "luis@x.com")
        older = await insert_netskope_run(self.pool, "completed", hours=5)
        newer = await insert_netskope_run(self.pool, "completed", hours=1)
        partial = await insert_netskope_run(self.pool, "partial", hours=0.5)
        failed = await insert_netskope_run(self.pool, "failed", hours=0.2)
        moment = datetime(2026, 10, 6, 1, 29, 21, tzinfo=timezone.utc)
        await record_reported_counts(self.pool, older, 8800, None)
        await record_reported_counts(self.pool, newer, 8859, moment, {"active_accounts": 10209, "inactive_accounts": 1987, "total_groups": 718, "total_ous": 141, "repeated_user_rows": 4})
        await record_reported_counts(self.pool, partial, 1, None)
        await record_reported_counts(self.pool, failed, 2, None)
        metrics = await get_netskope_metrics(self.pool)
        self.assertEqual((metrics["users_reported_total"], metrics["users_reported_at"]), (8859, moment))
        self.assertEqual(
            (metrics["accounts_reported_active"], metrics["accounts_reported_inactive"], metrics["groups_reported_total"], metrics["ous_reported_total"]),
            (10209, 1987, 718, 141))
        self.assertEqual(metrics["users_repeated_rows"], 4)
        # DS Hub's own count is untouched by the reference.
        self.assertEqual(metrics["users_total"], 2)

    async def test_a_second_write_for_the_same_run_replaces_the_first_and_a_negative_total_is_rejected(self):
        run = await insert_netskope_run(self.pool, "completed", hours=1)
        await record_reported_counts(self.pool, run, 10, None)
        await record_reported_counts(self.pool, run, 12, None)
        self.assertEqual((await get_netskope_metrics(self.pool))["users_reported_total"], 12)
        with self.assertRaises(CheckViolation):
            await record_reported_counts(self.pool, run, -1, None)
