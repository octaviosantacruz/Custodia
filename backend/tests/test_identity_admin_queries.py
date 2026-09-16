import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.identity_admin_queries import list_identity_federations, list_identity_roles, list_identity_users


class IdentityAdminRoleQueryTests(unittest.TestCase):
    def test_filters_okta_groups_by_declared_sg_cyberark_prefix(self):
        fetch_all = AsyncMock(return_value=[])

        with patch("app.repositories.identity_admin_queries.fetch_all", new=fetch_all):
            asyncio.run(list_identity_roles(object(), "", 50, 0, "okta_group"))

        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertIn("o.display_name ILIKE %s", query)
        self.assertEqual(query.count("%s"), len(params))
        self.assertEqual(query.count("%"), query.count("%s"))
        self.assertEqual(params, ("identity_administration", "sg_cyberark%", 50, 0))

    def test_excludes_okta_groups_from_identity_administration_roles(self):
        fetch_all = AsyncMock(return_value=[])

        with patch("app.repositories.identity_admin_queries.fetch_all", new=fetch_all):
            asyncio.run(list_identity_roles(object(), "", 50, 0, "role"))

        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertIn("o.display_name NOT ILIKE %s", query)
        self.assertEqual(query.count("%s"), len(params))
        self.assertEqual(query.count("%"), query.count("%s"))
        self.assertEqual(params, ("identity_administration", "sg_cyberark%", 50, 0))


class IdentityAdminUserQueryTests(unittest.TestCase):
    def test_filters_identity_users_by_exact_source_id_list(self):
        fetch_all = AsyncMock(return_value=[])

        with patch("app.repositories.identity_admin_queries.fetch_all", new=fetch_all):
            asyncio.run(list_identity_users(object(), "", 50, 0, "", ["uuid-1"], None))

        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertIn("o.source_id = ANY(%s)", query)
        self.assertNotIn("EPVUser", query)
        self.assertEqual(params[-3], ["uuid-1"])

    def test_excludes_identity_users_by_exact_source_id_list(self):
        fetch_all = AsyncMock(return_value=[])

        with patch("app.repositories.identity_admin_queries.fetch_all", new=fetch_all):
            asyncio.run(list_identity_users(object(), "", 50, 0, "", None, ["uuid-1"]))

        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertIn("NOT (o.source_id = ANY(%s))", query)
        self.assertEqual(params[-3], ["uuid-1"])


class IdentityFederationQueryTests(unittest.TestCase):
    def test_scopes_by_source_system_and_object_type(self):
        fetch_all = AsyncMock(return_value=[])

        with patch("app.repositories.identity_admin_queries.fetch_all", new=fetch_all):
            result = asyncio.run(list_identity_federations(object(), "", 50, 0))

        self.assertEqual(result["rows"], [])
        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertIn("source_system = %s", query)
        self.assertIn("object_type = 'identity_federation'", query)
        self.assertEqual(params, ("identity_administration", 50, 0))

    def test_applies_search_across_name_and_federation_type(self):
        fetch_all = AsyncMock(return_value=[])

        with patch("app.repositories.identity_admin_queries.fetch_all", new=fetch_all):
            asyncio.run(list_identity_federations(object(), "okta", 25, 10))

        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertIn("display_name ILIKE %s", query)
        self.assertIn("attributes->>'federation_type' ILIKE %s", query)
        self.assertEqual(params, ("identity_administration", "%okta%", "%okta%", 25, 10))


if __name__ == "__main__":
    unittest.main()
