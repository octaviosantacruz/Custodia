"""NSK-POLICY-002: Real-time Protection policy groups -- client, allowlist, optional sync layer and read route."""

import asyncio
import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx

from app.netskope.sse import netskope_sync
from app.netskope.sse.integrations.netskope import (
    POLICY_GROUPS_PATH, NetskopeClient, NetskopeError, NetskopeNotConfigured, NetskopeSettings,
    netskope_policy_groups_configured,
)
from app.netskope.sse.services.netskope_mapping import map_netskope_policy_groups
from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app
from tests.netskope.test_netskope_sync import _client

GROUPS = [
    {"group_id": 1, "group_name": "Header Policies", "group_type": "default", "can_be_edited_deleted": False,
     "created_by": "admin@example.test", "modify_by": "admin@example.test", "modify_time": "1700000000", "modify_type": "Created"},
    {"group_id": "9", "group_name": "Cloud Apps and Data Protection", "can_be_edited_deleted": True},
]
ROUTES = "app.netskope.sse.api.routes.cmdb_netskope."


def settings(**overrides):
    values = dict(
        base_url="https://tenant.goskope.com", api_token="secret-token",
        device_status_path="/api/v2/events/datasearch/clientstatus", users_path="/api/v2/users/getusers",
        user_counts_path="/api/v2/users/counts", policy_groups_path=POLICY_GROUPS_PATH, page_delay_seconds=0,
    )
    return NetskopeSettings(**{**values, **overrides})


class PolicyGroupClientTests(unittest.TestCase):
    def read(self, handler, **overrides):
        async def exercise():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                async with NetskopeClient(settings(**overrides), http) as netskope:
                    return await netskope.get_policy_groups()
        return asyncio.run(exercise())

    def test_reads_the_approved_route_with_get_and_returns_the_groups(self):
        seen = []

        def handler(request):
            seen.append((request.method, request.url.path, request.headers["Netskope-API-Token"]))
            return httpx.Response(200, json={"status": "success", "data": GROUPS})
        self.assertEqual(len(self.read(handler)), 2)
        self.assertEqual(seen, [("GET", POLICY_GROUPS_PATH, "secret-token")])

    def test_unverifiable_reads_are_refused_so_they_cannot_retire_groups(self):
        cases = {
            "empty": {"status": "success", "data": []},
            "not a list": {"status": "success", "data": {"group_id": 1}},
            "bad item": {"status": "success", "data": ["Header Policies"]},
            "failure status": {"status": "error", "data": GROUPS},
            "at the cap": {"status": "success", "data": [{"group_id": i, "group_name": f"g{i}"} for i in range(500)]},
        }
        for label, payload in cases.items():
            with self.subTest(label), self.assertRaises(NetskopeError):
                self.read(lambda _request, payload=payload: httpx.Response(200, json=payload))

    def test_only_the_approved_route_is_ever_called(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(netskope_policy_groups_configured())
        with patch.dict("os.environ", {"NETSKOPE_POLICY_GROUPS_PATH": "/api/v2/policy/internetaccess/rules"}, clear=True):
            self.assertFalse(netskope_policy_groups_configured())
        with patch.dict("os.environ", {"NETSKOPE_POLICY_GROUPS_PATH": POLICY_GROUPS_PATH}, clear=True):
            self.assertTrue(netskope_policy_groups_configured())
        calls = []
        with self.assertRaises(NetskopeNotConfigured):
            self.read(lambda request: calls.append(request) or httpx.Response(200, json={}), policy_groups_path="", rbac_path="")
        self.assertEqual(calls, [])


class PolicyGroupMappingTests(unittest.TestCase):
    def test_only_the_allowlist_is_kept_and_ids_are_text(self):
        objects = map_netskope_policy_groups(GROUPS)
        self.assertEqual([(o.object_type, o.source_id, o.display_name, o.source_system) for o in objects],
                         [("netskope_policy_group", "1", "Header Policies", "netskope"),
                          ("netskope_policy_group", "9", "Cloud Apps and Data Protection", "netskope")])
        self.assertEqual(objects[0].attributes, {"group_type": "default", "can_be_edited_deleted": False})
        self.assertEqual(objects[1].attributes, {"can_be_edited_deleted": True})
        self.assertNotIn("admin@example.test", repr(objects))

    def test_missing_or_duplicate_identity_aborts_instead_of_inventing_a_group(self):
        for bad in ([{"group_name": "x"}], [{"group_id": 1}], [{"group_id": True, "group_name": "x"}],
                    [{"group_id": 1, "group_name": "a"}, {"group_id": "1", "group_name": "b"}]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                map_netskope_policy_groups(bad)


def _sync_client(groups, error=None):
    context = _client([])
    client = context.__aenter__.return_value
    client.get_policy_groups = AsyncMock(return_value=groups, side_effect=error)
    return context


class PolicyGroupSyncTests(unittest.IsolatedAsyncioTestCase):
    async def run_sync(self, groups, *, error=None, path=POLICY_GROUPS_PATH):
        configured = MagicMock(dem_sites_path="", alert_path="", groups_path="", policy_groups_path=path, rbac_path="")
        inventory = AsyncMock(return_value={"objects": 3})
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=configured), \
                patch.object(netskope_sync, "NetskopeClient", return_value=_sync_client(groups, error)), \
                patch.object(netskope_sync, "record_device_snapshots", AsyncMock()), \
                patch.object(netskope_sync, "sync_inventory_snapshot", inventory):
            result = await netskope_sync.sync_netskope_inventory(MagicMock(), uuid4())
        return result, inventory

    async def test_a_complete_read_is_stored_and_reconciled(self):
        result, inventory = await self.run_sync(GROUPS)
        objects = inventory.await_args.args[1]
        self.assertEqual({o.source_id for o in objects if o.object_type == "netskope_policy_group"}, {"1", "9"})
        self.assertIn("netskope_policy_group", inventory.await_args.kwargs["reconcile_object_types"])
        self.assertEqual(result["policy_groups"], 2)
        self.assertNotIn("run_partial", result)

    async def test_a_failed_or_invalid_read_keeps_the_stored_groups_and_marks_the_run_partial(self):
        for groups, error in (([], NetskopeError("boom")), ([{"group_id": 1}], None)):
            with self.subTest(error=bool(error)):
                result, inventory = await self.run_sync(groups, error=error)
                self.assertNotIn("netskope_policy_group", inventory.await_args.kwargs["reconcile_object_types"])
                self.assertFalse([o for o in inventory.await_args.args[1] if o.object_type == "netskope_policy_group"])
                self.assertEqual((result["policy_groups_error"], result["run_partial"]), (1, 1))

    async def test_without_the_approved_route_nothing_is_requested(self):
        result, inventory = await self.run_sync(GROUPS, path="")
        self.assertNotIn("netskope_policy_group", inventory.await_args.kwargs["reconcile_object_types"])
        self.assertNotIn("policy_groups", result)


class PolicyGroupRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_netskope_readers_list_the_groups_and_other_roles_cannot(self):
        now = datetime.now(timezone.utc)
        listing = AsyncMock(return_value={"rows": [{"id": "1", "name": "Header Policies", "group_type": "default",
                                                    "can_be_edited_deleted": False, "first_seen_at": now, "last_seen_at": now}],
                                          "total": 1, "last_observed_at": now})
        self.session.set_permissions(["inventory:read", "netskope:read"])
        with patch(ROUTES + "list_netskope_policy_groups", new=listing), patch(ROUTES + "netskope_policy_groups_configured", return_value=True):
            allowed = await self.client.get("/api/cmdb/netskope/policy-groups")
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.json()["rows"][0]["name"], "Header Policies")
        self.assertTrue(allowed.json()["configured"])
        self.assertNotIn("modify", allowed.text)
        self.session.set_permissions(["inventory:read"])
        listing.reset_mock()
        with patch(ROUTES + "list_netskope_policy_groups", new=listing):
            denied = await self.client.get("/api/cmdb/netskope/policy-groups")
        self.assertEqual(denied.status_code, 403)
        listing.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
