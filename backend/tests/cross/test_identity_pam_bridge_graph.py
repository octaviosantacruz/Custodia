import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.cross.repositories.identity_pam_bridge import (
    annotate_identity_standard_seats,
    get_identity_user_pam_chain,
    list_standard_seat_emails,
)
from app.cyberark.pam.repositories.pam_chain_queries import build_pam_chain


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
        with patch("app.cross.repositories.identity_pam_bridge.fetch_one", new=AsyncMock(return_value=pam_user)) as fetch_one, \
             patch("app.cross.repositories.identity_pam_bridge.get_pam_chain_for_user", new=AsyncMock(return_value=expected)) as chain:
            result = asyncio.run(get_identity_user_pam_chain(object(), "identity-1", "ada@example.com"))

        self.assertEqual(result, {"matched": True, "match_basis": "uuid", "status": "matched"})
        self.assertEqual(fetch_one.await_args.args[2], ("cyberark", "identity-1"))
        self.assertEqual(chain.await_args.kwargs, {"role_limit": 25, "safe_limit": 6, "platform_limit": 4})

    def test_bridge_falls_back_to_exact_email_when_uuid_does_not_match(self):
        pam_user = {"object_id": 9, "display_name": "Ada", "source_id": "ada@example.com"}
        with patch("app.cross.repositories.identity_pam_bridge.fetch_one", new=AsyncMock(side_effect=[None, {"total": 1}])), \
             patch("app.cross.repositories.identity_pam_bridge.fetch_all", new=AsyncMock(return_value=[pam_user])) as fetch_all, \
             patch("app.cross.repositories.identity_pam_bridge.get_pam_chain_for_user", new=AsyncMock(return_value={"matched": True})) as chain:
            result = asyncio.run(get_identity_user_pam_chain(object(), "uuid-1", "Ada@Example.com "))

        self.assertEqual(result["match_basis"], "email")
        self.assertEqual(result["status"], "matched")
        self.assertEqual(chain.await_args.args[1], pam_user)
        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertIn("lower(btrim(u.source_id)) = %s", query)
        self.assertIn("user_type", query)
        self.assertEqual(params, ("cyberark", "ada@example.com"))

    def test_bridge_email_ambiguity_never_draws_a_link(self):
        with patch("app.cross.repositories.identity_pam_bridge.fetch_one", new=AsyncMock(side_effect=[None, {"total": 1}])), \
             patch("app.cross.repositories.identity_pam_bridge.fetch_all", new=AsyncMock(return_value=[
                 {"object_id": 1, "display_name": "Ada", "source_id": "ada@example.com"},
                 {"object_id": 2, "display_name": "Ada 2", "source_id": "ada@example.com"},
             ])), \
             patch("app.cross.repositories.identity_pam_bridge.get_pam_chain_for_user", new=AsyncMock()) as chain:
            result = asyncio.run(get_identity_user_pam_chain(object(), "uuid-1", "ada@example.com"))

        self.assertEqual(result["match_basis"], "email")
        self.assertEqual(result["status"], "ambiguous")
        self.assertFalse(result["matched"])
        chain.assert_not_awaited()

    def test_bridge_email_is_ambiguous_when_another_identity_user_shares_it(self):
        """D3 checks 1-to-1 on both sides: the Identity side is verified first."""
        with patch("app.cross.repositories.identity_pam_bridge.fetch_one", new=AsyncMock(side_effect=[None, {"total": 2}])), \
             patch("app.cross.repositories.identity_pam_bridge.fetch_all", new=AsyncMock()) as fetch_all:
            result = asyncio.run(get_identity_user_pam_chain(object(), "uuid-1", "ada@example.com"))

        self.assertEqual(result["status"], "ambiguous")
        self.assertEqual(result["match_basis"], "email")
        self.assertFalse(result["matched"])
        fetch_all.assert_not_awaited()

    def test_zero_identity_users_with_that_email_is_not_ambiguous(self):
        """A count of 0 (retired Identity object or stored-email drift) must not
        be reported as ambiguous: it falls through to the PAM-side resolution
        instead of lying and hiding a valid link."""
        with patch("app.cross.repositories.identity_pam_bridge.fetch_one", new=AsyncMock(side_effect=[None, {"total": 0}])), \
             patch("app.cross.repositories.identity_pam_bridge.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            result = asyncio.run(get_identity_user_pam_chain(object(), "uuid-1", "ada@example.com"))

        self.assertEqual(result["status"], "unmatched")
        self.assertEqual(result["match_basis"], "email")
        self.assertFalse(result["matched"])
        fetch_all.assert_awaited_once()

    def test_zero_identity_users_still_links_a_unique_pam_email(self):
        """With no active Identity duplicate the PAM-side 1-to-1 rule decides,
        so a unique human PAM user is still linked."""
        pam_user = {"object_id": 9, "display_name": "Ada", "source_id": "ada@example.com"}
        with patch("app.cross.repositories.identity_pam_bridge.fetch_one", new=AsyncMock(side_effect=[None, {"total": 0}])), \
             patch("app.cross.repositories.identity_pam_bridge.fetch_all", new=AsyncMock(return_value=[pam_user])), \
             patch("app.cross.repositories.identity_pam_bridge.get_pam_chain_for_user", new=AsyncMock(return_value={"matched": True})) as chain:
            result = asyncio.run(get_identity_user_pam_chain(object(), "uuid-1", "ada@example.com"))

        self.assertEqual(result["status"], "matched")
        self.assertEqual(result["match_basis"], "email")
        self.assertTrue(result["matched"])
        chain.assert_awaited_once()

    def test_bridge_without_email_or_match_is_unmatched(self):
        with patch("app.cross.repositories.identity_pam_bridge.fetch_one", new=AsyncMock(return_value=None)):
            result = asyncio.run(get_identity_user_pam_chain(object(), "uuid-1", "sin-arroba"))
        self.assertIsNone(result["match_basis"])
        self.assertEqual(result["status"], "unmatched")
        self.assertFalse(result["matched"])

    def test_annotates_identity_rows_by_exact_unique_pam_email(self):
        rows = [
            {"object_id": 1, "display_name": "Ada", "source_id": "uuid-ada", "attributes": {"email": "Ada@example.com"}},
            {"object_id": 2, "display_name": "Other", "source_id": "uuid-other", "attributes": {"email": "other@example.com"}},
            {"object_id": 3, "display_name": "Seat", "source_id": "uuid-seat", "attributes": {"email": "seat@cyberark.cloud.23356"}},
        ]
        pam_seats = [{"email": "ada@example.com"}, {"email": "seat@cyberark.cloud.23356"}]
        with patch("app.cross.repositories.identity_pam_bridge.fetch_all", new=AsyncMock(return_value=pam_seats)) as fetch_all:
            result = asyncio.run(annotate_identity_standard_seats(object(), rows))

        self.assertTrue(result[0]["standard_seat_reconciled"])
        self.assertFalse(result[1]["standard_seat_reconciled"])
        # Standard seat keeps its own eligibility: the person allowlist of the
        # email bridge (which excludes cyberark.cloud.*) does not apply here.
        self.assertTrue(result[2]["standard_seat_reconciled"])
        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertIn("lower(btrim(u.display_name)) = ANY(%s)", query)
        self.assertIn("u.source_system = %s", query)
        self.assertEqual(params[0], "cyberark")
        self.assertEqual(params[1], ["ada@example.com", "other@example.com", "seat@cyberark.cloud.23356"])
        self.assertIn("HAVING count(*) = 1", query)

    def test_lists_unique_standard_seat_emails_from_pam_only(self):
        with patch("app.cross.repositories.identity_pam_bridge.fetch_all", new=AsyncMock(return_value=[{"email": "ada@example.com"}])) as fetch_all:
            result = asyncio.run(list_standard_seat_emails(object()))

        self.assertEqual(result, ["ada@example.com"])
        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertEqual(params, ("cyberark",))
        self.assertIn("Privilege Cloud Administrators", query)
        self.assertNotIn("identity_administration", query)


if __name__ == "__main__":
    unittest.main()
