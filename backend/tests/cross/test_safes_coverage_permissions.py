"""COV-001: paired read/manage permissions for Safes and for Cobertura, enforced through the real routes."""

import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app

SAFES_LIST = "app.cyberark.pam.api.routes.safe_read.list_safes"
COVERAGE_LIST = "app.cross.api.routes.connection_inventory.list_connection_inventory"
COVERAGE_IMPORT = "app.cross.api.routes.connection_inventory.apply_import"
IMPORT_BODY = {"file_name": "destinos.csv", "rows": [{"source_row_number": 2, "instance_name": "srv-1", "private_ip": "10.0.0.1"}]}
# The mocks stand for the repository call only; the route's response model is not what these tests exercise, so an
# invalid mocked shape surfaces as a 500 (never a 403) and the awaited mock is the proof that the gate was passed.
EMPTY_SAFES = {"rows": [], "total": 0, "limit": 50, "offset": 0}


class SafesAndCoveragePermissionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_the_safe_list_needs_safes_read_not_just_inventory_read(self):
        listing = AsyncMock(return_value=EMPTY_SAFES)
        with patch(SAFES_LIST, new=listing):
            for permissions in (["inventory:read"], ["inventory:read", "safes:manage", "coverage:read"]):
                self.session.set_permissions(permissions)
                self.assertEqual((await self.client.get("/api/safes")).status_code, 403, permissions)
            listing.assert_not_awaited()
            self.session.set_permissions(["safes:read"])
            self.assertNotEqual((await self.client.get("/api/safes")).status_code, 403)
        listing.assert_awaited_once()

    async def test_reading_the_coverage_inventory_needs_coverage_read(self):
        listing = AsyncMock(return_value={"rows": [], "total": 0, "import": None})
        with patch(COVERAGE_LIST, new=listing):
            for permissions in (["inventory:read"], ["inventory:read", "safes:read", "coverage:manage"]):
                self.session.set_permissions(permissions)
                self.assertEqual((await self.client.get("/api/connection-inventory")).status_code, 403, permissions)
            listing.assert_not_awaited()
            self.session.set_permissions(["coverage:read"])
            self.assertNotEqual((await self.client.get("/api/connection-inventory")).status_code, 403)
        listing.assert_awaited_once()

    async def test_importing_the_inventory_needs_coverage_manage_and_the_legacy_code_is_not_enough(self):
        counts = {"incoming": 1, "new": 1, "changed": 0, "unchanged": 0, "missing": 0, "already_retired": 0}
        importer = AsyncMock(return_value=("11111111-1111-1111-1111-111111111111", {"counts": counts}))
        with patch(COVERAGE_IMPORT, new=importer):
            for permissions in (["inventory:read", "coverage:read"], ["inventory:read", "connections:import"]):
                self.session.set_permissions(permissions)
                self.assertEqual((await self.client.post("/api/connection-inventory/import", json=IMPORT_BODY)).status_code, 403, permissions)
            importer.assert_not_awaited()
            self.session.set_permissions(["coverage:manage"])
            granted = await self.client.post("/api/connection-inventory/import", json=IMPORT_BODY)
        self.assertEqual(granted.status_code, 200, granted.text)
        importer.assert_awaited_once()

    async def test_previewing_and_exporting_the_inventory_need_coverage_manage(self):
        # The export is an operator file with observed data, so reading the inventory (coverage:read) is not enough.
        previewer = AsyncMock(return_value={"mode": "update", "counts": {"incoming": 0, "new": 0, "changed": 0, "unchanged": 0, "missing": 0, "already_retired": 0}, "samples": {"new": [], "changed": [], "missing": []}, "errors": []})
        exporter = AsyncMock(return_value="Instance Name\n")
        with patch("app.cross.api.routes.connection_inventory.preview_import", new=previewer), \
                patch("app.cross.api.routes.connection_inventory.export_destinations_csv", new=exporter):
            self.session.set_permissions(["inventory:read", "coverage:read", "inventory:export"])
            self.assertEqual((await self.client.post("/api/connection-inventory/import/preview", json=IMPORT_BODY)).status_code, 403)
            self.assertEqual((await self.client.get("/api/connection-inventory/export.csv")).status_code, 403)
            previewer.assert_not_awaited()
            exporter.assert_not_awaited()
            self.session.set_permissions(["coverage:manage"])
            self.assertEqual((await self.client.post("/api/connection-inventory/import/preview", json=IMPORT_BODY)).status_code, 200)
            exported = await self.client.get("/api/connection-inventory/export.csv")
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertIn("Instance Name", exported.text)
        exporter.assert_awaited_once()

    async def test_creating_editing_and_bulk_editing_destinations_need_coverage_manage(self):
        creator, editor = AsyncMock(return_value=7), AsyncMock(return_value=2)
        new = {"instance_name": "srv-1", "private_ip": "10.0.0.1"}
        requests = (
            ("post", "/api/connection-inventory", {"json": new}),
            ("patch", "/api/connection-inventory/7", {"json": {"environment": "DEV"}}),
            ("post", "/api/connection-inventory/bulk-update", {"json": {"inventory_ids": [7], "changes": {"environment": "DEV"}}}),
        )
        with patch("app.cross.api.routes.connection_inventory.add_destination", new=creator), \
                patch("app.cross.api.routes.connection_inventory.edit_destinations", new=editor):
            for permissions in (["inventory:read", "coverage:read"], ["safes:manage", "connections:import"]):
                self.session.set_permissions(permissions)
                for method, path, kwargs in requests:
                    self.assertEqual((await getattr(self.client, method)(path, **kwargs)).status_code, 403, (permissions, path))
            creator.assert_not_awaited()
            editor.assert_not_awaited()
            self.session.set_permissions(["coverage:manage"])
            for method, path, kwargs in requests:
                response = await getattr(self.client, method)(path, **kwargs)
                self.assertIn(response.status_code, (200, 201), (path, response.text))
        creator.assert_awaited_once()
        self.assertEqual(editor.await_count, 2)

    async def test_policy_classification_is_read_with_coverage_read_and_written_with_coverage_manage(self):
        reader, writer = AsyncMock(return_value=[]), AsyncMock(return_value=1)
        body = {"items": [{"policy_source_id": "p1", "capability": "platform"}]}
        with patch("app.cross.api.routes.connection_inventory.policies_with_suggestions", new=reader), \
                patch("app.cross.api.routes.connection_inventory.classify_policies", new=writer):
            self.session.set_permissions(["inventory:read"])
            self.assertEqual((await self.client.get("/api/connection-inventory/sia-policies")).status_code, 403)
            self.session.set_permissions(["coverage:read"])
            self.assertEqual((await self.client.get("/api/connection-inventory/sia-policies")).status_code, 200)
            self.assertEqual((await self.client.put("/api/connection-inventory/sia-policies", json=body)).status_code, 403)
            writer.assert_not_awaited()
            self.session.set_permissions(["coverage:manage"])
            self.assertEqual((await self.client.put("/api/connection-inventory/sia-policies", json=body)).status_code, 200)
            invalid = await self.client.put("/api/connection-inventory/sia-policies", json={"items": [{"policy_source_id": "p1", "capability": "zsp"}]})
        self.assertEqual(invalid.status_code, 422)
        writer.assert_awaited_once()

    async def test_the_history_of_a_destination_needs_coverage_read(self):
        history = AsyncMock(return_value=[])
        with patch("app.cross.api.routes.connection_inventory.destination_history", new=history):
            self.session.set_permissions(["inventory:read"])
            self.assertEqual((await self.client.get("/api/connection-inventory/7/history")).status_code, 403)
            history.assert_not_awaited()
            self.session.set_permissions(["coverage:read"])
            self.assertEqual((await self.client.get("/api/connection-inventory/7/history")).status_code, 200)
        history.assert_awaited_once()

    async def test_an_unknown_work_state_is_rejected(self):
        self.session.set_permissions(["coverage:manage"])
        response = await self.client.patch("/api/connection-inventory/7", json={"work_status": "hecho"})
        self.assertEqual(response.status_code, 422)

    async def test_progress_is_read_with_coverage_read_and_the_snapshot_needs_coverage_manage(self):
        block = {"n": 0, "platform": dict.fromkeys(("match", "missing", "undeclared", "unclassified", "unknown"), 0), "dba": dict.fromkeys(("match", "missing", "undeclared", "unclassified", "unknown"), 0), "work": {}}
        current = {"total": block, "by_environment": [], "by_responsible": []}
        reader, taker = AsyncMock(return_value={"current": current, "series": []}), AsyncMock(return_value=current)
        with patch("app.cross.api.routes.connection_inventory.coverage_progress", new=reader), \
                patch("app.cross.api.routes.connection_inventory.take_coverage_snapshot", new=taker):
            self.session.set_permissions(["inventory:read"])
            self.assertEqual((await self.client.get("/api/connection-inventory/progress")).status_code, 403)
            self.session.set_permissions(["coverage:read"])
            self.assertEqual((await self.client.get("/api/connection-inventory/progress")).status_code, 200)
            self.assertEqual((await self.client.post("/api/connection-inventory/progress/snapshot")).status_code, 403)
            taker.assert_not_awaited()
            self.session.set_permissions(["coverage:manage"])
            self.assertEqual((await self.client.post("/api/connection-inventory/progress/snapshot")).status_code, 200)
        taker.assert_awaited_once()

    async def test_a_bulk_edit_cannot_carry_more_than_500_ids_or_an_empty_change(self):
        self.session.set_permissions(["coverage:manage"])
        too_many = await self.client.post("/api/connection-inventory/bulk-update", json={"inventory_ids": list(range(1, 502)), "changes": {"environment": "DEV"}})
        self.assertEqual(too_many.status_code, 422)
        with patch("app.cross.services.connection_inventory_import.update_destinations", new=AsyncMock()) as writer:
            empty = await self.client.post("/api/connection-inventory/bulk-update", json={"inventory_ids": [1], "changes": {}})
        self.assertEqual(empty.status_code, 422)
        writer.assert_not_awaited()

    async def test_safes_read_and_manage_are_independent(self):
        # Managing does not imply reading, and reading never opens a classification write.
        self.session.set_permissions(["safes:read"])
        denied = await self.client.patch("/api/safes/123/metadata", json={"classification_status": "assigned"})
        self.assertEqual(denied.status_code, 403)
        self.session.set_permissions(["safes:manage"])
        self.assertEqual((await self.client.get("/api/safes")).status_code, 403)


if __name__ == "__main__":
    unittest.main()
