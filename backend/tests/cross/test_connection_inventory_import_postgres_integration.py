"""COV-002 against real PostgreSQL: import by IP + port, retirement, reactivation, replace and the listing filters."""

from app.cross.repositories.connection_inventory import connection_history, export_connection_inventory, get_capability_deviations, list_connection_inventory
from app.cross.services.connection_inventory_import import DestinationConflict, add_destination, apply_import, edit_destinations, preview_import
from app.db import fetch_all
from tests.support.pg_integration_base import PostgresIntegrationTestCase


def row(number, ip, port=22, **extra):
    return {
        "source_row_number": number, "instance_name": f"srv-{number}", "environment": "PROD", "private_ip": ip, "port": port,
        "ca_sia": True, "ca_dba": None, "zsp_implemented": None, "access_available": True, "description": "", **extra,
    }


class ConnectionInventoryImportPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.pool.connection() as conn:
            # The ephemeral cluster is private to the run; start from an empty inventory.
            await conn.execute("DELETE FROM public.connection_inventory")
            await conn.execute("DELETE FROM public.connection_inventory_imports")

    async def listing(self, status="active"):
        result = await list_connection_inventory(self.pool, "", 500, 0, True, "", "", status)
        return {(item["private_ip"], item["port"]): item for item in result["rows"]}

    async def test_update_mode_adds_updates_retires_and_keeps_history(self):
        await apply_import(self.pool, [row(2, "10.0.0.1"), row(3, "10.0.0.2")], "uno.csv", "update", "operator-1")
        plan = await preview_import(self.pool, [row(2, "10.0.0.1", environment="DEV"), row(3, "10.0.0.9")], "update")
        self.assertEqual(plan["counts"], {"incoming": 2, "new": 1, "changed": 1, "unchanged": 0, "missing": 1, "already_retired": 0})
        self.assertEqual(len(await self.listing()), 2, "the preview must not write")

        await apply_import(self.pool, [row(2, "10.0.0.1", environment="DEV"), row(3, "10.0.0.9")], "dos.csv", "update", "operator-1")
        active = await self.listing()
        self.assertEqual(set(active), {("10.0.0.1", 22), ("10.0.0.9", 22)})
        self.assertEqual(active[("10.0.0.1", 22)]["environment"], "DEV")
        retired = await self.listing("retired")
        self.assertEqual(set(retired), {("10.0.0.2", 22)})
        self.assertIsNotNone(retired[("10.0.0.2", 22)]["retired_at"])
        snapshots = await fetch_all(self.pool, "SELECT count(*)::int AS n FROM public.connection_inventory_imports")
        self.assertEqual(snapshots[0]["n"], 2, "the first snapshot stays as history")

    async def test_a_retired_destination_comes_back_when_the_file_lists_it_again(self):
        await apply_import(self.pool, [row(2, "10.0.0.1"), row(3, "10.0.0.2")], "uno.csv", "update", "operator-1")
        await apply_import(self.pool, [row(2, "10.0.0.1")], "dos.csv", "update", "operator-1")
        await apply_import(self.pool, [row(2, "10.0.0.1"), row(3, "10.0.0.2")], "tres.csv", "update", "operator-1")
        self.assertEqual(set(await self.listing()), {("10.0.0.1", 22), ("10.0.0.2", 22)})
        self.assertEqual(await self.listing("retired"), {})

    async def test_replace_mode_leaves_exactly_the_file(self):
        await apply_import(self.pool, [row(2, "10.0.0.1"), row(3, "10.0.0.2")], "uno.csv", "update", "operator-1")
        await apply_import(self.pool, [row(2, "10.0.0.1")], "dos.csv", "replace", "operator-1")
        self.assertEqual(set(await self.listing("all")), {("10.0.0.1", 22)})

    async def test_importing_twice_is_idempotent_and_the_export_reimports_without_differences(self):
        incoming = [row(2, "10.0.0.1"), row(3, "10.0.0.2", port=None, description="=HYPERLINK(\"x\")")]
        await apply_import(self.pool, incoming, "uno.csv", "update", "operator-1")
        plan = await preview_import(self.pool, incoming, "update")
        self.assertEqual((plan["counts"]["new"], plan["counts"]["changed"], plan["counts"]["missing"]), (0, 0, 0))

        exported = await export_connection_inventory(self.pool)
        reimport = [{key: item[key] for key in incoming[0]} for item in exported]
        again = await preview_import(self.pool, reimport, "update")
        self.assertEqual((again["counts"]["new"], again["counts"]["changed"], again["counts"]["missing"]), (0, 0, 0))

    async def test_the_import_is_audited_with_the_counts(self):
        await apply_import(self.pool, [row(2, "10.0.0.1")], "uno.csv", "update", "operator-1")
        events = await fetch_all(self.pool, """
            SELECT after_data FROM public.access_audit_log
            WHERE entity_type = 'connection_inventory' AND action = 'import' ORDER BY created_at DESC LIMIT 1
        """)
        self.assertEqual(events[0]["after_data"]["new"], 1)
        self.assertEqual(events[0]["after_data"]["mode"], "update")


class ConnectionDestinationEditPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.connection_inventory")
            await conn.execute("DELETE FROM public.connection_inventory_imports")

    async def ids(self):
        result = await list_connection_inventory(self.pool, "", 500, 0, True, "", "", "all")
        return {item["private_ip"]: item["inventory_id"] for item in result["rows"]}, {item["private_ip"]: item for item in result["rows"]}

    async def audit(self, entity_id):
        return await fetch_all(self.pool, "SELECT action, before_data, after_data FROM public.access_audit_log WHERE entity_type = 'connection_inventory_item' AND entity_id = %s ORDER BY created_at", (str(entity_id),))

    async def test_a_manual_destination_opens_the_inventory_and_a_repeated_key_is_a_conflict(self):
        first = await add_destination(self.pool, {"instance_name": "srv-a", "environment": "DEV", "private_ip": "10.0.0.1", "port": 22, "ca_sia": True, "ca_dba": None, "zsp_implemented": None, "access_available": True, "description": ""}, "operator-1")
        self.assertEqual((await self.audit(first))[0]["action"], "create")
        with self.assertRaises(DestinationConflict):
            await add_destination(self.pool, {"instance_name": "srv-b", "environment": "DEV", "private_ip": "10.0.0.1", "port": 22, "ca_sia": None, "ca_dba": None, "zsp_implemented": None, "access_available": None, "description": ""}, "operator-1")
        # The same IP on another port is another destination.
        await add_destination(self.pool, {"instance_name": "srv-a-rdp", "environment": "DEV", "private_ip": "10.0.0.1", "port": 3389, "ca_sia": None, "ca_dba": None, "zsp_implemented": None, "access_available": None, "description": ""}, "operator-1")

    async def test_bulk_edit_changes_the_selection_audits_each_row_and_skips_unchanged_ones(self):
        await apply_import(self.pool, [row(2, "10.0.0.1"), row(3, "10.0.0.2", environment="DEV"), row(4, "10.0.0.3")], "uno.csv", "update", "operator-1")
        ids, _ = await self.ids()
        changed = await edit_destinations(self.pool, [ids["10.0.0.1"], ids["10.0.0.2"], ids["10.0.0.3"]], {"environment": "DEV", "ca_dba": True}, "operator-1")
        self.assertEqual(changed, 3)
        _, by_ip = await self.ids()
        self.assertTrue(all(item["environment"] == "DEV" and item["ca_dba"] is True for item in by_ip.values()))
        events = await self.audit(ids["10.0.0.2"])
        self.assertEqual(events[0]["action"], "bulk_update")
        self.assertEqual(events[0]["after_data"], {"ca_dba": True}, "only the field that changed is recorded")
        self.assertEqual(await edit_destinations(self.pool, [ids["10.0.0.1"]], {"environment": "DEV"}, "operator-1"), 0)

    async def test_retiring_and_reactivating_keep_the_row(self):
        await apply_import(self.pool, [row(2, "10.0.0.1")], "uno.csv", "update", "operator-1")
        ids, _ = await self.ids()
        await edit_destinations(self.pool, [ids["10.0.0.1"]], {"lifecycle_status": "retired"}, "operator-1")
        _, by_ip = await self.ids()
        self.assertEqual(by_ip["10.0.0.1"]["lifecycle_status"], "retired")
        self.assertIsNotNone(by_ip["10.0.0.1"]["retired_at"])
        await edit_destinations(self.pool, [ids["10.0.0.1"]], {"lifecycle_status": "active"}, "operator-1")
        _, by_ip = await self.ids()
        self.assertEqual((by_ip["10.0.0.1"]["lifecycle_status"], by_ip["10.0.0.1"]["retired_at"]), ("active", None))

    async def test_editing_the_key_cannot_land_on_another_destination_and_is_never_bulk(self):
        await apply_import(self.pool, [row(2, "10.0.0.1"), row(3, "10.0.0.2")], "uno.csv", "update", "operator-1")
        ids, _ = await self.ids()
        with self.assertRaises(DestinationConflict):
            await edit_destinations(self.pool, [ids["10.0.0.2"]], {"private_ip": "10.0.0.1"}, "operator-1")
        with self.assertRaises(ValueError):
            await edit_destinations(self.pool, [ids["10.0.0.1"], ids["10.0.0.2"]], {"private_ip": "10.0.0.9"}, "operator-1")
        with self.assertRaises(LookupError):
            await edit_destinations(self.pool, [999999], {"environment": "DEV"}, "operator-1")

    async def test_a_failed_bulk_edit_changes_nothing(self):
        await apply_import(self.pool, [row(2, "10.0.0.1")], "uno.csv", "update", "operator-1")
        ids, _ = await self.ids()
        with self.assertRaises(LookupError):
            await edit_destinations(self.pool, [ids["10.0.0.1"], 999999], {"environment": "STG"}, "operator-1")
        _, by_ip = await self.ids()
        self.assertEqual(by_ip["10.0.0.1"]["environment"], "PROD")


class ConnectionWorkStatusPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.connection_inventory")
            await conn.execute("DELETE FROM public.connection_inventory_imports")

    async def rows(self, **filters):
        result = await list_connection_inventory(self.pool, "", 500, 0, True, "", "", filters.pop("status", "active"), "", filters.get("work_status", ""), filters.get("responsible", ""))
        return {item["private_ip"]: item for item in result["rows"]}

    async def test_new_destinations_start_pending_and_people_set_state_responsible_and_note_in_bulk(self):
        await apply_import(self.pool, [row(2, "10.0.0.1"), row(3, "10.0.0.2")], "uno.csv", "update", "operator-1")
        self.assertTrue(all(item["work_status"] == "pending" for item in (await self.rows()).values()))
        ids = [item["inventory_id"] for item in (await self.rows()).values()]
        await edit_destinations(self.pool, ids, {"work_status": "in_progress", "responsible": "Ana", "note": "Ventana el viernes"}, "operator-1")
        current = await self.rows()
        self.assertTrue(all((item["work_status"], item["responsible"], item["note"]) == ("in_progress", "Ana", "Ventana el viernes") for item in current.values()))
        self.assertEqual(len(await self.rows(work_status="blocked")), 0)
        self.assertEqual(len(await self.rows(work_status="in_progress", responsible="Ana")), 2)
        self.assertEqual(len(await self.rows(responsible="none")), 0)

    async def test_an_import_without_those_columns_never_resets_them_but_a_file_that_carries_them_does(self):
        await apply_import(self.pool, [row(2, "10.0.0.1")], "uno.csv", "update", "operator-1")
        ids = [item["inventory_id"] for item in (await self.rows()).values()]
        await edit_destinations(self.pool, ids, {"work_status": "blocked", "responsible": "Ana"}, "operator-1")

        plan = await preview_import(self.pool, [row(2, "10.0.0.1", environment="DEV")], "update")
        self.assertEqual(plan["samples"]["changed"][0]["fields"], ["environment"], "state, responsible and note are not compared when the file lacks them")
        await apply_import(self.pool, [row(2, "10.0.0.1", environment="DEV")], "dos.csv", "update", "operator-1")
        kept = (await self.rows())["10.0.0.1"]
        self.assertEqual((kept["work_status"], kept["responsible"]), ("blocked", "Ana"))

        again = await preview_import(self.pool, [row(2, "10.0.0.1", environment="DEV", work_status="onboarded")], "update")
        self.assertEqual(again["samples"]["changed"][0]["fields"], ["work_status"])
        await apply_import(self.pool, [row(2, "10.0.0.1", environment="DEV", work_status="onboarded")], "tres.csv", "update", "operator-1")
        self.assertEqual((await self.rows())["10.0.0.1"]["work_status"], "onboarded")

    async def test_a_retired_destination_keeps_its_state_and_the_history_follows_it_across_imports(self):
        await apply_import(self.pool, [row(2, "10.0.0.1")], "uno.csv", "update", "operator-1")
        first = (await self.rows())["10.0.0.1"]["inventory_id"]
        await edit_destinations(self.pool, [first], {"work_status": "in_progress"}, "operator-1")
        await apply_import(self.pool, [row(2, "10.0.0.1", environment="DEV")], "dos.csv", "update", "operator-1")
        second = (await self.rows())["10.0.0.1"]["inventory_id"]
        self.assertNotEqual(first, second, "each import writes a new snapshot")
        await edit_destinations(self.pool, [second], {"work_status": "onboarded"}, "operator-2")
        history = await connection_history(self.pool, second)
        self.assertEqual([(event["actor_id"], event["after_data"]) for event in history], [("operator-2", {"work_status": "onboarded"}), ("operator-1", {"work_status": "in_progress"})])
        self.assertEqual(history[1]["before_data"], {"work_status": "pending"})

    async def test_the_summary_counts_work_states_and_lists_responsibles(self):
        await apply_import(self.pool, [row(2, "10.0.0.1"), row(3, "10.0.0.2"), row(4, "10.0.0.3")], "uno.csv", "update", "operator-1")
        ids = {ip: item["inventory_id"] for ip, item in (await self.rows()).items()}
        await edit_destinations(self.pool, [ids["10.0.0.1"], ids["10.0.0.2"]], {"work_status": "blocked", "responsible": "Ana"}, "operator-1")
        counts = await get_capability_deviations(self.pool)
        self.assertEqual((counts["work"]["blocked"], counts["work"]["pending"]), (2, 1))
        self.assertEqual(counts["responsibles"], [{"responsible": "Ana", "total": 2}])
