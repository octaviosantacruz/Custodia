"""The group routes keep the Netskope read gate and the safe projection."""

import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app

ROUTES = "app.netskope.sse.api.routes.cmdb_netskope."


class NetskopeGroupsHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_netskope_reader_lists_groups_with_both_member_counts(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        now = datetime.now(timezone.utc)
        listing = AsyncMock(return_value={
            "rows": [{"id": "g1", "name": "Ops", "provisioner": "AD", "reported_members": None, "observed_members": 3,
                      "first_seen_at": now, "last_seen_at": now}],
            "total": 1, "last_observed_at": now,
        })
        with patch(ROUTES + "list_netskope_groups", new=listing), patch(ROUTES + "netskope_groups_configured", return_value=True):
            response = await self.client.get("/api/cmdb/netskope/groups", params={"q": " Ops ", "provisioner": " AD ", "limit": 10})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(listing.await_args.args[1:], ("Ops", "AD", 10, 0))
        row = response.json()["rows"][0]
        self.assertEqual((row["observed_members"], row["reported_members"]), (3, None))
        self.assertTrue(response.json()["configured"])

    async def test_members_of_an_unknown_group_are_404_and_known_ones_are_paged(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        members = AsyncMock(side_effect=[None, {"group": {"id": "g1", "name": "Ops"}, "rows": [{"id": "u1", "name": "Ana", "email": None}], "total": 1}])
        with patch(ROUTES + "list_netskope_group_members", new=members):
            missing = await self.client.get("/api/cmdb/netskope/groups/nope/members")
            found = await self.client.get("/api/cmdb/netskope/groups/g1/members", params={"limit": 5, "offset": 0})
        self.assertEqual((missing.status_code, found.status_code), (404, 200))
        self.assertEqual(found.json()["total"], 1)
        self.assertEqual(members.await_args.args[1:], ("g1", 5, 0))

    async def test_non_netskope_reader_cannot_open_groups(self):
        self.session.set_permissions(["inventory:read"])
        listing, members = AsyncMock(), AsyncMock()
        with patch(ROUTES + "list_netskope_groups", new=listing), patch(ROUTES + "list_netskope_group_members", new=members):
            denied = [await self.client.get("/api/cmdb/netskope/groups"), await self.client.get("/api/cmdb/netskope/groups/g1/members")]
        self.assertEqual([response.status_code for response in denied], [403, 403])
        listing.assert_not_awaited()
        members.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
