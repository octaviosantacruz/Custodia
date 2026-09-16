import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError

from app.api.routes.dashboard_preferences import dashboard_preferences, dashboard_preferences_update
from app.repositories.dashboard_preferences import save_dashboard_preferences
from app.schemas import DashboardPreferenceUpdate
from app.services.dashboard_preferences import DEFAULT_DASHBOARD_WIDGETS
from app.services.dashboard_widgets import evaluate_dashboard_widgets


def _widget(**overrides):
    value = {
        "widget_id": "quarter-goal",
        "title": "Objetivo Q4",
        "kind": "goal",
        "filters": {"inventory_scope": "business", "data_quality_status": "clean"},
        "target_value": 400,
        "target_direction": "at_least",
        "period_label": "Q4 2026",
    }
    value.update(overrides)
    return value


class _Context:
    def __init__(self, value): self.value = value
    async def __aenter__(self): return self.value
    async def __aexit__(self, *_): return False


class _Cursor:
    def __init__(self): self.calls = []; self.rows = [None, {"widgets": [_widget()], "updated_at": None}]
    async def execute(self, query, params=()): self.calls.append((query, params))
    async def fetchone(self): return self.rows.pop(0)


class _Connection:
    def __init__(self): self.cursor_instance = _Cursor()
    def transaction(self): return _Context(self)
    def cursor(self): return _Context(self.cursor_instance)


class _Pool:
    def __init__(self): self.connection_instance = _Connection()
    def connection(self): return _Context(self.connection_instance)


class DashboardPreferenceTests(unittest.TestCase):
    def setUp(self):
        self.request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=object())))

    def test_default_view_is_evaluated_for_a_new_identity(self):
        evaluated = [{**DEFAULT_DASHBOARD_WIDGETS[0], "value": 12}]
        with patch("app.api.routes.dashboard_preferences.get_dashboard_preferences", new=AsyncMock(return_value=None)), patch(
            "app.api.routes.dashboard_preferences.evaluate_dashboard_widgets", new=AsyncMock(return_value=evaluated),
        ) as evaluate:
            response = asyncio.run(dashboard_preferences(self.request, "oidc-subject"))
        self.assertTrue(response["is_default"])
        self.assertEqual(response["widgets"], evaluated)
        evaluate.assert_awaited_once()

    def test_default_view_starts_with_cross_inventory_metrics(self):
        self.assertEqual([widget["title"] for widget in DEFAULT_DASHBOARD_WIDGETS], ["Safes por empresa", "Cuentas por empresa", "Safes por estado"])
        self.assertEqual(DEFAULT_DASHBOARD_WIDGETS[0]["chart"]["group_by"], "business_unit")
        self.assertEqual(DEFAULT_DASHBOARD_WIDGETS[1]["measure"], "accounts")
        self.assertEqual(DEFAULT_DASHBOARD_WIDGETS[2]["chart"]["group_by"], "workflow_status")

    def test_legacy_saved_widgets_receive_current_layout_defaults(self):
        legacy = {**DEFAULT_DASHBOARD_WIDGETS[0]}
        legacy.pop("size", None)
        legacy.pop("position", None)
        evaluated = [{**legacy, "value": 12}]
        with patch("app.api.routes.dashboard_preferences.get_dashboard_preferences", new=AsyncMock(return_value={"widgets": [legacy]})), patch(
            "app.api.routes.dashboard_preferences.evaluate_dashboard_widgets", new=AsyncMock(return_value=evaluated),
        ) as evaluate:
            response = asyncio.run(dashboard_preferences(self.request, "legacy-actor"))
        normalised = evaluate.await_args.args[1][0]
        self.assertEqual(normalised["size"], "sm")
        self.assertIsNone(normalised["position"])

    def test_custom_goal_is_saved_for_the_authenticated_actor(self):
        payload = DashboardPreferenceUpdate(widgets=[_widget()])
        saved = {"widgets": [payload.widgets[0].model_dump()], "updated_at": None}
        first_evaluation = [{**saved["widgets"][0], "value": 315}]
        response_evaluation = [{**saved["widgets"][0], "baseline_value": 315, "value": 315}]
        with patch("app.api.routes.dashboard_preferences.save_dashboard_preferences", new=AsyncMock(return_value=saved)) as save, patch(
            "app.api.routes.dashboard_preferences.evaluate_dashboard_widgets", new=AsyncMock(side_effect=[first_evaluation, response_evaluation]),
        ):
            response = asyncio.run(dashboard_preferences_update(payload, self.request, "octavio"))
        self.assertEqual(response["widgets"][0]["value"], 315)
        self.assertEqual(save.await_args.args[1], "octavio")
        self.assertEqual(save.await_args.args[2][0]["filters"]["inventory_scope"], "business")

    def test_goal_requires_target_and_widgets_require_unique_ids(self):
        with self.assertRaises(ValidationError):
            DashboardPreferenceUpdate(widgets=[_widget(target_value=None)])
        with self.assertRaises(ValidationError):
            DashboardPreferenceUpdate(widgets=[_widget(), _widget(title="Otra")])

    def test_evaluation_reuses_parameterized_safe_filters(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget()]).widgets[0].model_dump()
        with patch("app.services.dashboard_widgets.fetch_one", new=AsyncMock(return_value={"value": 315})) as fetch:
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))
        self.assertEqual(result[0]["value"], 315)
        query, params = fetch.await_args.args[1:]
        self.assertIn("m.inventory_scope = %s", query)
        self.assertIn("m.data_quality_status = %s", query)
        self.assertEqual(params[-2:], ("business", "clean"))
        self.assertEqual(query.count("%s"), len(params))

    def test_dashboard_widgets_exclude_internal_safes_when_requested(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget()]).widgets[0].model_dump()
        with patch("app.services.dashboard_widgets.fetch_one", new=AsyncMock(return_value={"value": 4})) as fetch:
            asyncio.run(evaluate_dashboard_widgets(object(), [widget], include_internal=False))
        query = fetch.await_args.args[1]
        self.assertIn("coalesce(m.inventory_scope, 'pending') <> 'internal'", query)

    def test_chart_widget_groups_by_dimension_and_returns_buckets(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="by-unit", title="Safes por unidad", kind="chart", measure="safes",
            chart={"style": "pie", "group_by": "business_unit"},
            target_value=None, target_direction=None, period_label=None,
            filters={"inventory_scope": "business"},
        )]).widgets[0].model_dump()
        rows = [{"key": "Pagos", "count": 12}, {"key": "Sin unidad", "count": 3}]
        with patch("app.services.dashboard_widgets.fetch_all", new=AsyncMock(return_value=rows)) as fetch:
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))
        self.assertEqual(result[0]["buckets"], [
            {"key": "Pagos", "filter_value": "Pagos", "count": 12},
            {"key": "Sin unidad", "filter_value": "Sin unidad", "count": 3},
        ])
        self.assertEqual(result[0]["value"], 15)
        query, params = fetch.await_args.args[1:]
        self.assertIn("GROUP BY", query)
        self.assertIn("cyberark_business_units", query)
        self.assertIn("m.inventory_scope = %s", query)
        self.assertEqual(query.count("%s"), len(params))

    def test_business_unit_chart_exposes_a_stable_drilldown_value(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="by-unit", title="Safes por unidad", kind="chart", measure="safes",
            chart={"style": "bars", "group_by": "business_unit"},
            target_value=None, target_direction=None, period_label=None,
        )]).widgets[0].model_dump()
        rows = [{"key": "UENO", "filter_value": "4", "count": 9}]
        with patch("app.services.dashboard_widgets.fetch_all", new=AsyncMock(return_value=rows)):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))
        self.assertEqual(result[0]["buckets"], rows)

    def test_chart_widget_rolls_up_categories_beyond_visible_limit(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="many-units", title="Safes por unidad", kind="chart", measure="safes",
            chart={"style": "pie", "group_by": "business_unit"},
            target_value=None, target_direction=None, period_label=None,
        )]).widgets[0].model_dump()
        rows = [{"key": f"Unidad {index}", "count": index} for index in range(13, 0, -1)]
        with patch("app.services.dashboard_widgets.fetch_all", new=AsyncMock(return_value=rows)):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))
        self.assertEqual(len(result[0]["buckets"]), 12)
        self.assertEqual(result[0]["buckets"][-1], {"key": "Otros", "count": 3})
        self.assertEqual(result[0]["value"], sum(row["count"] for row in rows))

    def test_chart_accounts_measure_counts_accounts_not_safes(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="acc-state", title="Cuentas por estado", kind="chart", measure="accounts",
            chart={"style": "bars", "group_by": "workflow_status"},
            target_value=None, target_direction=None, period_label=None, filters={},
        )]).widgets[0].model_dump()
        with patch("app.services.dashboard_widgets.fetch_all", new=AsyncMock(return_value=[])) as fetch:
            asyncio.run(evaluate_dashboard_widgets(object(), [widget]))
        query = fetch.await_args.args[1]
        self.assertIn("public.cyberark_accounts a ON a.safe_number = s.safe_number", query)
        self.assertIn("count(DISTINCT a.account_row_id)", query)

    def test_chart_widget_requires_style_and_dimension(self):
        with self.assertRaises(ValidationError):
            DashboardPreferenceUpdate(widgets=[_widget(
                widget_id="broken", kind="chart", chart=None,
                target_value=None, target_direction=None, period_label=None,
            )])

    def test_cross_source_kpi_requires_percentage_format_and_has_no_safe_filters(self):
        with self.assertRaises(ValidationError):
            DashboardPreferenceUpdate(widgets=[_widget(measure="zsp_coverage")])
        with self.assertRaises(ValidationError):
            DashboardPreferenceUpdate(widgets=[_widget(measure="zsp_coverage", value_format="percentage", filters={"workflow_status": "pending"})])
        widget = DashboardPreferenceUpdate(widgets=[_widget(measure="zsp_coverage", value_format="percentage", filters={})]).widgets[0]
        self.assertEqual(widget.value_format, "percentage")

    def test_cross_source_kpi_uses_connection_coverage_denominator(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="coverage", title="Cobertura PAM + SIA", measure="pam_sia_coverage", value_format="percentage", filters={},
        )]).widgets[0].model_dump()
        with patch("app.services.dashboard_widgets.get_connection_coverage", new=AsyncMock(return_value={
            "totals": {"total": 20, "both": 15, "zsp_implemented": 18},
        })):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))
        self.assertEqual(result[0]["value"], 75)
        self.assertEqual(result[0]["value_format"], "percentage")

    def test_widget_defaults_to_a_single_small_zone(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget()]).widgets[0]
        self.assertEqual(widget.size, "sm")
        self.assertIsNone(widget.position)

    def test_a_wide_or_large_block_must_fit_the_six_zone_grid(self):
        DashboardPreferenceUpdate(widgets=[_widget(size="md", position=1)])
        DashboardPreferenceUpdate(widgets=[_widget(size="lg", position=1)])
        with self.assertRaises(ValidationError):
            DashboardPreferenceUpdate(widgets=[_widget(size="md", position=2)])
        with self.assertRaises(ValidationError):
            DashboardPreferenceUpdate(widgets=[_widget(size="lg", position=2)])
        with self.assertRaises(ValidationError):
            DashboardPreferenceUpdate(widgets=[_widget(size="lg", position=4)])

    def test_personal_view_accepts_six_data_and_six_visual_widgets(self):
        data = [_widget(widget_id=f"data-{index}", title=f"Dato {index}", kind="count", target_value=None, target_direction=None, period_label=None) for index in range(6)]
        visuals = [_widget(widget_id=f"goal-{index}", title=f"Objetivo {index}") for index in range(6)]
        widgets = data + visuals
        DashboardPreferenceUpdate(widgets=widgets)
        with self.assertRaises(ValidationError):
            DashboardPreferenceUpdate(widgets=data + [_widget(widget_id="data-7", title="Dato 7", kind="count", target_value=None, target_direction=None, period_label=None)])
        with self.assertRaises(ValidationError):
            DashboardPreferenceUpdate(widgets=visuals + [_widget(widget_id="goal-7", title="Objetivo 7")])

    def test_line_chart_returns_ingestion_history_as_series(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="trend", title="Evolución", kind="chart", measure="safes",
            chart={"style": "line", "group_by": "inventory_trend"},
            target_value=None, target_direction=None, period_label=None, filters={}, size="md",
        )]).widgets[0].model_dump()
        rows = [{"label": "2026-09-01", "safes": 100}, {"label": "2026-09-08", "safes": 120}]
        with patch("app.services.dashboard_widgets.fetch_all", new=AsyncMock(return_value=rows)) as fetch:
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(result["value"], 120)
        self.assertEqual(result["chart_data"]["series"], [{"key": "safes", "label": "Safes", "values": [100, 120]}])
        self.assertIn("source_system = 'cyberark'", fetch.await_args.args[1])

    def test_heatmap_returns_business_unit_and_workflow_cells(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="heatmap", title="Estado por empresa", kind="chart", measure="safes",
            chart={"style": "heatmap", "group_by": "business_unit_workflow"},
            target_value=None, target_direction=None, period_label=None, filters={}, size="md",
        )]).widgets[0].model_dump()
        rows = [{"business_unit": "UENO", "business_unit_value": "4", "workflow_status": "pending", "count": 7}]
        with patch("app.services.dashboard_widgets.fetch_all", new=AsyncMock(return_value=rows)):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(result["chart_data"]["x_labels"], ["UENO"])
        self.assertEqual(result["chart_data"]["cells"][0]["value"], 7)
        self.assertIn('"business_unit": "4"', result["chart_data"]["cells"][0]["filter_value"])

    def test_heatmap_returns_pending_decisions_by_state_and_next_action(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="decisions", title="Decisiones pendientes", kind="chart", measure="safes",
            chart={"style": "heatmap", "group_by": "workflow_next_action"},
            target_value=None, target_direction=None, period_label=None, filters={}, size="md",
        )]).widgets[0].model_dump()
        rows = [{"workflow_status": "pending", "next_action": "Migrar a SIA", "count": 7}]
        with patch("app.services.dashboard_widgets.fetch_all", new=AsyncMock(return_value=rows)) as fetch:
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(result["chart_data"]["x_labels"], ["Migrar a SIA"])
        self.assertEqual(result["chart_data"]["y_labels"], ["pending"])
        self.assertIn('"next_action": "Migrar a SIA"', result["chart_data"]["cells"][0]["filter_value"])
        query = fetch.await_args.args[1]
        self.assertIn("IN ('pending', 'in_progress')", query)
        self.assertIn("'Revisar'", query)
        self.assertNotIn("'Revisar / Dar de baja'", query)

    def test_combo_and_scatter_return_crossed_series(self):
        combo = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="combo", title="Inventario por empresa", kind="chart", measure="safes",
            chart={"style": "combo", "group_by": "business_unit_inventory"},
            target_value=None, target_direction=None, period_label=None, filters={}, size="md",
        )]).widgets[0].model_dump()
        combo_rows = [{"label": "ITTI", "filter_value": "2", "safes": 9, "accounts": 31}]
        with patch("app.services.dashboard_widgets.fetch_all", new=AsyncMock(return_value=combo_rows)):
            combo_result = asyncio.run(evaluate_dashboard_widgets(object(), [combo]))[0]
        self.assertEqual(combo_result["chart_data"]["series"][1]["values"], [31])

        scatter = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="scatter", title="Cuentas vs miembros", kind="chart", measure="safes",
            chart={"style": "scatter", "group_by": "safe_accounts_members"},
            target_value=None, target_direction=None, period_label=None, filters={}, size="md",
        )]).widgets[0].model_dump()
        scatter_rows = [{"label": "SAFE-A", "accounts": 3, "members": 8}]
        with patch("app.services.dashboard_widgets.fetch_all", new=AsyncMock(return_value=scatter_rows)):
            scatter_result = asyncio.run(evaluate_dashboard_widgets(object(), [scatter]))[0]
        self.assertEqual(scatter_result["chart_data"]["points"][0]["x"], 3)
        self.assertEqual(scatter_result["chart_data"]["points"][0]["y"], 8)

    def test_saving_a_personal_view_audits_in_the_same_transaction(self):
        pool = _Pool()
        widgets = [_widget()]
        with patch("app.repositories.dashboard_preferences.record_audit", new=AsyncMock()) as audit:
            saved = asyncio.run(save_dashboard_preferences(pool, "octavio", widgets))
        self.assertEqual(saved["widgets"], widgets)
        self.assertIn("ON CONFLICT", pool.connection_instance.cursor_instance.calls[1][0])
        self.assertIs(audit.await_args.kwargs["connection"], pool.connection_instance)
        self.assertEqual(audit.await_args.kwargs["entity_type"], "dashboard_preferences")


if __name__ == "__main__":
    unittest.main()
