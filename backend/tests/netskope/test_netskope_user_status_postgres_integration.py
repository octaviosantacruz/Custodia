"""NSK-USR-001: the enabled/disabled split of users, and the filter that opens exactly those users."""

from app.netskope.sse.repositories.netskope_inventory import list_netskope_objects
from app.netskope.sse.repositories.netskope_queries import get_netskope_metrics
from tests.support.netskope_pg_fixtures import reset_netskope, reset_netskope_runs, seed_device, seed_netskope_user
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class NetskopeUserStatusPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self._clean()
        self.addAsyncCleanup(self._clean)

    async def _clean(self):
        await reset_netskope(self.pool)
        await reset_netskope_runs(self.pool)

    async def _listed(self, **kwargs):
        result = await list_netskope_objects(self.pool, "user", "", 50, 0, **kwargs)
        return {row["source_id"] for row in result["rows"]}, result["total"]

    async def _seed(self):
        await seed_netskope_user(self.pool, "on1", "On 1", "on1@x.com", extra={"account_status": "enabled", "accounts_active": 2, "accounts_inactive": 0})
        await seed_netskope_user(self.pool, "on2", "On 2", "on2@x.com", extra={"account_status": "enabled", "accounts_active": 1, "accounts_inactive": 1})
        await seed_netskope_user(self.pool, "off1", "Off 1", "off1@x.com", extra={"account_status": "disabled", "accounts_active": 0, "accounts_inactive": 1})
        await seed_netskope_user(self.pool, "old1", "Old 1", "old1@x.com")
        await seed_netskope_user(self.pool, "weird", "Weird", "w@x.com", extra={"account_status": "maybe"})
        await seed_netskope_user(self.pool, "retired-on", "Retired", "r@x.com", lifecycle_status="retired", extra={"account_status": "enabled"})

    async def test_the_metric_and_the_filter_count_exactly_the_same_users(self):
        await self._seed()
        metrics = await get_netskope_metrics(self.pool)
        self.assertEqual((metrics["users_total"], metrics["users_enabled"], metrics["users_disabled"]), (5, 2, 1))
        enabled, enabled_total = await self._listed(account_status="enabled")
        disabled, disabled_total = await self._listed(account_status="disabled")
        unknown, unknown_total = await self._listed(account_status="unknown")
        self.assertEqual((enabled, disabled), ({"on1", "on2"}, {"off1"}))
        self.assertEqual((enabled_total, disabled_total), (metrics["users_enabled"], metrics["users_disabled"]))
        # Rows whose accounts[] was never read, or hold a value Custodia does not know, stay visible as unknown.
        self.assertEqual(unknown, {"old1", "weird"})
        self.assertEqual(enabled_total + disabled_total + unknown_total, metrics["users_total"])
        # A retired user never counts, whatever its stored status.
        self.assertNotIn("retired-on", enabled)

    async def test_the_filter_only_applies_to_users_and_rejects_unknown_values(self):
        await seed_device(self.pool, "d1", {"last_event_timestamp": 1})
        with self.assertRaises(ValueError):
            await list_netskope_objects(self.pool, "device", "", 50, 0, account_status="enabled")
        with self.assertRaises(ValueError):
            await list_netskope_objects(self.pool, "user", "", 50, 0, account_status="deleted")
