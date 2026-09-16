import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.identity_pam_bridge import (
    annotate_identity_standard_seats,
    get_identity_user_pam_chain,
    list_standard_seat_source_ids,
)
from app.repositories.pam_chain_queries import build_pam_chain


class IdentityPamBridgeGraphTests(unittest.TestCase):
    def test_keeps_safe_counts_unique_and_exposes_platform_path(self):
        pam_user = {"display_name": "Ada", "source_id": "identity-1"}
        rows = [
            {
                "role_object_id": 2, "role_name": "Operators", "role_source_id": "2",
                "safe_object_id": 3, "safe_name": "Finance", "safe_number": "FIN", "account_count": 4,
                "platform_object_id": 4, "platform_name": "Unix", "platform_source_id": "Unix",
                "psm_object_id": 5, "psm_name": "PSM-01", "psm_source_id": "psm-1",
            },
            {
                "role_object_id": 2, "role_name": "Operators", "role_source_id": "2",
                "safe_object_id": 3, "safe_name": "Finance", "safe_number": "FIN", "account_count": 4,
                "platform_object_id": 6, "platform_name": "Windows", "platform_source_id": "Windows",
                "psm_object_id": 7, "psm_name": "PSM-02", "psm_source_id": "psm-2",
            },
        ]
        result = build_pam_chain({"object_id": 1, **pam_user}, rows)

        self.assertTrue(result["matched"])
        self.assertEqual(result["totals"], {"roles": 1, "safes": 1, "platforms": 2, "psms": 2, "accounts": 4})
        safe = result["roles"][0]["safes"][0]
        self.assertEqual(safe["platform_count"], 2)
        self.assertEqual([item["display_name"] for item in safe["platforms"]], ["Unix", "Windows"])
        self.assertEqual([item["display_name"] for item in safe["platforms"][0]["psms"]], ["PSM-01"])

    def test_bridge_delegates_after_exact_uuid_match_with_preview_limits(self):
        pam_user = {"object_id": 1, "display_name": "Ada", "source_id": "identity-1"}
        expected = {"matched": True}
        with patch("app.repositories.identity_pam_bridge.fetch_one", new=AsyncMock(return_value=pam_user)) as fetch_one, \
             patch("app.repositories.identity_pam_bridge.get_pam_chain_for_user", new=AsyncMock(return_value=expected)) as chain:
            result = asyncio.run(get_identity_user_pam_chain(object(), "identity-1"))

        self.assertEqual(result, expected)
        self.assertEqual(fetch_one.await_args.args[2], ("cyberark", "identity-1"))
        self.assertEqual(chain.await_args.kwargs, {"role_limit": 25, "safe_limit": 6, "platform_limit": 4})

    def test_annotates_identity_rows_by_exact_pam_source_id(self):
        rows = [
            {"object_id": 1, "display_name": "Ada", "source_id": "uuid-ada"},
            {"object_id": 2, "display_name": "Other", "source_id": "uuid-other"},
        ]
        with patch("app.repositories.identity_pam_bridge.fetch_all", new=AsyncMock(return_value=[{"source_id": "uuid-ada"}])) as fetch_all:
            result = asyncio.run(annotate_identity_standard_seats(object(), rows))

        self.assertTrue(result[0]["standard_seat_reconciled"])
        self.assertFalse(result[1]["standard_seat_reconciled"])
        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertIn("u.source_id = ANY(%s)", query)
        self.assertIn("u.source_system = %s", query)
        self.assertEqual(params[0], "cyberark")
        self.assertEqual(params[1], ["uuid-ada", "uuid-other"])
        self.assertNotIn("email", query)
        self.assertNotIn("u.display_name", query)

    def test_lists_standard_seat_source_ids_from_pam_only(self):
        with patch("app.repositories.identity_pam_bridge.fetch_all", new=AsyncMock(return_value=[{"source_id": "uuid-ada"}])) as fetch_all:
            result = asyncio.run(list_standard_seat_source_ids(object()))

        self.assertEqual(result, ["uuid-ada"])
        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertEqual(params, ("cyberark",))
        self.assertIn("Privilege Cloud Administrators", query)
        self.assertNotIn("identity_administration", query)


if __name__ == "__main__":
    unittest.main()
