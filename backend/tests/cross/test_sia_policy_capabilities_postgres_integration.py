"""COV-003 against real PostgreSQL: policy classification and the per-capability reading of each destination."""

import json

from app.cross.repositories.connection_inventory import get_capability_deviations, list_connection_inventory
from app.cross.services.connection_inventory_import import apply_import
from app.cross.services.sia_policy_capabilities import classify_policies, policies_with_suggestions, suggest_capability
from app.db import fetch_all
from tests.support.pg_integration_base import PostgresIntegrationTestCase


def destination(number, ip, sia, dba, port=22):
    return {
        "source_row_number": number, "instance_name": f"srv-{number}", "environment": "PROD", "private_ip": ip, "port": port,
        "ca_sia": sia, "ca_dba": dba, "zsp_implemented": None, "access_available": None, "description": "",
    }


class SiaPolicyCapabilitiesPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.sia_policy_capabilities")
            await conn.execute("DELETE FROM public.connection_inventory")
            await conn.execute("DELETE FROM public.connection_inventory_imports")
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE source_system = 'sia' AND object_type = 'access_policy'")
            for source_id, name, ips in (
                ("pol-platform", "Politica-DEV-OCI-Platform", ["10.0.0.1", "10.0.0.2"]),
                ("pol-dba", "Politica-DEV-OCI-DBA", ["10.0.0.2", "10.0.0.3"]),
                ("pol-other", "Fideicomiso_ZSP-SSH", ["10.0.0.4"]),
            ):
                await conn.execute(
                    "INSERT INTO public.cyberark_inventory_objects (source_system, object_type, source_id, display_name, attributes) VALUES ('sia', 'access_policy', %s, %s, %s::jsonb)",
                    (source_id, name, json.dumps({"status": "Enabled", "ip_rules": ips})),
                )

    async def readings(self):
        rows = (await list_connection_inventory(self.pool, "", 500, 0, True, "", "", "active"))["rows"]
        return {row["private_ip"]: (row["platform_result"], row["dba_result"]) for row in rows}

    async def test_the_name_only_suggests_and_never_classifies(self):
        self.assertEqual([suggest_capability(name) for name in ("Politica-DEV-OCI-Platform", "Politica-PROD-OCI-DBA", "Fideicomiso_ZSP-SSH", "Acceso Windows - Ueno Seguros")], ["platform", "dba", None, None])
        policies = {row["source_id"]: row for row in await policies_with_suggestions(self.pool)}
        self.assertEqual(policies["pol-platform"]["suggested"], "platform")
        self.assertIsNone(policies["pol-platform"]["capability"], "a suggestion is not a classification")

    async def test_classifying_is_audited_per_policy_and_clearing_removes_it(self):
        await classify_policies(self.pool, [{"policy_source_id": "pol-platform", "capability": "platform"}, {"policy_source_id": "pol-dba", "capability": "dba"}], "operator-1")
        events = await fetch_all(self.pool, "SELECT action, before_data, after_data FROM public.access_audit_log WHERE entity_type = 'sia_policy_capability' AND entity_id = 'pol-dba'")
        self.assertEqual((events[0]["action"], events[0]["after_data"]), ("bulk_update", {"capability": "dba"}))
        self.assertEqual(await classify_policies(self.pool, [{"policy_source_id": "pol-dba", "capability": "dba"}], "operator-1"), 0, "same value is not a change")
        await classify_policies(self.pool, [{"policy_source_id": "pol-dba", "capability": None}], "operator-1")
        policies = {row["source_id"]: row for row in await policies_with_suggestions(self.pool)}
        self.assertIsNone(policies["pol-dba"]["capability"])
        with self.assertRaises(LookupError):
            await classify_policies(self.pool, [{"policy_source_id": "no-such-policy", "capability": "dba"}], "operator-1")
        with self.assertRaises(ValueError):
            await classify_policies(self.pool, [{"policy_source_id": "pol-dba", "capability": "dba"}, {"policy_source_id": "pol-dba", "capability": "other"}], "operator-1")

    async def test_each_destination_reads_platform_and_dba_against_the_classified_policies(self):
        await apply_import(self.pool, [
            destination(2, "10.0.0.1", True, False),    # Platform only: matches both declarations
            destination(3, "10.0.0.2", True, False),    # Platform and DBA observed, DBA declared No: DBA undeclared
            destination(4, "10.0.0.3", True, True),     # DBA observed only, Platform declared Sí: Platform missing
            destination(5, "10.0.0.9", True, None),     # nothing observed, Platform declared Sí: missing; DBA unknown
        ], "uno.csv", "update", "operator-1")
        await classify_policies(self.pool, [{"policy_source_id": "pol-platform", "capability": "platform"}, {"policy_source_id": "pol-dba", "capability": "dba"}], "operator-1")
        self.assertEqual(await self.readings(), {
            "10.0.0.1": ("match", "match"),
            "10.0.0.2": ("match", "undeclared"),
            "10.0.0.3": ("missing", "match"),
            "10.0.0.9": ("missing", "unknown"),
        })

    async def test_a_declared_si_on_an_ip_with_only_unclassified_policies_is_not_a_verdict_until_classified(self):
        await apply_import(self.pool, [destination(2, "10.0.0.1", True, None)], "uno.csv", "update", "operator-1")
        self.assertEqual((await self.readings())["10.0.0.1"][0], "unclassified")
        await classify_policies(self.pool, [{"policy_source_id": "pol-platform", "capability": "other"}], "operator-1")
        # Once a person says the only policy on that IP is not Platform, Platform is genuinely missing.
        self.assertEqual((await self.readings())["10.0.0.1"][0], "missing")

    async def test_the_deviation_filter_and_the_counts_agree(self):
        await apply_import(self.pool, [
            destination(2, "10.0.0.1", True, False), destination(3, "10.0.0.3", True, True), destination(4, "10.0.0.9", True, None),
        ], "uno.csv", "update", "operator-1")
        await classify_policies(self.pool, [{"policy_source_id": "pol-platform", "capability": "platform"}, {"policy_source_id": "pol-dba", "capability": "dba"}], "operator-1")
        deviating = (await list_connection_inventory(self.pool, "", 500, 0, True, "", "", "active", "platform"))["rows"]
        self.assertEqual(sorted(row["private_ip"] for row in deviating), ["10.0.0.3", "10.0.0.9"])
        counts = await get_capability_deviations(self.pool)
        self.assertEqual((counts["platform"]["missing"], counts["platform"]["match"]), (2, 1))
        self.assertEqual(counts["policies"], {"total": 3, "classified": 2})
        self.assertEqual(len((await list_connection_inventory(self.pool, "", 500, 0, True, "", "", "active", "any"))["rows"]), 2)

    async def test_a_retired_destination_has_no_reading(self):
        await apply_import(self.pool, [destination(2, "10.0.0.1", True, None)], "uno.csv", "update", "operator-1")
        await apply_import(self.pool, [destination(2, "10.0.0.7", True, None)], "dos.csv", "update", "operator-1")
        retired = (await list_connection_inventory(self.pool, "", 500, 0, True, "", "", "retired"))["rows"]
        self.assertEqual([(row["private_ip"], row["platform_result"]) for row in retired], [("10.0.0.1", None)])
