"""COV-005 against real PostgreSQL: "X of N" counts, the daily snapshot and the weekly series."""

import json
from datetime import date

from app.cross.repositories.connection_inventory import get_coverage_progress, list_coverage_series, save_coverage_snapshot
from app.cross.services.connection_inventory_import import apply_import, edit_destinations
from app.cross.services.sia_policy_capabilities import classify_policies
from app.db import fetch_all
from tests.support.pg_integration_base import PostgresIntegrationTestCase


def destination(number, ip, environment, sia, dba):
    return {
        "source_row_number": number, "instance_name": f"srv-{number}", "environment": environment, "private_ip": ip, "port": 22,
        "ca_sia": sia, "ca_dba": dba, "zsp_implemented": None, "access_available": None, "description": "",
    }


class CoverageProgressPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.pool.connection() as conn:
            for table in ("connection_coverage_snapshots", "sia_policy_capabilities", "connection_inventory", "connection_inventory_imports"):
                await conn.execute(f"DELETE FROM public.{table}")
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE source_system = 'sia' AND object_type = 'access_policy'")
            for source_id, name, ips in (("pol-platform", "Politica-DEV-OCI-Platform", ["10.0.0.1"]), ("pol-dba", "Politica-DEV-OCI-DBA", ["10.0.0.1", "10.0.0.2"])):
                await conn.execute(
                    "INSERT INTO public.cyberark_inventory_objects (source_system, object_type, source_id, display_name, attributes) VALUES ('sia', 'access_policy', %s, %s, %s::jsonb)",
                    (source_id, name, json.dumps({"status": "Enabled", "ip_rules": ips})),
                )

    async def seed(self):
        await apply_import(self.pool, [
            destination(2, "10.0.0.1", "DEV", True, True),   # Platform and DBA both observed and declared
            destination(3, "10.0.0.2", "DEV", True, True),   # DBA observed, Platform missing
            destination(4, "10.0.0.9", "PROD", None, None),  # nothing declared, nothing observed
        ], "uno.csv", "update", "operator-1")
        await classify_policies(self.pool, [{"policy_source_id": "pol-platform", "capability": "platform"}, {"policy_source_id": "pol-dba", "capability": "dba"}], "operator-1")

    async def test_counts_are_x_of_n_in_total_and_per_environment(self):
        await self.seed()
        progress = await get_coverage_progress(self.pool)
        self.assertEqual(progress["total"]["n"], 3)
        self.assertEqual((progress["total"]["platform"]["match"], progress["total"]["platform"]["missing"], progress["total"]["platform"]["unknown"]), (1, 1, 1))
        self.assertEqual((progress["total"]["dba"]["match"], progress["total"]["dba"]["unknown"]), (2, 1))
        by_environment = {item["environment"]: item for item in progress["by_environment"]}
        self.assertEqual((by_environment["DEV"]["n"], by_environment["PROD"]["n"]), (2, 1))
        self.assertEqual(sum(by_environment[name]["n"] for name in by_environment), progress["total"]["n"], "the parts add up to the denominator")
        for block in (progress["total"], *by_environment.values()):
            self.assertEqual(sum(block["platform"].values()), block["n"], "every destination has exactly one Platform reading")
            self.assertEqual(sum(block["work"].values()), block["n"])

    async def test_counts_per_responsible_add_up_and_blank_ones_are_grouped(self):
        await self.seed()
        rows = await fetch_all(self.pool, "SELECT inventory_id, private_ip FROM public.connection_inventory WHERE lifecycle_status = 'active'")
        ids = {row["private_ip"]: row["inventory_id"] for row in rows}
        await edit_destinations(self.pool, [ids["10.0.0.1"], ids["10.0.0.2"]], {"responsible": "Ana"}, "operator-1")
        await edit_destinations(self.pool, [ids["10.0.0.1"]], {"work_status": "onboarded"}, "operator-1")
        progress = await get_coverage_progress(self.pool)
        by_responsible = {item["responsible"]: item for item in progress["by_responsible"]}
        self.assertEqual((by_responsible["Ana"]["n"], by_responsible["Sin responsable"]["n"]), (2, 1))
        self.assertEqual((by_responsible["Ana"]["work"]["onboarded"], by_responsible["Ana"]["work"]["pending"]), (1, 1))
        self.assertEqual(sum(item["n"] for item in by_responsible.values()), progress["total"]["n"], "the parts add up to the denominator")
        for block in by_responsible.values():
            self.assertEqual(sum(block["work"].values()), block["n"])

    async def test_retired_destinations_are_outside_the_denominator(self):
        await self.seed()
        await apply_import(self.pool, [destination(2, "10.0.0.1", "DEV", True, True)], "dos.csv", "update", "operator-1")
        self.assertEqual((await get_coverage_progress(self.pool))["total"]["n"], 1)

    async def test_the_last_snapshot_of_a_day_replaces_the_earlier_one(self):
        await self.seed()
        # The import already took one; a later edit and a manual snapshot the same day replace it.
        rows = await fetch_all(self.pool, "SELECT inventory_id FROM public.connection_inventory WHERE lifecycle_status = 'active'")
        await edit_destinations(self.pool, [row["inventory_id"] for row in rows], {"work_status": "onboarded"}, "operator-1")
        await save_coverage_snapshot(self.pool, "manual")
        stored = await fetch_all(self.pool, "SELECT trigger, counts->'total'->'work'->>'onboarded' AS onboarded FROM public.connection_coverage_snapshots")
        self.assertEqual([(row["trigger"], row["onboarded"]) for row in stored], [("manual", "3")])

    async def test_the_series_keeps_the_last_snapshot_of_each_week_oldest_first(self):
        await self.seed()
        counts = {"total": {"n": 3, "platform": {}, "dba": {}, "work": {}}, "by_environment": [], "by_responsible": []}
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.connection_coverage_snapshots")
            for day in ("2026-09-28", "2026-09-30", "2026-10-06", "2026-10-07", "2026-10-08"):
                await conn.execute(
                    "INSERT INTO public.connection_coverage_snapshots (snapshot_date, trigger, counts) VALUES (%s, 'sync', %s::jsonb)",
                    (day, json.dumps({**counts, "total": {**counts["total"], "n": int(day[-2:])}})),
                )
        series = await list_coverage_series(self.pool)
        self.assertEqual([(point["snapshot_date"], point["n"]) for point in series], [(date(2026, 9, 30), 30), (date(2026, 10, 8), 8)])

    async def test_an_import_records_a_snapshot(self):
        await self.seed()
        stored = await fetch_all(self.pool, "SELECT trigger FROM public.connection_coverage_snapshots")
        self.assertEqual([row["trigger"] for row in stored], ["import"])
