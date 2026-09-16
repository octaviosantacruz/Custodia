import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.pam_role_queries import get_pam_role_detail, list_pam_roles


class PamRoleQueriesTests(unittest.TestCase):
    def test_lists_roles_with_verified_pam_counts(self):
        rows = [{
            "object_id": 7,
            "display_name": "Operations",
            "source_id": "42",
            "attributes": {},
            "member_count": 3,
            "safe_count": 5,
            "account_count": 12,
            "total_count": 1,
        }]
        with patch("app.repositories.pam_role_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_pam_roles(object(), "ops", 50, 0))

        self.assertEqual(result["rows"][0]["display_name"], "Operations")
        self.assertEqual(result["total"], 1)
        query = fetch_all.await_args.args[1]
        self.assertIn("source_system = 'cyberark'", query)
        self.assertIn("user_has_role", query)
        self.assertIn("role_grants_access", query)
        self.assertIn("cyberark_accounts", query)
        self.assertEqual(fetch_all.await_args.args[2][-2:], (50, 0))

    def test_role_detail_keeps_sia_name_reference_explicitly_separate(self):
        role = {
            "object_id": 7,
            "display_name": "Operations",
            "source_id": "42",
            "attributes": {},
            "first_seen_at": "2026-08-01T00:00:00Z",
            "last_seen_at": "2026-08-29T00:00:00Z",
        }
        users = [{"object_id": 8, "display_name": "Ada", "source_id": "u-8"}]
        safes = [{"object_id": 9, "display_name": "Finance", "source_id": "FIN", "account_count": 2}]
        sia_refs = [{"object_id": 20, "display_name": "Finance access", "source_id": "p-20", "attributes": {}}]
        with patch("app.repositories.pam_role_queries.fetch_one", new=AsyncMock(return_value=role)), \
             patch("app.repositories.pam_role_queries.fetch_all", new=AsyncMock(side_effect=[users, safes, sia_refs])):
            result = asyncio.run(get_pam_role_detail(object(), 7))

        self.assertEqual(result["role"], role)
        self.assertEqual(result["users"], users)
        self.assertEqual(result["safes"], safes)
        self.assertEqual(result["sia_references"], sia_refs)
        self.assertEqual(result["sia_match_type"], "display_name_reference_only")

    def test_role_list_classifies_email_and_okta_group_names_without_cross_source_joins(self):
        for kind, expected_fragment in (
            ("user", "o.object_type = 'user'"),
            ("okta_group", "o.object_type = 'role'"),
            ("cyberark_role", "o.object_type = 'role'"),
        ):
            rows = [{"object_id": 7, "display_name": "Operations", "source_id": "42", "attributes": {}, "member_count": 0, "safe_count": 0, "account_count": 0, "total_count": 1}]
            with patch("app.repositories.pam_role_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
                result = asyncio.run(list_pam_roles(object(), "", 50, 0, kind))

            query = fetch_all.await_args.args[1]
            self.assertIn(expected_fragment, query)
            self.assertIn("o.source_system = 'cyberark'", query)
            self.assertEqual(result["kind"], kind)

    def test_user_filter_excludes_scim_and_role_objects(self):
        rows = [{"object_id": 8, "display_name": "alberto@itti.digital", "source_id": "u-8", "attributes": {}, "member_count": 0, "safe_count": 0, "account_count": 0, "sia_reference_count": 0, "total_count": 1}]
        with patch("app.repositories.pam_role_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_pam_roles(object(), "", 50, 0, "user"))

        query = fetch_all.await_args.args[1]
        self.assertIn("o.object_type = 'user'", query)
        self.assertIn("source_system = 'cyberark'", query)
        self.assertNotIn("identity_administration", query)
        self.assertEqual(result["rows"][0]["display_name"], "alberto@itti.digital")

    def test_role_list_can_exclude_roles_without_visible_safes(self):
        rows = [{"object_id": 7, "display_name": "Operations", "source_id": "42", "attributes": {}, "member_count": 0, "safe_count": 1, "account_count": 0, "sia_reference_count": 0, "total_count": 1}]
        with patch("app.repositories.pam_role_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            asyncio.run(list_pam_roles(object(), "", 50, 0, "cyberark_role", include_internal=False))

        query = fetch_all.await_args.args[1]
        self.assertIn("visible_meta.inventory_scope", query)
        self.assertIn("visible_meta.account_type_classification", query)
        self.assertIn("safe_meta.inventory_scope", query)

    def test_user_rows_include_linked_role_examples(self):
        rows = [{
            "object_id": 8, "display_name": "alberto@itti.digital", "source_id": "u-8",
            "attributes": {}, "member_count": 2, "safe_count": 1, "account_count": 3,
            "sia_reference_count": 0, "role_examples": [{"object_id": 7, "display_name": "Operations", "source_id": "42"}],
            "total_count": 1,
        }]
        with patch("app.repositories.pam_role_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_pam_roles(object(), "", 50, 0, "user"))

        self.assertEqual(result["rows"][0]["role_examples"][0]["display_name"], "Operations")
        self.assertIn("jsonb_build_object", fetch_all.await_args.args[1])


if __name__ == "__main__":
    unittest.main()
