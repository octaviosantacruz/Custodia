"""IF-006: proves the 'next_action' and 'workflow_next_action' dashboard
chart queries are syntactically valid SQL against a real PostgreSQL
instance. Every other dashboard_widgets test mocks fetch_all, so a
malformed query string (a missing ')' in _NEXT_ACTION_EXPR's leading
CASE lower(trim(coalesce(...))) expression) passed every existing test
while still raising "syntax error at or near WHEN" against a real
server -- caught only once the widget picker's batched preview call
actually executed it. An empty, freshly migrated schema is enough: this
only proves the query parses and runs, not that it returns particular
rows.

Opt-in only: requires CUSTODIA_TEST_DATABASE_URL. See pg_integration_base.py.
"""

import unittest

from app.cyberark.pam.services.dashboard_widgets import evaluate_dashboard_widgets
from tests.support.pg_integration_base import PostgresIntegrationTestCase


def _chart_widget(widget_id: str, style: str, group_by: str) -> dict:
    return {
        "widget_id": widget_id, "title": widget_id, "kind": "chart", "measure": "safes",
        "chart": {"style": style, "group_by": group_by},
        "filters": {"workflow_status": "", "classification_status": "", "inventory_scope": "", "data_quality_status": "", "health_filter": ""},
        "value_format": "count", "size": "sm", "position": None,
        "target_value": None, "target_direction": None, "period_label": None, "baseline_value": None,
    }


class DashboardNextActionQueryPostgresTests(PostgresIntegrationTestCase):
    async def test_next_action_bar_chart_query_executes_without_a_syntax_error(self):
        widget = _chart_widget("next-action-chart", "bars", "next_action")
        result = (await evaluate_dashboard_widgets(self.pool, [widget]))[0]
        self.assertEqual(result["buckets"], [])
        self.assertEqual(result["value"], 0)

    async def test_workflow_next_action_heatmap_query_executes_without_a_syntax_error(self):
        widget = _chart_widget("workflow-next-action-heatmap", "heatmap", "workflow_next_action")
        result = (await evaluate_dashboard_widgets(self.pool, [widget]))[0]
        self.assertEqual(result["chart_data"]["cells"], [])


if __name__ == "__main__":
    unittest.main()
