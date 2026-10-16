"""COV-007 against real PostgreSQL: destinations whose work state has not moved for N days."""

from app.cross.repositories.connection_inventory import list_stale_destinations
from app.cross.services.connection_inventory_import import apply_import, edit_destinations
from app.db import fetch_all
from tests.support.pg_integration_base import PostgresIntegrationTestCase


def destination(number, ip):
    return {
        "source_row_number": number, "instance_name": f"srv-{number}", "environment": "DEV", "private_ip": ip, "port": 22,
        "ca_sia": None, "ca_dba": None, "zsp_implemented": None, "access_available": None, "description": "",
    }


class StaleDestinationsPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.pool.connection() as conn:
            for table in ("connection_coverage_snapshots", "connection_inventory", "connection_inventory_imports"):
                await conn.execute(f"DELETE FROM public.{table}")
            await conn.execute("DELETE FROM public.access_audit_log WHERE entity_type = 'connection_inventory_item'")
        await apply_import(self.pool, [destination(2, "10.0.0.1"), destination(3, "10.0.0.2"), destination(4, "10.0.0.3")], "uno.csv", "update", "operator-1")
        rows = await fetch_all(self.pool, "SELECT inventory_id, private_ip FROM public.connection_inventory")
        self.ids = {row["private_ip"]: row["inventory_id"] for row in rows}

    async def age(self, ip, days):
        """Move the first-seen date and every audited event of a destination ``days`` days into the past."""
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE public.connection_inventory SET created_at = now() - make_interval(days => %s) WHERE inventory_id = %s", (days, self.ids[ip]))
            await conn.execute(
                "UPDATE public.access_audit_log SET created_at = now() - make_interval(days => %s) WHERE entity_type = 'connection_inventory_item' AND entity_id = %s",
                (days, str(self.ids[ip])),
            )

    async def test_only_destinations_idle_for_the_threshold_are_listed_oldest_first(self):
        await self.age("10.0.0.1", 30)
        await self.age("10.0.0.2", 20)
        result = await list_stale_destinations(self.pool, 14)
        self.assertEqual([row["private_ip"] for row in result["rows"]], ["10.0.0.1", "10.0.0.2"])
        self.assertEqual((result["days"], result["total"]), (14, 2))
        self.assertGreaterEqual(result["rows"][0]["idle_days"], 30)
        self.assertEqual([row["private_ip"] for row in (await list_stale_destinations(self.pool, 25))["rows"]], ["10.0.0.1"])

    async def test_a_recent_work_state_change_resets_the_clock(self):
        await self.age("10.0.0.1", 30)
        await edit_destinations(self.pool, [self.ids["10.0.0.1"]], {"work_status": "in_progress"}, "operator-1")
        self.assertEqual((await list_stale_destinations(self.pool, 14))["rows"], [])

    async def test_an_old_work_state_change_counts_not_the_first_import(self):
        await self.age("10.0.0.1", 90)
        await edit_destinations(self.pool, [self.ids["10.0.0.1"]], {"work_status": "blocked"}, "operator-1")
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE public.access_audit_log SET created_at = now() - interval '20 days' WHERE entity_type = 'connection_inventory_item' AND entity_id = %s", (str(self.ids["10.0.0.1"]),))
        row = (await list_stale_destinations(self.pool, 14))["rows"][0]
        self.assertEqual((row["private_ip"], row["work_status"]), ("10.0.0.1", "blocked"))
        self.assertTrue(19 <= row["idle_days"] <= 20)
        self.assertIsNotNone(row["last_change"])

    async def test_finished_not_applicable_and_retired_destinations_never_figure(self):
        for ip in ("10.0.0.1", "10.0.0.2", "10.0.0.3"):
            await self.age(ip, 60)
        await edit_destinations(self.pool, [self.ids["10.0.0.1"]], {"work_status": "onboarded"}, "operator-1")
        await edit_destinations(self.pool, [self.ids["10.0.0.2"]], {"work_status": "not_applicable"}, "operator-1")
        await edit_destinations(self.pool, [self.ids["10.0.0.3"]], {"lifecycle_status": "retired"}, "operator-1")
        self.assertEqual((await list_stale_destinations(self.pool, 1))["rows"], [])

    async def test_the_limit_caps_rows_but_not_the_total(self):
        for ip in ("10.0.0.1", "10.0.0.2", "10.0.0.3"):
            await self.age(ip, 40)
        result = await list_stale_destinations(self.pool, 14, limit=2)
        self.assertEqual((len(result["rows"]), result["total"]), (2, 3))
