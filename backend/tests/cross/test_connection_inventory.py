import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.cross.repositories.connection_inventory import get_connection_coverage, import_connection_inventory, list_connection_inventory
from app.cross.services.connection_inventory_import import plan_connection_import


class AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *args):
        return None


class FakeCursor:
    def __init__(self):
        self.executemany = AsyncMock()


class FakeConnection:
    def __init__(self):
        self.cursor_instance = FakeCursor()
        self.execute = AsyncMock()

    def transaction(self):
        return AsyncContext(self)

    def cursor(self):
        return AsyncContext(self.cursor_instance)


class FakePool:
    def __init__(self):
        self.connection_instance = FakeConnection()

    def connection(self):
        return AsyncContext(self.connection_instance)


class ConnectionInventoryTests(unittest.TestCase):
    def test_matches_imported_ip_to_safes_and_sia(self):
        rows = [{
            "inventory_id": 1,
            "private_ip": "10.67.9.143",
            "safe_matches": [{"safe_number": 4}],
            "sia_matches": [{"object_id": 9}],
            "total_count": 1,
            "import_id": "batch-1",
            "file_name": "connections.csv",
            "row_count": 1,
            "imported_at": "2026-09-08T00:00:00Z",
        }]
        with patch("app.cross.repositories.connection_inventory.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_connection_inventory(object(), "10.67", 50, 0))

        self.assertEqual(result["rows"][0]["safe_match_count"], 1)
        self.assertEqual(result["rows"][0]["sia_match_count"], 1)
        query = fetch_all.await_args.args[1]
        self.assertIn("lower(trim(a.address)) = lower(trim(ci.private_ip))", query)
        self.assertIn("source_system = 'sia'", query)
        self.assertEqual(fetch_all.await_args.args[2][-2:], (50, 0))

    def test_can_hide_internal_safe_account_matches(self):
        with patch("app.cross.repositories.connection_inventory.fetch_all", new=AsyncMock(side_effect=[[], []])) as fetch_all:
            asyncio.run(list_connection_inventory(object(), "", 50, 0, include_internal=False))

        query = fetch_all.await_args_list[0].args[1]
        self.assertIn("smeta.inventory_scope", query)
        self.assertIn("a.inventory_account_type", query)

    def test_filters_rows_by_environment_and_observed_coverage(self):
        with patch("app.cross.repositories.connection_inventory.fetch_all", new=AsyncMock(side_effect=[[], []])) as fetch_all:
            result = asyncio.run(list_connection_inventory(object(), "", 50, 0, True, "PROD", "sia_only"))

        query = fetch_all.await_args_list[0].args[1]
        params = fetch_all.await_args_list[0].args[2]
        self.assertIn("lower(trim(ci.environment))", query)
        self.assertIn("safe_matches.inventory_id IS NULL AND sia_matches.inventory_id IS NOT NULL", query)
        self.assertIn("PROD", params)
        self.assertIn("sia_only", params)
        self.assertEqual(result["filters"], {"environment": "PROD", "coverage": "sia_only", "status": "active", "deviation": "", "work_status": "", "responsible": ""})

    def test_summarizes_exact_ip_coverage_by_environment(self):
        rows = [{
            "environment": "PROD", "total": 10, "both": 4, "pam_only": 2, "sia_only": 1,
            "none": 3, "zsp_implemented": 7, "zsp_pending": 2, "zsp_unknown": 1,
            "import_id": "batch-1", "file_name": "connections.csv", "row_count": 10,
            "imported_at": "2026-09-08T00:00:00Z",
        }, {
            "environment": "DEV", "total": 5, "both": 1, "pam_only": 1, "sia_only": 1,
            "none": 2, "zsp_implemented": 2, "zsp_pending": 2, "zsp_unknown": 1,
            "import_id": "batch-1", "file_name": "connections.csv", "row_count": 10,
            "imported_at": "2026-09-08T00:00:00Z",
        }]
        with patch("app.cross.repositories.connection_inventory.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(get_connection_coverage(object(), include_internal=False))

        self.assertEqual(result["totals"]["total"], 15)
        self.assertEqual(result["totals"]["both"], 5)
        self.assertEqual(result["by_environment"][0]["environment"], "PROD")
        query = fetch_all.await_args.args[1]
        self.assertIn("lower(trim(a.address)) = lower(trim(ci.private_ip))", query)
        self.assertIn("source_system = 'sia'", query)
        self.assertIn("smeta.inventory_scope", query)
        self.assertIn("ORDER BY total DESC, environment", query)
        self.assertNotIn("lower(environment)", query)

    def test_keeps_current_import_metadata_when_search_has_no_matches(self):
        with patch("app.cross.repositories.connection_inventory.fetch_all", new=AsyncMock(side_effect=[[], [{
            "import_id": "batch-1", "file_name": "conexiones.csv", "row_count": 18, "imported_at": "2026-09-08T00:00:00Z",
        }]])):
            result = asyncio.run(list_connection_inventory(object(), "10.0.0.99", 50, 0))

        self.assertEqual(result["rows"], [])
        self.assertEqual(result["import"]["file_name"], "conexiones.csv")

    def test_import_inserts_rows_through_the_async_cursor(self):
        pool = FakePool()
        incoming = [{
            "source_row_number": 2, "instance_name": "server-1", "environment": "DEV",
            "private_ip": "10.0.0.1", "port": 22, "ca_sia": True, "ca_dba": False,
            "zsp_implemented": True, "access_available": True, "description": "",
        }]
        with patch("app.cross.repositories.connection_inventory._current_rows", new=AsyncMock(return_value=[])):
            _, summary = asyncio.run(import_connection_inventory(pool, incoming, "connections.csv", "update", "operator-1", plan_connection_import))

        self.assertEqual(summary["counts"]["new"], 1)
        pool.connection_instance.cursor_instance.executemany.assert_awaited_once()
        self.assertIn("INSERT INTO public.connection_inventory", pool.connection_instance.cursor_instance.executemany.await_args.args[0])
        statements = [call.args[0] for call in pool.connection_instance.execute.await_args_list]
        self.assertIn("pg_advisory_xact_lock", statements[0])
        self.assertIn("INSERT INTO public.access_audit_log", statements[-2])
        self.assertIn("INSERT INTO public.activity_events", statements[-1])

    def test_import_with_row_errors_writes_nothing(self):
        pool = FakePool()
        row = {
            "source_row_number": 2, "instance_name": "a", "environment": "", "private_ip": "10.0.0.1", "port": None,
            "ca_sia": None, "ca_dba": None, "zsp_implemented": None, "access_available": None, "description": "",
        }
        with patch("app.cross.repositories.connection_inventory._current_rows", new=AsyncMock(return_value=[])):
            with self.assertRaises(ValueError):
                asyncio.run(import_connection_inventory(pool, [row, {**row, "source_row_number": 3}], "x.csv", "update", "operator-1", plan_connection_import))
        pool.connection_instance.cursor_instance.executemany.assert_not_awaited()


def _row(number, ip, port=None, **extra):
    return {
        "source_row_number": number, "instance_name": f"srv-{number}", "environment": "PROD", "private_ip": ip, "port": port,
        "ca_sia": True, "ca_dba": None, "zsp_implemented": None, "access_available": True, "description": "", **extra,
    }


def _stored(inventory_id, ip, port=None, status="active", **extra):
    return {**_row(inventory_id + 1, ip, port, **extra), "inventory_id": inventory_id, "lifecycle_status": status, "retired_at": None}


class ConnectionImportPlanTests(unittest.TestCase):
    def test_counts_new_changed_unchanged_and_missing(self):
        existing = [_stored(1, "10.0.0.1", 22), _stored(2, "10.0.0.2", 22), _stored(3, "10.0.0.3", 22)]
        incoming = [_row(2, "10.0.0.1", 22), _row(3, "10.0.0.2", 22, environment="DEV"), _row(4, "10.0.0.9", 22)]
        plan = plan_connection_import(existing, incoming, "update")

        self.assertEqual(plan["counts"], {"incoming": 3, "new": 1, "changed": 1, "unchanged": 1, "missing": 1, "already_retired": 0})
        self.assertEqual(plan["samples"]["changed"][0]["fields"], ["environment"])
        self.assertEqual(plan["samples"]["missing"][0]["private_ip"], "10.0.0.3")

    def test_update_mode_retires_what_the_file_lacks_and_never_deletes(self):
        existing = [_stored(1, "10.0.0.1", 22), _stored(2, "10.0.0.2", 22)]
        plan = plan_connection_import(existing, [_row(2, "10.0.0.1", 22)], "update")

        by_ip = {row["private_ip"]: row for row in plan["rows"]}
        self.assertEqual(by_ip["10.0.0.2"]["lifecycle_status"], "retired")
        self.assertEqual(by_ip["10.0.0.2"]["retired_at"], "now")
        self.assertEqual(by_ip["10.0.0.1"]["lifecycle_status"], "active")
        self.assertEqual(len({row["source_row_number"] for row in plan["rows"]}), 2)

    def test_replace_mode_keeps_only_the_file(self):
        existing = [_stored(1, "10.0.0.1", 22), _stored(2, "10.0.0.2", 22)]
        plan = plan_connection_import(existing, [_row(2, "10.0.0.1", 22)], "replace")

        self.assertEqual([row["private_ip"] for row in plan["rows"]], ["10.0.0.1"])
        self.assertEqual(plan["counts"]["missing"], 1)

    def test_a_retired_row_that_reappears_is_reactivated(self):
        existing = [_stored(1, "10.0.0.1", 22, status="retired")]
        plan = plan_connection_import(existing, [_row(2, "10.0.0.1", 22)], "update")

        self.assertEqual(plan["counts"]["changed"], 1)
        self.assertTrue(plan["samples"]["changed"][0]["reactivated"])
        self.assertEqual(plan["rows"][0]["lifecycle_status"], "active")

    def test_the_key_is_ip_and_port_so_the_same_ip_on_two_ports_is_two_destinations(self):
        plan = plan_connection_import([_stored(1, "10.0.0.1", 22)], [_row(2, "10.0.0.1", 22), _row(3, "10.0.0.1", 3389)], "update")

        self.assertEqual((plan["counts"]["new"], plan["counts"]["unchanged"]), (1, 1))

    def test_repeated_ip_and_port_in_the_file_is_a_row_error(self):
        plan = plan_connection_import([], [_row(2, "10.0.0.1", 22), _row(3, "10.0.0.1", 22)], "update")

        self.assertEqual(plan["errors"], [{"row": 3, "message": "IP y puerto repetidos (ya aparecen en la fila 2)"}])

    def test_importing_the_same_file_twice_changes_nothing(self):
        incoming = [_row(2, "10.0.0.1", 22), _row(3, "10.0.0.2", None)]
        first = plan_connection_import([], incoming, "update")
        stored = [{**row, "inventory_id": index + 1} for index, row in enumerate(first["rows"])]
        second = plan_connection_import(stored, incoming, "update")

        self.assertEqual(second["counts"], {"incoming": 2, "new": 0, "changed": 0, "unchanged": 2, "missing": 0, "already_retired": 0})

    def test_work_fields_are_kept_unless_the_file_carries_them(self):
        existing = [_stored(1, "10.0.0.1", 22, work_status="blocked", responsible="Ana", note="Sin ventana")]
        kept = plan_connection_import(existing, [_row(2, "10.0.0.1", 22)], "update")
        self.assertEqual((kept["rows"][0]["work_status"], kept["rows"][0]["responsible"], kept["rows"][0]["note"]), ("blocked", "Ana", "Sin ventana"))
        self.assertEqual(kept["counts"]["unchanged"], 1)

        overridden = plan_connection_import(existing, [_row(2, "10.0.0.1", 22, work_status="onboarded")], "update")
        self.assertEqual(overridden["rows"][0]["work_status"], "onboarded")
        self.assertEqual(overridden["samples"]["changed"][0]["fields"], ["work_status"])

    def test_a_new_destination_starts_pending_without_a_responsible(self):
        plan = plan_connection_import([], [_row(2, "10.0.0.1", 22)], "update")
        self.assertEqual((plan["rows"][0]["work_status"], plan["rows"][0]["responsible"], plan["rows"][0]["note"]), ("pending", "", ""))

    def test_the_export_carries_state_responsible_and_note_so_it_reimports_unchanged(self):
        from app.cross.services.connection_inventory_import import connection_inventory_csv
        base = {"instance_name": "srv", "environment": "", "private_ip": "10.0.0.1", "port": 22, "ca_sia": None, "ca_dba": None,
                "zsp_implemented": None, "access_available": None, "description": "", "safe_match_count": 0, "sia_match_count": 0}
        output = connection_inventory_csv([{**base, "work_status": "in_progress", "responsible": "Ana", "note": "=SUM(1)"}])
        self.assertIn("En curso,Ana,'=SUM(1)", output)

    def test_an_unknown_mode_is_rejected(self):
        with self.assertRaises(ValueError):
            plan_connection_import([], [], "merge")

class CoverageSnapshotTests(unittest.TestCase):
    def test_a_failed_snapshot_never_fails_the_import_or_the_sync_that_asked_for_it(self):
        from app.cross.services import connection_inventory_import as service
        with patch.object(service, "save_coverage_snapshot", new=AsyncMock(side_effect=RuntimeError("db down"))):
            asyncio.run(service.record_coverage_snapshot(object(), "sync"))  # does not raise
            with patch.object(service, "import_connection_inventory", new=AsyncMock(return_value=("id", {"counts": {}}))):
                result = asyncio.run(service.apply_import(object(), [], "x.csv", "update", "operator-1"))
        self.assertEqual(result[0], "id")

    def test_only_the_syncs_that_feed_the_coverage_take_a_snapshot(self):
        from app.cross.services.connection_inventory_import import COVERAGE_SOURCES
        self.assertEqual(COVERAGE_SOURCES, {"cyberark", "sia"})


class ConnectionInventoryCsvTests(unittest.TestCase):
    def test_every_formula_prefix_is_neutralized_in_the_export(self):
        from app.cross.services.connection_inventory_import import connection_inventory_csv
        base = {"environment": "", "private_ip": "10.0.0.1", "port": 22, "ca_sia": None, "ca_dba": None,
                "zsp_implemented": None, "access_available": None, "safe_match_count": 0, "sia_match_count": 0}
        for prefix in ("=", "+", "-", "@", "\t", "\r"):
            output = connection_inventory_csv([{**base, "instance_name": f"{prefix}cmd", "description": f"{prefix}x"}])
            self.assertIn(f"'{prefix}cmd", output, repr(prefix))


if __name__ == "__main__":
    unittest.main()
