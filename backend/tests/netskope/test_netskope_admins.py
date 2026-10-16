"""NSK-RBAC-001: Netskope administrators and roles -- client, allowlist, optional sync layer and strict read routes."""

import asyncio
import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx

from app.netskope.sse import netskope_sync
from app.netskope.sse.integrations.netskope import (
    RBAC_ADMINS_PATH, RBAC_PAGEMAPPING_PATH, RBAC_ROLES_PATH, NetskopeClient, NetskopeError, NetskopeNotConfigured,
    NetskopeSettings, netskope_rbac_configured,
)
from app.netskope.sse.services.netskope_rbac_mapping import ADMIN_EXTENSION, map_admin_roles, map_admins, map_api_groups
from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app
from tests.netskope.test_netskope_sync import _client

ROLES = [
    {"roleId": 10, "name": "Tenant Admin", "type": 0, "userCount": 1, "lastEdited": "2026-01-01",
     "createdBy": "creator@example.test", "updatedBy": "editor@example.test", "scoped": 0, "obfuscated": 0},
    {"roleId": 11, "name": "Reader", "type": 1, "userCount": 0, "lastEdited": "2026-02-01"},
    {"roleId": -9, "name": "Security analyst", "type": 1, "userCount": 1},
]
DETAILS = {
    10: {"roleId": 10, "apiGroups": [
        {"apiGroupId": 1, "apiGroupName": "admins", "permission": "rwa", "obfuscations": [], "constraints": []},
        {"apiGroupId": 2, "apiGroupName": "devices", "permission": "none"},
    ], "ipAllowList": {"ipList": ["203.0.113.7"], "enableIpAllowList": True}},
    11: {"roleId": 11, "apiGroups": [{"apiGroupId": 2, "apiGroupName": "devices", "permission": "r"}]},
    -9: {"roleId": -9, "apiGroups": [{"apiGroupId": 2, "apiGroupName": "devices", "permission": "r"}]},
}
ADMINS = [
    {"id": "a1", "userName": "alice@example.test", "active": True, "externalId": None,
     ADMIN_EXTENSION: {"recordType": "USER", "lastLogin": "2026-10-01", "isLocked": False, "mfa": {"enabled": True, "configs": []},
                       "role": {"value": 10, "display": "Tenant Admin"}, "samlAssertedRoleId": 99,
                       "apiAccessToken": {"token": "SECRET-TOKEN-VALUE"}, "authType": "API_KEY"}},
    {"id": "a2", "userName": "svc@example.test", "active": False,
     ADMIN_EXTENSION: {"recordType": "SERVICE_ACCOUNT", "role": {"value": 404, "display": "Gone"}}},
    {"id": "a3", "userName": "bob@example.test", "active": True, "metadata": {}, ADMIN_EXTENSION: {"recordType": "USER"}},
    {"id": "a4", "userName": "dana@example.test", "active": True, ADMIN_EXTENSION: {"recordType": "USER", "role": {"value": -9, "display": "Security analyst"}}},
]
PAGES = [
    {"v3_api_group_id": 1, "v3_api_group_name": "admins", "v2_page_name": "Administrators", "v2_parent_page_name": "Settings"},
    {"v3_api_group_id": 1, "v3_api_group_name": "admins", "v2_page_name": "Roles", "v2_parent_page_name": "Settings"},
    {"v3_api_group_id": 2, "v3_api_group_name": "devices", "v2_page_name": "Devices", "v2_parent_page_name": ""},
]
ROUTES = "app.netskope.sse.api.routes.netskope_admins."


def settings(**overrides):
    values = dict(
        base_url="https://tenant.goskope.com", api_token="secret-token",
        device_status_path="/api/v2/events/datasearch/clientstatus", users_path="/api/v2/users/getusers",
        user_counts_path="/api/v2/users/counts", rbac_path=RBAC_ROLES_PATH, page_delay_seconds=0,
    )
    return NetskopeSettings(**{**values, **overrides})


class RbacClientTests(unittest.TestCase):
    def call(self, method, handler, *args, **overrides):
        async def exercise():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                async with NetskopeClient(settings(**overrides), http) as netskope:
                    return await getattr(netskope, method)(*args)
        return asyncio.run(exercise())

    def test_roles_are_requested_with_a_limit_because_the_default_page_truncates(self):
        seen = []

        def handler(request):
            seen.append((request.method, request.url.path, request.url.params.get("limit")))
            return httpx.Response(200, json={"count": len(ROLES), "roles": ROLES})
        self.assertEqual(len(self.call("get_admin_roles", handler)), len(ROLES))
        self.assertEqual(seen, [("GET", RBAC_ROLES_PATH, "100")])

    def test_a_short_roles_read_is_refused_so_it_cannot_retire_roles(self):
        # The tenant answered 25 rows while `count` said 32 before `limit` was sent.
        for label, payload in {
            "short": {"count": 32, "roles": ROLES},
            "no count": {"roles": ROLES},
            "empty": {"count": 0, "roles": []},
            "bad item": {"count": 1, "roles": ["Tenant Admin"]},
            "not a list": {"count": 1, "roles": {"roleId": 1}},
        }.items():
            with self.subTest(label), self.assertRaises(NetskopeError):
                self.call("get_admin_roles", lambda _request, payload=payload: httpx.Response(200, json=payload))

    def test_predefined_roles_have_negative_ids_and_are_read_like_any_other(self):
        # The tenant's 16 predefined roles use ids -17..-1; rejecting them made the whole layer fail.
        seen = []
        detail = {"roleId": -9, "apiGroups": []}

        def handler(request):
            seen.append(request.url.path)
            return httpx.Response(200, json=detail)
        self.assertEqual(self.call("get_admin_role_detail", handler, -9)["roleId"], -9)
        self.assertEqual(seen, [f"{RBAC_ROLES_PATH}/-9"])

    def test_role_detail_must_be_the_requested_role(self):
        self.assertEqual(self.call("get_admin_role_detail", lambda _r: httpx.Response(200, json=DETAILS[10]), 10)["roleId"], 10)
        with self.assertRaises(NetskopeError):
            self.call("get_admin_role_detail", lambda _r: httpx.Response(200, json=DETAILS[11]), 10)
        with self.assertRaises(NetskopeError):
            self.call("get_admin_role_detail", lambda _r: httpx.Response(200, json={"roleId": 10}), 10)
        with self.assertRaises(NetskopeError):
            self.call("get_admin_role_detail", lambda _r: httpx.Response(200, json={}), True)

    def test_admins_page_with_startindex_and_count_until_total_results(self):
        starts = []
        everyone = [{"id": f"a{i}", "userName": f"u{i}"} for i in range(5)]

        def handler(request):
            start = int(request.url.params["startIndex"])
            starts.append((request.url.path, start, request.url.params["count"]))
            return httpx.Response(200, json={"totalResults": 5, "Resources": everyone[start - 1:start + 1]})
        self.assertEqual(len(self.call("get_admin_users", handler)), 5)
        self.assertEqual([entry[1] for entry in starts], [1, 3, 5])
        self.assertEqual({entry[0] for entry in starts}, {RBAC_ADMINS_PATH})

    def test_incomplete_or_inconsistent_admin_reads_are_refused(self):
        for label, handler in {
            "no total": lambda _r: httpx.Response(200, json={"Resources": [{"id": "a", "userName": "u"}]}),
            "empty page before the total": lambda _r: httpx.Response(200, json={"totalResults": 3, "Resources": []}),
            "empty tenant": lambda _r: httpx.Response(200, json={"totalResults": 0, "Resources": []}),
            "bad item": lambda _r: httpx.Response(200, json={"totalResults": 1, "Resources": ["a"]}),
        }.items():
            with self.subTest(label), self.assertRaises(NetskopeError):
                self.call("get_admin_users", handler)

    def test_page_map_must_be_a_non_empty_list_of_objects(self):
        self.assertEqual(len(self.call("get_api_group_pages", lambda _r: httpx.Response(200, json=PAGES))), 3)
        for payload in ([], {"a": 1}, ["x"]):
            with self.subTest(payload=payload), self.assertRaises(NetskopeError):
                self.call("get_api_group_pages", lambda _r, payload=payload: httpx.Response(200, json=payload))

    def test_only_the_approved_route_is_ever_called(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(netskope_rbac_configured())
        with patch.dict("os.environ", {"NETSKOPE_RBAC_PATH": "/api/v2/rbac/labels"}, clear=True):
            self.assertFalse(netskope_rbac_configured())
        with patch.dict("os.environ", {"NETSKOPE_RBAC_PATH": RBAC_ROLES_PATH}, clear=True):
            self.assertTrue(netskope_rbac_configured())
        calls = []
        for method in ("get_admin_roles", "get_admin_users", "get_api_group_pages"):
            with self.subTest(method), self.assertRaises(NetskopeNotConfigured):
                self.call(method, lambda request: calls.append(request) or httpx.Response(200, json={}), rbac_path="")
        self.assertEqual(calls, [])
        self.assertEqual(RBAC_PAGEMAPPING_PATH, "/api/v2/rbac/apigroups/pagemapping")


class RbacMappingTests(unittest.TestCase):
    def test_roles_keep_only_the_allowlist_and_non_none_permissions(self):
        roles = map_admin_roles(ROLES, DETAILS)
        self.assertEqual([(o.object_type, o.source_id, o.display_name, o.source_system) for o in roles],
                         [("netskope_role", "10", "Tenant Admin", "netskope"), ("netskope_role", "11", "Reader", "netskope"),
                          ("netskope_role", "-9", "Security analyst", "netskope")])
        self.assertEqual(roles[0].attributes, {
            "permissions": [{"id": 1, "name": "admins", "permission": "rwa"}], "api_groups_total": 2,
            "role_type": 0, "user_count": 1, "last_edited": "2026-01-01",
        })
        for forbidden in ("creator@example.test", "editor@example.test", "203.0.113.7"):
            self.assertNotIn(forbidden, repr(roles))

    def test_roles_abort_instead_of_dropping_or_inventing_a_role(self):
        for roles, details in (
            ([{"name": "x"}], {}), ([{"roleId": 1}], {}), ([{"roleId": True, "name": "x"}], {}),
            ([{"roleId": 10, "name": "a"}, {"roleId": 10, "name": "b"}], DETAILS),
            ([{"roleId": 10, "name": "a"}], {}),
            ([{"roleId": 10, "name": "a"}], {10: {"apiGroups": [{"apiGroupId": 1, "apiGroupName": "x"}]}}),
        ):
            with self.subTest(roles=roles), self.assertRaises(ValueError):
                map_admin_roles(roles, details)

    def test_admins_never_carry_the_api_token_or_the_saml_role_and_link_only_by_role_value(self):
        objects, relationships, unresolved = map_admins(ADMINS, {"10", "11", "-9"})
        self.assertEqual([(o.object_type, o.source_id, o.display_name) for o in objects],
                         [("netskope_admin", "a1", "alice@example.test"), ("netskope_admin", "a2", "svc@example.test"),
                          ("netskope_admin", "a3", "bob@example.test"), ("netskope_admin", "a4", "dana@example.test")])
        self.assertEqual(objects[0].attributes, {
            "active": True, "is_locked": False, "record_type": "USER", "last_login": "2026-10-01",
            "mfa_enabled": True, "role_id": 10,
        })
        self.assertEqual(objects[2].attributes, {"active": True, "record_type": "USER"})
        for secret in ("SECRET-TOKEN-VALUE", "apiAccessToken", "samlAsserted", "API_KEY"):
            self.assertNotIn(secret, repr(objects))
        self.assertEqual([(r.source_id, r.target_id, r.relationship_type) for r in relationships], [("a1", "10", "has_role"), ("a4", "-9", "has_role")])
        self.assertEqual(unresolved, 1)  # a2 references role 404, which is not listed

    def test_admins_abort_on_missing_or_duplicate_identity(self):
        for bad in ([{"userName": "x"}], [{"id": "a"}], [{"id": "a", "userName": "x"}, {"id": "a", "userName": "y"}]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                map_admins(bad, set())

    def test_api_groups_merge_their_pages(self):
        groups = map_api_groups(PAGES)
        self.assertEqual([(g.source_id, g.display_name) for g in groups], [("1", "admins"), ("2", "devices")])
        self.assertEqual(groups[0].attributes["pages"], [
            {"page": "Administrators", "parent": "Settings"}, {"page": "Roles", "parent": "Settings"},
        ])
        for bad in ([{"v3_api_group_name": "x"}], [{"v3_api_group_id": 1}],
                    [{"v3_api_group_id": 1, "v3_api_group_name": "a"}, {"v3_api_group_id": 1, "v3_api_group_name": "b"}]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                map_api_groups(bad)


def _sync_client(*, roles=ROLES, details=DETAILS, admins=ADMINS, pages=PAGES, error=None):
    context = _client([])
    client = context.__aenter__.return_value
    client.get_admin_roles = AsyncMock(return_value=roles, side_effect=error)
    client.get_admin_role_detail = AsyncMock(side_effect=lambda role_id: details[role_id])
    client.get_admin_users = AsyncMock(return_value=admins)
    client.get_api_group_pages = AsyncMock(return_value=pages)
    return context


class RbacSyncTests(unittest.IsolatedAsyncioTestCase):
    async def run_sync(self, *, path=RBAC_ROLES_PATH, **client_kwargs):
        configured = MagicMock(dem_sites_path="", alert_path="", groups_path="", policy_groups_path="", rbac_path=path,
                               page_delay_seconds=0)
        inventory = AsyncMock(return_value={"objects": 3})
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=configured), \
                patch.object(netskope_sync, "NetskopeClient", return_value=_sync_client(**client_kwargs)), \
                patch.object(netskope_sync, "record_device_snapshots", AsyncMock()), \
                patch.object(netskope_sync, "sync_inventory_snapshot", inventory):
            result = await netskope_sync.sync_netskope_inventory(MagicMock(), uuid4())
        return result, inventory

    async def test_a_complete_read_is_stored_and_reconciled_with_its_edges(self):
        result, inventory = await self.run_sync()
        objects, relationships = inventory.await_args.args[1], inventory.await_args.args[2]
        self.assertEqual({o.object_type for o in objects} & {"netskope_role", "netskope_admin", "netskope_api_group"},
                         {"netskope_role", "netskope_admin", "netskope_api_group"})
        self.assertEqual([(r.source_id, r.target_id) for r in relationships if r.relationship_type == "has_role"], [("a1", "10"), ("a4", "-9")])
        reconciled = inventory.await_args.kwargs["reconcile_object_types"]
        self.assertTrue({"netskope_role", "netskope_admin", "netskope_api_group"} <= reconciled)
        self.assertIn("has_role", inventory.await_args.kwargs["reconcile_relationship_types"])
        self.assertEqual((result["admin_roles"], result["admins"], result["api_groups"], result["admin_unresolved_roles"]), (3, 4, 2, 1))
        self.assertNotIn("run_partial", result)

    async def test_a_failed_or_invalid_read_keeps_what_is_stored_and_marks_the_run_partial(self):
        bad_admins = [{"userName": "no-id"}]
        for label, kwargs in {"api error": {"error": NetskopeError("boom")}, "invalid admins": {"admins": bad_admins}}.items():
            with self.subTest(label):
                result, inventory = await self.run_sync(**kwargs)
                reconciled = inventory.await_args.kwargs["reconcile_object_types"]
                self.assertFalse({"netskope_role", "netskope_admin", "netskope_api_group"} & reconciled)
                self.assertNotIn("has_role", inventory.await_args.kwargs["reconcile_relationship_types"])
                self.assertFalse([o for o in inventory.await_args.args[1] if o.object_type.startswith("netskope_a")
                                  or o.object_type == "netskope_role"])
                self.assertEqual((result["rbac_error"], result["run_partial"]), (1, 1))

    async def test_without_the_approved_route_nothing_is_requested(self):
        result, inventory = await self.run_sync(path="")
        self.assertNotIn("netskope_role", inventory.await_args.kwargs["reconcile_object_types"])
        self.assertNotIn("admins", result)


class RbacRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()
        self.audit = self.stack.enter_context(patch(ROUTES + "record_audit", new=AsyncMock()))

    def listing(self):
        now = datetime.now(timezone.utc)
        return {
            "rows": [{"id": "a1", "name": "alice@example.test", "active": True, "is_locked": False, "record_type": "USER",
                      "last_login": "2026-10-01", "mfa_enabled": True, "role_id": "10", "role_name": "Tenant Admin"}],
            "total": 3, "filtered_total": 1, "active": 2, "active_without_role": 1, "service_accounts": 1,
            "active_people_without_mfa": 1, "last_observed_at": now,
        }

    async def test_only_the_strict_permission_opens_the_admin_routes(self):
        listing = AsyncMock(return_value=self.listing())
        roles = AsyncMock(return_value={"rows": [], "total": 0, "last_observed_at": None})
        detail = AsyncMock(return_value=None)
        urls = ("/api/cmdb/netskope/admins", "/api/cmdb/netskope/admin-roles", "/api/cmdb/netskope/admin-roles/10")
        with patch(ROUTES + "list_netskope_admins", new=listing), patch(ROUTES + "list_netskope_admin_roles", new=roles), \
                patch(ROUTES + "get_netskope_admin_role", new=detail):
            for permissions in (["inventory:read", "netskope:read", "access:manage"], ["inventory:read"]):
                self.session.set_permissions(permissions)
                for url in urls:
                    with self.subTest(permissions=permissions, url=url):
                        self.assertEqual((await self.client.get(url)).status_code, 403)
            listing.assert_not_awaited()
            roles.assert_not_awaited()
            detail.assert_not_awaited()
            self.session.set_permissions(["inventory:read", "netskope:admin_inventory_read"])
            self.assertEqual((await self.client.get(urls[0])).status_code, 200)
            self.assertEqual((await self.client.get(urls[1])).status_code, 200)
            self.assertEqual((await self.client.get(urls[2])).status_code, 404)

    async def test_the_list_returns_rows_and_summary_and_audits_without_values(self):
        self.session.set_permissions(["inventory:read", "netskope:admin_inventory_read"])
        with patch(ROUTES + "list_netskope_admins", new=AsyncMock(return_value=self.listing())), \
                patch(ROUTES + "netskope_rbac_configured", return_value=True):
            response = await self.client.get("/api/cmdb/netskope/admins?search=alice&state=active&role=none")
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual((body["rows"][0]["name"], body["active_without_role"], body["configured"]),
                         ("alice@example.test", 1, True))
        details = self.audit.await_args.kwargs["after_data"]
        self.assertEqual(details["role"], "none")
        self.assertNotIn("alice", repr(details))

    async def test_predefined_roles_with_negative_ids_are_reachable_through_the_routes(self):
        self.session.set_permissions(["inventory:read", "netskope:admin_inventory_read"])
        detail = {"id": "-9", "name": "Security analyst", "last_edited": None, "api_groups_total": 1, "permissions": [], "admins": []}
        listing = AsyncMock(return_value=self.listing())
        with patch(ROUTES + "get_netskope_admin_role", new=AsyncMock(return_value=detail)) as one, \
                patch(ROUTES + "list_netskope_admins", new=listing):
            self.assertEqual((await self.client.get("/api/cmdb/netskope/admin-roles/-9")).status_code, 200)
            self.assertEqual((await self.client.get("/api/cmdb/netskope/admins?role=-9")).status_code, 200)
        one.assert_awaited_once()
        self.assertEqual(listing.await_args.args[4], "-9")

    async def test_bad_filters_are_rejected_before_any_query(self):
        self.session.set_permissions(["inventory:read", "netskope:admin_inventory_read"])
        listing = AsyncMock(return_value=self.listing())
        with patch(ROUTES + "list_netskope_admins", new=listing):
            for query in ("record_type=ROOT", "state=maybe", "role=abc", "role=1;DROP"):
                with self.subTest(query=query):
                    self.assertEqual((await self.client.get(f"/api/cmdb/netskope/admins?{query}")).status_code, 422)
        listing.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
