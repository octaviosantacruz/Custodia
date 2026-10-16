import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.cyberark.pam.repositories.analytics import get_access_concentration, get_analytics, get_inventory_freshness, get_summary
from app.cyberark.pam.repositories.license_reconciliation import get_standard_seat_reconciliation
from app.cyberark.pam.repositories.safe_queries import _safe_filters


class AnalyticsRepositoryTests(unittest.TestCase):
    def test_summary_latest_run_includes_source_identity_for_notifications(self):
        with patch("app.cyberark.pam.repositories.analytics.fetch_one", new=AsyncMock(return_value={"latest_run": {}})) as fetch_one:
            asyncio.run(get_summary(object()))

        query = fetch_one.await_args.args[1]
        self.assertIn("SELECT run_id, source_system, source_file, status", query)

    def test_safe_health_filters_use_persisted_inventory_evidence(self):
        expected = {
            "missing_cpm": "managing_cpm",
            "no_accounts": "a_health.lifecycle_status = 'active'",
            "olac_disabled": "s.olac_enabled IS FALSE",
            "retention_unconfigured": "number_of_days_retention IS NULL",
            "manage_safe_concentration": "manageSafe",
        }
        for health_filter, predicate in expected.items():
            where, params = _safe_filters('', '', '', '', '', '', '', health_filter)
            self.assertIn(predicate, where[-1])
            self.assertEqual(params, ['', '', ''])

    def test_get_analytics_applies_scope_quality_and_scope_hint_filters(self):
        with patch("app.cyberark.pam.repositories.analytics.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            asyncio.run(get_analytics(
                object(),
                search="AS400",
                workflow_status="in_progress",
                classification_status="assigned",
                account_type="NOMINAL",
                inventory_scope="business",
                data_quality_status="clean",
                scope_hint="possible_internal_accounts_safe",
            ))

        self.assertEqual(fetch_all.await_count, 5)
        for call in fetch_all.await_args_list:
            _pool, query, params = call.args
            self.assertIn("m.inventory_scope = %s", query)
            self.assertIn("m.data_quality_status = %s", query)
            self.assertIn("_Accounts$", query)
            self.assertIn("business", params)
            self.assertIn("clean", params)
            self.assertNotIn("AS400", query)

    def test_get_analytics_omits_optional_filters_when_unset(self):
        with patch("app.cyberark.pam.repositories.analytics.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            asyncio.run(get_analytics(object()))

        for call in fetch_all.await_args_list:
            _pool, query, _params = call.args
            self.assertNotIn("m.inventory_scope = %s", query)
            self.assertNotIn("m.data_quality_status = %s", query)
            self.assertNotIn("_Accounts$", query)

    def test_next_action_filter_supports_empty_and_named_actions(self):
        where, params = _safe_filters('', '', '', '', '', '', '', next_action='__empty__')
        self.assertIn("coalesce(trim(m.next_action), '') = ''", where)
        self.assertEqual(params, ['', '', ''])

        where, params = _safe_filters('', '', '', '', '', '', '', next_action='Migrar a SIA')
        self.assertIn("lower(trim(coalesce(m.next_action, ''))) = lower(trim(%s))", where)
        self.assertEqual(params, ['', '', '', 'Migrar a SIA'])

        where, params = _safe_filters('', '', '', '', '', '', '', next_action='Revisar')
        sql = " ".join(where)
        self.assertIn("'revisar'", sql)
        self.assertIn("'revisar / dar de baja'", sql)
        self.assertEqual(params, ['', '', ''])

        where, params = _safe_filters('', '', '', '', '', '', '', next_action='__decommission__')
        sql = " ".join(where)
        self.assertIn("'dar de baja'", sql)
        self.assertNotIn("'revisar / dar de baja'", sql)
        self.assertEqual(params, ['', '', ''])

    def test_dimension_filters_support_catalog_ids_and_unassigned_values(self):
        where, params = _safe_filters('', '', '', '', '', '', '', business_unit='7', responsible='unassigned')
        self.assertIn('m.business_unit_id = %s', where)
        self.assertIn('m.responsible_id IS NULL', where)
        self.assertEqual(params, ['', '', '', 7])

        where, params = _safe_filters('', '', '', '__empty__', '', '', '', business_unit='unassigned')
        self.assertIn("coalesce(nullif(trim(m.account_type_classification), ''), '') = ''", where)
        self.assertNotIn("inventory_account_types", " ".join(where))
        self.assertIn('m.business_unit_id IS NULL', where)
        self.assertEqual(params, ['', '', ''])

    def test_account_type_filter_uses_manual_safe_classification(self):
        where, params = _safe_filters('', '', '', 'Interno CyberArk', '', '', '')
        self.assertIn("lower(trim(m.account_type_classification)) = %s", where)
        self.assertNotIn('inventory_account_types', ' '.join(where))
        self.assertEqual(params, ['', '', '', 'internal'])

    def test_get_analytics_excludes_explicitly_internal_safes_when_requested(self):
        with patch("app.cyberark.pam.repositories.analytics.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            asyncio.run(get_analytics(object(), include_internal=False))

        for call in fetch_all.await_args_list:
            query = call.args[1]
            self.assertIn("coalesce(m.inventory_scope, 'pending') <> 'internal'", query)


class AccessConcentrationTests(unittest.TestCase):
    def test_ranks_users_and_roles_over_the_cyberark_pam_chain_only(self):
        with patch("app.cyberark.pam.repositories.analytics.fetch_all", new=AsyncMock(return_value=[{"name": "R", "safe_count": 4}])) as fetch_all, \
             patch("app.cyberark.pam.repositories.analytics.fetch_one", new=AsyncMock(return_value={"users": 9, "roles": 7, "safes": 40})):
            result = asyncio.run(get_access_concentration(object(), limit=5))

        self.assertEqual(result["totals"], {"users": 9, "roles": 7, "safes": 40})
        self.assertEqual(result["users"], [{"name": "R", "safe_count": 4}])
        for call in fetch_all.await_args_list:
            _pool, query, params = call.args
            self.assertIn("source_system = 'cyberark'", query)
            self.assertNotIn("identity_administration", query)
            self.assertNotIn("'sia'", query)
            self.assertIn("role_grants_access", query)
            self.assertEqual(params, (5,))
        # one query traverses user_has_role (users), the other does not (roles)
        traversals = ["user_has_role" in call.args[1] for call in fetch_all.await_args_list]
        self.assertIn(True, traversals)
        self.assertIn(False, traversals)


class InventoryFreshnessTests(unittest.TestCase):
    def test_reads_safe_modification_age_and_account_inventory_only(self):
        with patch("app.cyberark.pam.repositories.analytics.fetch_one", new=AsyncMock(return_value={"safes": 3})) as fetch_one:
            result = asyncio.run(get_inventory_freshness(object()))

        self.assertEqual(result, {"safes": 3})
        query = fetch_one.await_args_list[0].args[1]
        self.assertIn("last_modification_time", query)
        self.assertIn("cyberark_accounts", query)
        # freshness must not reach into any credential / secret column
        for forbidden in ("secretManagement", "secret", "password", "credential"):
            self.assertNotIn(forbidden, query)


class StandardSeatReconciliationTests(unittest.TestCase):
    def test_confirms_only_when_epv_users_and_privilege_cloud_roles_match(self):
        with patch("app.cyberark.pam.repositories.license_reconciliation.fetch_all", new=AsyncMock(return_value=[{
                 "object_id": 1, "display_name": "Ada", "source_id": "u-1", "user_id": "12",
                 "license_roles": ("Privilege Cloud Users",), "okta_groups": (),
             }])) as fetch_all, \
             patch("app.cyberark.pam.repositories.license_reconciliation.fetch_one", new=AsyncMock(return_value={
                 "standard_users": 47, "reconciled_users": 47, "only_user_type": 0, "only_role_members": 0,
             })) as fetch_one:
            result = asyncio.run(get_standard_seat_reconciliation(object()))

        self.assertTrue(result["totals"]["confirmed"])
        self.assertEqual(result["rows"][0]["license_roles"], ["Privilege Cloud Users"])
        self.assertEqual(result["rows"][0]["okta_groups"], [])
        for call in [fetch_all.await_args, fetch_one.await_args]:
            query = call.args[1]
            self.assertIn("source_system = %s", query)
            self.assertIn("Privilege Cloud", str(call.args[2]))
            self.assertNotIn("safe_members", query)
            self.assertNotIn("identity_administration", query)

    def test_does_not_confirm_when_epv_users_and_roles_diverge(self):
        with patch("app.cyberark.pam.repositories.license_reconciliation.fetch_all", new=AsyncMock(return_value=[])), \
             patch("app.cyberark.pam.repositories.license_reconciliation.fetch_one", new=AsyncMock(return_value={
                 "standard_users": 47, "reconciled_users": 46, "only_user_type": 1, "only_role_members": 0,
             })):
            result = asyncio.run(get_standard_seat_reconciliation(object()))

        self.assertFalse(result["totals"]["confirmed"])
        self.assertEqual(result["rows"], [])


if __name__ == "__main__":
    unittest.main()
