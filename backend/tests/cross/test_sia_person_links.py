"""REL-001 exact-email resolution, per-source and set-based."""

import unittest
from unittest.mock import AsyncMock, patch

from app.cross.repositories.sia_person_links import resolve_sia_policy_grantees


class SiaPersonLinkRepositoryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.policy = {
            "object_id": 50,
            "attributes": {"granted_users": [
                " Ada@Example.test ", "ada@example.test", "ambig-identity@example.test",
                "ambig-pam@example.test", "missing@example.test",
                "service@cyberark.cloud.tenant", "Operator", "Operator",
            ]},
        }

    @patch("app.cross.repositories.sia_person_links.fetch_all", new_callable=AsyncMock)
    async def test_unique_ambiguous_missing_invalid_and_technical_values_are_resolved(self, fetch_all):
        fetch_all.side_effect = [
            [
                {"object_id": 1, "display_name": "Identity Ada", "email": "ada@example.test"},
                {"object_id": 2, "display_name": "Identity duplicate 1", "email": "ambig-identity@example.test"},
                {"object_id": 3, "display_name": "Identity duplicate 2", "email": "ambig-identity@example.test"},
                {"object_id": 4, "display_name": "Identity person", "email": "ambig-pam@example.test"},
            ],
            [
                {"object_id": 5, "display_name": "PAM Ada", "email": "ada@example.test"},
                {"object_id": 6, "display_name": "PAM person", "email": "ambig-identity@example.test"},
                {"object_id": 7, "display_name": "PAM duplicate 1", "email": "ambig-pam@example.test"},
                {"object_id": 8, "display_name": "PAM duplicate 2", "email": "ambig-pam@example.test"},
            ],
        ]

        result = await resolve_sia_policy_grantees(
            object(), [self.policy], readable_sides={"identity", "pam"},
        )
        links = {link["value"]: link for link in result[0]["grantee_links"]}

        self.assertEqual(len(links), 6, "email case/edge whitespace duplicates collapse; raw duplicates collapse")
        self.assertEqual(links[" Ada@Example.test "]["identity"], {
            "status": "matched", "match": {"object_id": 1, "display_name": "Identity Ada"},
        })
        self.assertEqual(links[" Ada@Example.test "]["pam"], {
            "status": "matched", "match": {"object_id": 5, "display_name": "PAM Ada"},
        })
        self.assertEqual(links["ambig-identity@example.test"]["identity"], {"status": "ambiguous"})
        self.assertEqual(links["ambig-identity@example.test"]["pam"]["status"], "matched")
        self.assertEqual(links["ambig-pam@example.test"]["pam"], {"status": "ambiguous"})
        self.assertEqual(links["ambig-pam@example.test"]["identity"]["status"], "matched")
        for value in (
            "missing@example.test", "service@cyberark.cloud.tenant", "Operator",
        ):
            self.assertEqual(links[value]["identity"], {"status": "unmatched"})
            self.assertEqual(links[value]["pam"], {"status": "unmatched"})

        self.assertEqual(fetch_all.await_count, 2, "one batch query per readable source")
        identity_query, identity_params = fetch_all.await_args_list[0].args[1:]
        pam_query, pam_params = fetch_all.await_args_list[1].args[1:]
        self.assertIn("source_system = %s AND o.object_type = 'user'", identity_query)
        self.assertIn("o.lifecycle_status = 'active'", identity_query)
        self.assertIn("lower(btrim(o.attributes->>'email'))", identity_query)
        self.assertIn("source_system = %s AND u.object_type = 'user'", pam_query)
        self.assertIn("u.lifecycle_status = 'active'", pam_query)
        self.assertIn("'EPVUser', 'ExtUser'", pam_query)
        self.assertIn("component_user", pam_query)
        self.assertIn("cyberark.cloud", pam_query)
        self.assertNotIn("service@cyberark.cloud.tenant", identity_params[1])
        self.assertNotIn("service@cyberark.cloud.tenant", pam_params[1])

    @patch("app.cross.repositories.sia_person_links.fetch_all", new_callable=AsyncMock)
    async def test_unreadable_sides_are_neither_queried_nor_returned(self, fetch_all):
        result = await resolve_sia_policy_grantees(
            object(), [self.policy], readable_sides=set(),
        )
        fetch_all.assert_not_awaited()
        self.assertTrue(result[0]["grantee_links"])
        self.assertTrue(all(set(link) == {"value"} for link in result[0]["grantee_links"]))

    @patch("app.cross.repositories.sia_person_links.fetch_all", new_callable=AsyncMock)
    async def test_each_side_can_be_read_without_querying_the_other(self, fetch_all):
        fetch_all.return_value = []
        for side, forbidden_alias in (("identity", "u."), ("pam", "o.")):
            with self.subTest(side=side):
                fetch_all.reset_mock()
                result = await resolve_sia_policy_grantees(
                    object(), [self.policy], readable_sides={side},
                )
                fetch_all.assert_awaited_once()
                query, params = fetch_all.await_args.args[1:]
                self.assertEqual(params[0], "identity_administration" if side == "identity" else "cyberark")
                self.assertNotIn(forbidden_alias, query)
                self.assertTrue(all(set(link) == {"value", side} for link in result[0]["grantee_links"]))


if __name__ == "__main__":
    unittest.main()
