"""REL-001 HTTP exposure follows independent source permissions."""

import os
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

# The HTTP harness imports app.main with a synthetic DATABASE_URL. Prevent a
# workstation's optional secret-file pointer from overriding that test URL.
os.environ.pop("DATABASE_PASSWORD_FILE", None)

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app


POLICY = {
    "object_id": 50,
    "display_name": "Policy 50",
    "source_id": "sia-50",
    "attributes": {
        "status": "Enabled", "description": "", "platforms": [], "rule_names": [],
        "policy_type": "policy", "granted_users": ["ada@example.test"],
        "granted_groups": [], "granted_roles": [], "ip_rules": [], "fqdn_rules": [],
        "logical_names": [],
    },
    "linked_safes": [], "linked_ip_count": 0, "linkage_status": "unlinked",
}


class SiaPersonLinksHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver",
        )
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()
        self.permission_lookup = self.stack.enter_context(patch(
            "app.cyberark.sia.api.routes.cmdb_sia.get_actor_permissions",
            new=AsyncMock(return_value=[]),
        ))

    async def test_list_and_detail_omit_unreadable_side_and_only_query_readable_sources(self):
        permissions = [
            (["inventory:read", "identity:catalogs_read"], {"identity"}),
            (["inventory:read", "pam:catalogs_read"], {"pam"}),
            (["inventory:read", "access:manage"], {"identity", "pam"}),
            (["inventory:read"], set()),
        ]
        for actor_permissions, expected_sides in permissions:
            with self.subTest(permissions=actor_permissions):
                self.session.set_permissions(actor_permissions)
                self.permission_lookup.return_value = actor_permissions
                list_query = AsyncMock(return_value={
                    "rows": [POLICY.copy()], "total": 1, "limit": 50, "offset": 0,
                    "search": "", "status_filter": "", "linkage_status": "",
                })
                detail_query = AsyncMock(return_value={**POLICY, "first_seen_at": "2026-10-01T00:00:00Z", "last_seen_at": "2026-10-01T00:00:00Z"})

                def candidate_rows(_pool, query, params):
                    source = params[0]
                    self.assertIn(source, ("identity_administration", "cyberark"))
                    if source == "identity_administration":
                        return [{"object_id": 71, "display_name": "Ada Identity", "email": "ada@example.test"}]
                    return [{"object_id": 72, "display_name": "Ada PAM", "email": "ada@example.test"}]

                fetch_candidates = AsyncMock(side_effect=candidate_rows)
                with patch("app.cyberark.sia.api.routes.cmdb_sia.list_sia_policies", new=list_query), \
                     patch("app.cyberark.sia.api.routes.cmdb_sia.get_sia_policy_detail", new=detail_query), \
                     patch("app.cross.repositories.sia_person_links.fetch_all", new=fetch_candidates):
                    listed = await self.client.get("/api/cmdb/sia-policies")
                    detailed = await self.client.get("/api/cmdb/sia-policies/50")

                self.assertEqual(listed.status_code, 200, listed.text)
                self.assertEqual(detailed.status_code, 200, detailed.text)
                for payload in (listed.json()["rows"][0], detailed.json()["policy"]):
                    link = payload["grantee_links"][0]
                    self.assertEqual(set(link) - {"value"}, expected_sides)
                    self.assertEqual(link["value"], "ada@example.test")
                self.assertEqual(fetch_candidates.await_count, 2 * len(expected_sides))


if __name__ == "__main__":
    unittest.main()
