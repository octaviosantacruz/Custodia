import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.pam_chain_queries import (
    get_pam_user_chain, list_aim_applications, list_pam_components, list_pam_connectors,
    list_pam_platforms, list_pam_users, list_platform_catalogs, list_platform_targets, list_psm_connector_types,
)


class PamChainQueriesTests(unittest.TestCase):
    def test_lists_only_active_cyberark_users(self):
        rows = [{
            "object_id": 1,
            "display_name": "Ada",
            "source_id": "u-1",
            "role_count": 2,
            "total_count": 1,
        }]
        with patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_pam_users(object(), "ada", 50, 0))

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["rows"][0]["role_count"], 2)
        query = fetch_all.await_args.args[1]
        self.assertIn("u.source_system = 'cyberark'", query)
        self.assertIn("u.object_type = 'user'", query)
        self.assertIn("user_has_role", query)

    def test_filters_users_by_standard_seat_reconciliation(self):
        rows = [{
            "object_id": 1,
            "display_name": "Ada",
            "source_id": "u-1",
            "role_count": 2,
            "standard_seat_reconciled": True,
            "total_count": 1,
        }]
        with patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_pam_users(object(), "", 50, 0, standard_seat="reconciled"))

        self.assertTrue(result["rows"][0]["standard_seat_reconciled"])
        self.assertEqual(result["standard_seat"], "reconciled")
        query = fetch_all.await_args.args[1]
        self.assertIn("standard_seat_reconciled", query)
        self.assertIn("Privilege Cloud Administrators", query)

    def test_direct_chain_is_keyed_by_pam_object_id(self):
        pam_user = {"object_id": 1, "display_name": "Ada", "source_id": "u-1"}
        with patch("app.repositories.pam_chain_queries.fetch_one", new=AsyncMock(return_value=pam_user)) as fetch_one, \
             patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            result = asyncio.run(get_pam_user_chain(object(), 1))

        self.assertTrue(result["matched"])
        self.assertEqual(result["pam_user"]["object_id"], 1)
        self.assertEqual(fetch_one.await_args.args[2], (1,))
        query = fetch_all.await_args.args[1]
        for relationship in ("user_has_role", "role_grants_access", "safe_uses_platform", "platform_uses_psm"):
            self.assertIn(relationship, query)
        self.assertNotIn("source_system = 'sia'", query)

    def test_lists_active_pam_platforms_with_verified_context(self):
        rows = [{
            "object_id": 10,
            "display_name": "Unix",
            "source_id": "Unix",
            "system_type": "Unix",
            "active": True,
            "allowed_safes_pattern": "^Unix-",
            "safe_count": 2,
            "account_count": 5,
            "psms": [{"object_id": 11, "display_name": "PSM-01", "source_id": "psm-1"}],
            "total_count": 1,
        }]
        with patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_pam_platforms(object(), "unix", 50, 0))

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["rows"][0]["psms"][0]["display_name"], "PSM-01")
        self.assertEqual(result["rows"][0]["allowed_safes_pattern"], "^Unix-")
        query = fetch_all.await_args.args[1]
        self.assertIn("p.object_type = 'platform'", query)
        self.assertIn("(p.attributes->>'active')::boolean IS TRUE", query)
        self.assertIn("safe_uses_platform", query)
        self.assertIn("platform_uses_psm", query)
        self.assertNotIn("source_system = 'sia'", query)

    def test_lists_only_active_cyberark_psm_connectors(self):
        rows = [{
            "object_id": 11,
            "display_name": "PSM-01",
            "source_id": "psm-1",
            "platform_count": 1,
            "platforms": [{"object_id": 10, "display_name": "Unix", "source_id": "Unix"}],
            "total_count": 1,
        }]
        with patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_pam_connectors(object(), "psm", 50, 0))

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["rows"][0]["platforms"][0]["display_name"], "Unix")
        query = fetch_all.await_args.args[1]
        self.assertIn("psm.object_type = 'psm'", query)
        self.assertIn("platform_uses_psm", query)
        self.assertNotIn("source_system = 'sia'", query)

    def test_chain_excludes_internal_safes_and_accounts_when_requested(self):
        pam_user = {"object_id": 1, "display_name": "Ada", "source_id": "u-1"}
        with patch("app.repositories.pam_chain_queries.fetch_one", new=AsyncMock(return_value=pam_user)), \
             patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            asyncio.run(get_pam_user_chain(object(), 1, include_internal=False))

        query = fetch_all.await_args.args[1]
        self.assertIn("meta_scope.inventory_scope", query)
        self.assertIn("meta_scope.account_type_classification", query)
        self.assertIn("a.inventory_account_type", query)

    def test_missing_pam_user_returns_none(self):
        with patch("app.repositories.pam_chain_queries.fetch_one", new=AsyncMock(return_value=None)), \
             patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock()) as fetch_all:
            result = asyncio.run(get_pam_user_chain(object(), 404))

        self.assertIsNone(result)
        fetch_all.assert_not_awaited()

    def test_lists_users_filtered_by_suspended_status(self):
        rows = [{"object_id": 1, "display_name": "Ada", "source_id": "u-1", "role_count": 0, "enabled": True, "suspended": True, "total_count": 1}]
        with patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_pam_users(object(), "", 50, 0, status="suspended"))
        self.assertEqual(result["status"], "suspended")
        self.assertTrue(result["rows"][0]["suspended"])
        query = fetch_all.await_args.args[1]
        self.assertIn("suspended", query)

    def test_lists_platform_targets_with_dual_control_policy(self):
        rows = [{
            "object_id": 50, "display_name": "UENO_WIN_DOM_PROD_30", "source_id": "37",
            "platform_base_id": "WinDomain", "dual_control_required": True, "otp_required": False,
            "reason_required": True, "exclusive_access_required": False,
            "credentials_change_automatic": True, "credentials_change_interval_days": 90,
            "credentials_verify_automatic": True, "credentials_verify_interval_days": 7,
            "credentials_reconcile_automatic": False, "psm_server_id": "PSMServer_01", "total_count": 1,
        }]
        with patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_platform_targets(object(), "", 50, 0))
        self.assertEqual(result["total"], 1)
        self.assertTrue(result["rows"][0]["dual_control_required"])
        query = fetch_all.await_args.args[1]
        self.assertIn("platform_target", query)
        self.assertIn("dual_control_required", query)
        self.assertIn("source_system = 'cyberark'", query)
        self.assertEqual(result["rows"][0]["platform_base_id"], "WinDomain")

    def test_connectors_expose_psm_server_address(self):
        rows = [{"object_id": 11, "display_name": "PSM-01", "source_id": "psm-1", "address": "10.0.0.1", "platform_count": 0, "platforms": [], "total_count": 1}]
        with patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_pam_connectors(object(), "", 50, 0))
        self.assertEqual(result["rows"][0]["address"], "10.0.0.1")
        query = fetch_all.await_args.args[1]
        self.assertIn("address", query)

    def test_lists_psm_connector_type_catalog(self):
        rows = [{"object_id": 20, "display_name": "PSM-RDP", "source_id": "PSM-RDP", "total_count": 1}]
        with patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_psm_connector_types(object(), "", 50, 0))
        self.assertEqual(result["total"], 1)
        query = fetch_all.await_args.args[1]
        self.assertIn("psm_connector", query)
        self.assertNotIn("object_type = 'psm'", query.replace("psm_connector", ""))
        self.assertIn("source_system = 'cyberark'", query)

    def test_lists_component_health(self):
        rows = [{
            "object_id": 30, "display_name": "PVWA", "source_id": "PVWA", "description": "Portal",
            "total_count": 2, "connected_count": 1, "instance_versions": ["14.2"],
            "latest_logon_at": 1725900000, "all_instances_logged_on": False,
        }]
        with patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_pam_components(object()))
        self.assertEqual(result["rows"][0]["connected_count"], 1)
        query = fetch_all.await_args.args[1]
        self.assertIn("object_type = 'component'", query)
        self.assertIn("source_system = 'cyberark'", query)

    def test_lists_platform_catalogs_dependent_group_rotational(self):
        with patch(
            "app.repositories.pam_chain_queries.fetch_all",
            new=AsyncMock(side_effect=[
                [{"object_id": 1, "display_name": "Dep", "source_id": "D1", "platform_base_id": "Base", "platform_base_type": "group", "linked_target_platforms": 3}],
                [{"object_id": 2, "display_name": "Group", "source_id": "G1", "active": True}],
                [],
            ]),
        ) as fetch_all:
            result = asyncio.run(list_platform_catalogs(object()))
        self.assertEqual(result["dependents"][0]["linked_target_platforms"], 3)
        self.assertEqual(result["groups"][0]["active"], True)
        self.assertEqual(result["rotational_groups"], [])
        self.assertEqual(fetch_all.await_count, 3)
        for call in fetch_all.await_args_list:
            self.assertIn("source_system = 'cyberark'", call.args[1])

    def test_lists_aim_applications_without_owner_fields(self):
        rows = [{
            "object_id": 40, "display_name": "Finance batch job", "source_id": "App1",
            "description": "Finance batch job", "disabled": False, "expiration_date": "12/31/2027",
            "location": "\\", "total_count": 1,
        }]
        with patch("app.repositories.pam_chain_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_aim_applications(object(), "", 50, 0))
        self.assertEqual(result["total"], 1)
        query = fetch_all.await_args.args[1]
        self.assertIn("aim_application", query)
        self.assertNotIn("BusinessOwner", query)
        self.assertIn("source_system = 'cyberark'", query)


if __name__ == "__main__":
    unittest.main()
