"""COV-008 against real PostgreSQL: addresses PAM or SIA name that the destination inventory does not carry."""

import json
from uuid import uuid4

from app.cross.repositories.connection_inventory import list_uninventoried_addresses
from app.cross.services.connection_inventory_import import apply_import, edit_destinations
from tests.support.pg_integration_base import PostgresIntegrationTestCase

IN_INVENTORY, PAM_ONLY, SIA_ONLY, BOTH, RETIRED = "198.51.100.1", "198.51.100.2", "198.51.100.3", "198.51.100.4", "198.51.100.5"
MINE = {IN_INVENTORY, PAM_ONLY, SIA_ONLY, BOTH, RETIRED, "198.51.100.6", "198.51.100.7", "198.51.100.300", "198.51.100.0/24", "host.example"}


def destination(number, ip):
    return {
        "source_row_number": number, "instance_name": f"srv-{number}", "environment": "DEV", "private_ip": ip, "port": 22,
        "ca_sia": None, "ca_dba": None, "zsp_implemented": None, "access_available": None, "description": "",
    }


class UninventoriedAddressesPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.run_id = uuid4()
        self.safe_numbers: list[int] = []
        self.addAsyncCleanup(self._cleanup)
        async with self.pool.connection() as conn:
            for table in ("connection_coverage_snapshots", "connection_inventory", "connection_inventory_imports"):
                await conn.execute(f"DELETE FROM public.{table}")
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE source_system = 'sia' AND object_type = 'access_policy'")
        await apply_import(self.pool, [destination(2, IN_INVENTORY), destination(3, RETIRED)], "uno.csv", "update", "operator-1")
        async with self.pool.connection() as conn:
            rows = await (await conn.execute("SELECT inventory_id FROM public.connection_inventory WHERE private_ip = %s", (RETIRED,))).fetchall()
        await edit_destinations(self.pool, [rows[0]["inventory_id"]], {"lifecycle_status": "retired"}, "operator-1")
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO public.cyberark_ingestion_runs (run_id, source_system, source_file, status, started_at, completed_at) VALUES (%s, 'cyberark', %s, 'completed', now(), now())",
                (self.run_id, f"cov008-{self.run_id}"),
            )
        self.public_safe = await self.safe("public", "business")
        self.internal_safe = await self.safe("internal", "internal")

    async def safe(self, key: str, scope: str) -> int:
        number = 1_100_000_000 + int(uuid4().hex[:7], 16)
        self.safe_numbers.append(number)
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO public.safes (safe_number, safe_name, safe_url_id, source_run_id, lifecycle_status) VALUES (%s, %s, %s, %s, 'active')",
                (number, f"COV008 {key}", f"cov008-{self.run_id}-{key}", self.run_id),
            )
            await conn.execute(
                "INSERT INTO public.cyberark_safe_metadata (safe_number, inventory_scope, account_type_classification) VALUES (%s, %s, %s)",
                (number, scope, "internal" if scope == "internal" else None),
            )
        return number

    async def account(self, safe: int, key: str, address: str, lifecycle: str = "active"):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO public.cyberark_accounts (safe_number, account_id, account_name, address, lifecycle_status) VALUES (%s, %s, %s, %s, %s)",
                (safe, f"cov008-{self.run_id}-{key}", key, address, lifecycle),
            )

    async def policy(self, source_id: str, name: str, ips: list, status: str = "active"):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO public.cyberark_inventory_objects (source_system, object_type, source_id, display_name, lifecycle_status, attributes) "
                "VALUES ('sia', 'access_policy', %s, %s, %s, %s::jsonb)",
                (f"cov008-{self.run_id}-{source_id}", name, status, json.dumps({"status": "Enabled", "ip_rules": ips})),
            )

    async def _cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.cyberark_accounts WHERE account_id LIKE %s", (f"cov008-{self.run_id}-%",))
            await conn.execute("DELETE FROM public.cyberark_safe_metadata WHERE safe_number = ANY(%s)", (self.safe_numbers,))
            await conn.execute("DELETE FROM public.safes WHERE safe_number = ANY(%s)", (self.safe_numbers,))
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE source_id LIKE %s", (f"cov008-{self.run_id}-%",))
            await conn.execute("DELETE FROM public.cyberark_ingestion_runs WHERE run_id = %s", (self.run_id,))

    async def mine(self, **kwargs) -> dict:
        result = await list_uninventoried_addresses(self.pool, **kwargs)
        return {row["address"]: row for row in result["rows"] if row["address"] in MINE}

    async def seed_observed(self):
        await self.account(self.public_safe, "a-known", IN_INVENTORY)
        await self.account(self.public_safe, "a-pam", f" {PAM_ONLY.upper()} ")
        await self.account(self.public_safe, "a-both", BOTH)
        await self.account(self.public_safe, "a-both-2", BOTH)
        await self.account(self.public_safe, "a-retired-account", "198.51.100.6", lifecycle="retired")
        await self.account(self.public_safe, "a-host", "host.example")
        await self.account(self.public_safe, "a-bad", "198.51.100.300")
        await self.account(self.public_safe, "a-retired-destination", RETIRED)
        await self.account(self.internal_safe, "a-internal", "198.51.100.7")
        await self.policy("p1", "Politica-A", [SIA_ONLY, BOTH, IN_INVENTORY])
        await self.policy("p2", "Politica-B", [{"ipAddresses": [BOTH]}, "198.51.100.0/24"])
        await self.policy("p3", "Politica-retirada", ["198.51.100.6"], status="retired")

    async def test_lists_addresses_observed_in_pam_or_sia_that_the_inventory_lacks(self):
        await self.seed_observed()
        found = await self.mine()
        self.assertEqual(set(found), {PAM_ONLY, SIA_ONLY, BOTH, "198.51.100.7"})
        self.assertEqual((found[PAM_ONLY]["pam_accounts"], found[PAM_ONLY]["sia_policies"]), (1, 0), "trim and case are normalized like the rest of Cobertura")
        self.assertEqual((found[SIA_ONLY]["pam_accounts"], found[SIA_ONLY]["sia_policies"]), (0, 1))
        self.assertEqual((found[BOTH]["pam_accounts"], found[BOTH]["pam_safes"], found[BOTH]["sia_policies"]), (2, 1, 2))
        self.assertEqual(found[BOTH]["sia_policy_names"], ["Politica-A", "Politica-B"])

    async def test_known_retired_hostname_range_and_invalid_addresses_never_figure(self):
        await self.seed_observed()
        found = await self.mine()
        for excluded in (IN_INVENTORY, RETIRED, "198.51.100.6", "198.51.100.300", "198.51.100.0/24", "host.example"):
            self.assertNotIn(excluded, found)

    async def test_internal_safes_follow_the_include_internal_scope(self):
        await self.seed_observed()
        self.assertIn("198.51.100.7", await self.mine(include_internal=True))
        self.assertNotIn("198.51.100.7", await self.mine(include_internal=False))

    async def test_an_address_stops_figuring_once_it_is_added_to_the_inventory(self):
        await self.seed_observed()
        self.assertIn(PAM_ONLY, await self.mine())
        await apply_import(self.pool, [destination(2, IN_INVENTORY), destination(4, PAM_ONLY)], "dos.csv", "update", "operator-1")
        self.assertNotIn(PAM_ONLY, await self.mine())

    async def test_without_any_imported_inventory_nothing_is_called_uninventoried(self):
        await self.seed_observed()
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.connection_inventory")
            await conn.execute("DELETE FROM public.connection_inventory_imports")
        self.assertEqual(await self.mine(), {}, "with no inventory loaded every address would be falsely flagged")

    async def test_the_limit_caps_rows_but_not_the_total(self):
        await self.seed_observed()
        result = await list_uninventoried_addresses(self.pool, limit=1)
        self.assertEqual(len(result["rows"]), 1)
        self.assertGreaterEqual(result["total"], 4)
