import asyncio
import csv
import io
import unittest
from unittest.mock import AsyncMock, patch

from app.cyberark.pam.api.routes.safe_read import _safes_csv
from app.cyberark.pam.repositories.safe_queries import export_safes, list_safes
from app.cyberark.pam.repositories.safes import _safe_filters
from app.cyberark.pam.schemas import SafeQuickUpdate


class SafeExportTests(unittest.TestCase):
    def test_filters_use_parameters_and_keep_all_context(self):
        where, params = _safe_filters(
            "AS400", "in_progress", "assigned", "NOMINAL",
            "business", "clean", "possible_internal_accounts_safe",
        )
        sql = " ".join(where)
        self.assertNotIn("AS400", sql)
        self.assertIn("m.workflow_status = %s", sql)
        self.assertIn("lower(trim(m.account_type_classification)) = %s", sql)
        self.assertEqual(params[:3], ["AS400", "AS400", "AS400"])
        self.assertIn("in_progress", params)
        self.assertIn("nominal", params)

    def test_account_search_is_opt_in_and_parameterized(self):
        query = "account-search ' OR true --"
        where, params = _safe_filters(query, "", "", "", "", "", "", include_accounts=True)
        sql = " ".join(" AND ".join(where).split())
        self.assertIn("EXISTS ( SELECT 1 FROM public.cyberark_accounts a_search", sql)
        self.assertIn("a_search.lifecycle_status = 'active'", sql)
        self.assertIn("a_search.platform_name", sql)
        self.assertNotIn(query, sql)
        self.assertEqual(params[:3], [query] * 3)
        self.assertEqual(params[3:7], [query] * 4)

        default_where, default_params = _safe_filters(query, "", "", "", "", "", "")
        self.assertNotIn("a_search", " AND ".join(default_where))
        self.assertEqual(default_params, [query] * 3)
        empty_search_where, empty_search_params = _safe_filters("", "", "", "", "", "", "", include_accounts=True)
        self.assertNotIn("a_search", " AND ".join(empty_search_where))
        self.assertEqual(empty_search_params, [""] * 3)

    def test_safe_list_total_and_export_apply_the_same_account_search_filter(self):
        query = "svc-needle"
        safe_row = {"safe_number": 24, "safe_name": "Ops", "total_count": 1, "assigned_count": 0, "review_count": 0, "pending_count": 1}
        with patch("app.cyberark.pam.repositories.safe_queries.fetch_all", new=AsyncMock(side_effect=[[safe_row.copy()], [{"safe_number": 24, "safe_name": "Ops"}]])) as fetch:
            result = asyncio.run(list_safes(object(), query, 50, 0, "", "", "", "", "", "", include_accounts=True))
            exported = asyncio.run(export_safes(object(), query, "", "", "", "", "", "", include_accounts=True))

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["classification_counts"], {"assigned": 0, "review": 0, "pending": 1})
        self.assertNotIn("pending_count", result["rows"][0])
        self.assertEqual([row["safe_number"] for row in exported], [24])
        list_query, list_params = fetch.await_args_list[0].args[1:]
        export_query, export_params = fetch.await_args_list[1].args[1:]
        self.assertIn("a_search.lifecycle_status = 'active'", list_query)
        self.assertIn("a_search.lifecycle_status = 'active'", export_query)
        self.assertEqual(list_params[:6], export_params[:6])
        self.assertEqual(list_params[-2:], (50, 0))
        self.assertEqual(list_query.count("%s"), len(list_params))

    def test_retired_account_is_excluded_by_the_active_lifecycle_predicate(self):
        where, _ = _safe_filters("needle", "", "", "", "", "", "", include_accounts=True)
        sql = " AND ".join(where)
        self.assertIn("a_search.lifecycle_status = 'active'", sql)


    def test_quick_update_normalizes_legacy_action_labels(self):
        update = SafeQuickUpdate(workflow_status="pending", next_action=" revisar ")
        self.assertEqual(update.next_action, "Revisar")
        decommission = SafeQuickUpdate(workflow_status="pending", next_action=" dar de baja ")
        self.assertEqual(decommission.next_action, "Dar de baja")

    def test_legacy_combined_action_maps_to_review(self):
        update = SafeQuickUpdate(workflow_status="pending", next_action="Revisar / Dar de baja")
        self.assertEqual(update.next_action, "Revisar")

    def test_csv_has_approved_columns_and_no_member_details(self):
        content = _safes_csv([{
            "safe_name": "Technical Safe",
            "internal_name": None,
            "safe_url_id": "safe-id",
            "location": None,
            "account_count": 2,
            "member_count": 5,
            "account_type_counts": {"NOMINAL": 2},
            "business_unit_name": "Unidad",
            "responsible_name": "Responsable",
            "workflow_status": "pending",
            "next_action": None,
            "inventory_scope": "business",
            "data_quality_status": "clean",
        }])
        rows = list(csv.reader(io.StringIO(content)))
        self.assertEqual(rows[0], [
            "Safe", "Safe URL ID", "Ubicación", "Cuentas", "Miembros", "Tipo de cuenta",
            "Unidad", "Responsable", "Estado", "Acción siguiente", "Alcance KR1", "Calidad",
        ])
        self.assertEqual(rows[1][0], "Technical Safe")
        self.assertEqual(rows[1][5], "NOMINAL (2)")
        self.assertNotIn("member_name", content)
        self.assertNotIn("permissions", content)


if __name__ == "__main__":
    unittest.main()
