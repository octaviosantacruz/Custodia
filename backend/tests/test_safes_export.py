import csv
import io
import unittest

from app.api.routes.safes import _safes_csv
from app.repositories.safes import _safe_filters
from app.schemas import SafeQuickUpdate


class SafeExportTests(unittest.TestCase):
    def test_filters_use_parameters_and_keep_all_context(self):
        where, params = _safe_filters(
            "AS400", "in_progress", "assigned", "NOMINAL",
            "business", "clean", "possible_internal_accounts_safe",
        )
        sql = " ".join(where)
        self.assertNotIn("AS400", sql)
        self.assertIn("m.workflow_status = %s", sql)
        self.assertIn("m.inventory_account_types ? %s", sql)
        self.assertEqual(params[:3], ["AS400", "AS400", "AS400"])
        self.assertIn("in_progress", params)
        self.assertIn("possible_internal_accounts_safe", ["possible_internal_accounts_safe"])


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
