import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError

from app.cyberark.pam.api.routes.dashboard_preferences import _normalise_widgets, _without_retired_widgets, dashboard_preferences, dashboard_preferences_update
from app.cyberark.pam.repositories.dashboard_preferences import save_dashboard_preferences
from app.cyberark.pam.schemas import DashboardPreferenceUpdate
from app.cyberark.pam.services.dashboard_preferences import DEFAULT_DASHBOARD_WIDGETS
from app.cyberark.pam.repositories.dashboard_widget_queries import _NEXT_ACTION_EXPR
from app.cyberark.pam.services.dashboard_widgets import evaluate_dashboard_widgets


FRESH_INVENTORY = ("available", "2026-09-26T12:00:00+00:00")


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
        with patch("app.cyberark.pam.api.routes.dashboard_preferences.get_dashboard_preferences", new=AsyncMock(return_value=None)), patch(
            "app.cyberark.pam.api.routes.dashboard_preferences.evaluate_dashboard_widgets", new=AsyncMock(return_value=evaluated),
        ) as evaluate:
            response = asyncio.run(dashboard_preferences(self.request, "oidc-subject"))
        self.assertTrue(response["is_default"])
        self.assertEqual(response["widgets"], evaluated)
        evaluate.assert_awaited_once()

    def test_default_view_starts_with_cross_inventory_metrics(self):
        self.assertEqual([widget["title"] for widget in DEFAULT_DASHBOARD_WIDGETS], ["Safes por empresa", "Cuentas por empresa", "Estado del trabajo sobre los Safes"])
        self.assertEqual(DEFAULT_DASHBOARD_WIDGETS[0]["chart"]["group_by"], "business_unit")
        self.assertEqual(DEFAULT_DASHBOARD_WIDGETS[1]["measure"], "accounts")
        self.assertEqual(DEFAULT_DASHBOARD_WIDGETS[2]["chart"]["group_by"], "workflow_status")

    def test_legacy_saved_widgets_receive_current_layout_defaults(self):
        legacy = {**DEFAULT_DASHBOARD_WIDGETS[0]}
        legacy.pop("size", None)
        legacy.pop("position", None)
        evaluated = [{**legacy, "value": 12}]
        with patch("app.cyberark.pam.api.routes.dashboard_preferences.get_dashboard_preferences", new=AsyncMock(return_value={"widgets": [legacy]})), patch(
            "app.cyberark.pam.api.routes.dashboard_preferences.evaluate_dashboard_widgets", new=AsyncMock(return_value=evaluated),
        ) as evaluate:
            asyncio.run(dashboard_preferences(self.request, "legacy-actor"))
        normalised = evaluate.await_args.args[1][0]
        self.assertEqual(normalised["size"], "sm")
        self.assertIsNone(normalised["position"])

    def test_custom_goal_is_saved_for_the_authenticated_actor(self):
        payload = DashboardPreferenceUpdate(widgets=[_widget()])
        saved = {"widgets": [payload.widgets[0].model_dump()], "updated_at": None}
        first_evaluation = [{**saved["widgets"][0], "value": 315}]
        response_evaluation = [{**saved["widgets"][0], "baseline_value": 315, "value": 315}]
        with patch("app.cyberark.pam.api.routes.dashboard_preferences.save_dashboard_preferences", new=AsyncMock(return_value=saved)) as save, patch(
            "app.cyberark.pam.api.routes.dashboard_preferences.evaluate_dashboard_widgets", new=AsyncMock(side_effect=[first_evaluation, response_evaluation]),
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
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=AsyncMock(return_value={"value": 315})) as fetch, \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))
        self.assertEqual(result[0]["value"], 315)
        query, params = fetch.await_args.args[1:]
        self.assertIn("m.inventory_scope = %s", query)
        self.assertIn("m.data_quality_status = %s", query)
        self.assertEqual(params[-2:], ("business", "clean"))
        self.assertEqual(query.count("%s"), len(params))

    def test_dashboard_widgets_exclude_internal_safes_when_requested(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget()]).widgets[0].model_dump()
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=AsyncMock(return_value={"value": 4})) as fetch, \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
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
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch, \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
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
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=rows)), \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))
        self.assertEqual(result[0]["buckets"], rows)

    def test_chart_widget_rolls_up_categories_beyond_visible_limit(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="many-units", title="Safes por unidad", kind="chart", measure="safes",
            chart={"style": "pie", "group_by": "business_unit"},
            target_value=None, target_direction=None, period_label=None,
        )]).widgets[0].model_dump()
        rows = [{"key": f"Unidad {index}", "count": index} for index in range(13, 0, -1)]
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=rows)), \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
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
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=[])) as fetch, \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
            asyncio.run(evaluate_dashboard_widgets(object(), [widget]))
        query = fetch.await_args.args[1]
        self.assertIn("public.cyberark_accounts a ON a.safe_number = s.safe_number", query)
        self.assertIn("count(DISTINCT a.account_row_id)", query)

    def test_accounts_by_type_uses_safe_classification_for_account_counts(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="accounts-by-type", title="Cuentas por tipo", kind="chart", measure="accounts",
            chart={"style": "bars", "group_by": "account_type"},
            target_value=None, target_direction=None, period_label=None, filters={},
        )]).widgets[0].model_dump()
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=[])) as fetch, \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
            asyncio.run(evaluate_dashboard_widgets(object(), [widget]))
        query = fetch.await_args.args[1]
        self.assertIn("m.account_type_classification", query)
        self.assertIn("WHEN 'internal' THEN 'Interno CyberArk'", query)
        self.assertIn("ELSE '__empty__' END", query)
        self.assertIn("count(DISTINCT a.account_row_id)", query)
        self.assertNotIn("jsonb_each_text", query)

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
        with patch("app.cyberark.pam.services.dashboard_widgets.get_connection_coverage", new=AsyncMock(return_value={
            "totals": {"total": 20, "both": 15, "zsp_implemented": 18},
        })):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))
        self.assertEqual(result[0]["value"], 75)
        self.assertEqual(result[0]["value_format"], "percentage")
        self.assertEqual(result[0]["data_status"], "available")
        self.assertEqual(result[0]["covered_count"], 15)
        self.assertEqual(result[0]["total_count"], 20)

    def test_zsp_and_account_platform_coverage_expose_denominator_and_state(self):
        zsp = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="zsp", title="Cobertura ZSP", kind="count", measure="zsp_coverage",
            value_format="percentage", filters={}, target_value=None, target_direction=None,
        )]).widgets[0].model_dump()
        with patch("app.cyberark.pam.services.dashboard_widgets.get_connection_coverage", new=AsyncMock(return_value={
            "totals": {"total": 20, "both": 15, "zsp_implemented": 18},
        })):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [zsp]))[0]
        self.assertEqual(result["value"], 90)
        self.assertEqual(result["data_status"], "available")
        self.assertEqual(result["covered_count"], 18)
        self.assertEqual(result["total_count"], 20)
        with patch("app.cyberark.pam.services.dashboard_widgets.get_connection_coverage", new=AsyncMock(return_value={
            "totals": {"total": 0, "both": 0, "zsp_implemented": 0},
        })):
            empty = asyncio.run(evaluate_dashboard_widgets(object(), [zsp]))[0]
        self.assertEqual(empty["data_status"], "unavailable")
        self.assertEqual(empty["covered_count"], 0)
        self.assertEqual(empty["total_count"], 0)

        platform = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="platform", title="Cuentas con plataforma", kind="count", measure="account_platform_coverage",
            value_format="percentage", filters={}, target_value=None, target_direction=None,
        )]).widgets[0].model_dump()
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=[{"total": 40, "covered": 30}])):
            platform_result = asyncio.run(evaluate_dashboard_widgets(object(), [platform]))[0]
        self.assertEqual(platform_result["value"], 75)
        self.assertEqual(platform_result["data_status"], "available")
        self.assertEqual(platform_result["covered_count"], 30)
        self.assertEqual(platform_result["total_count"], 40)

    def test_kr6_reads_only_published_aggregate_and_does_not_turn_missing_data_into_zero(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="kr6", title="KR6 · Compliance CyberArk", kind="count",
            measure="cyberark_compliance", value_format="percentage", filters={},
            target_value=None, target_direction=None,
        )]).widgets[0].model_dump()
        measured_at = datetime.now(timezone.utc) - timedelta(days=2)
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=AsyncMock(return_value={
            "total_accounts": 3, "compliant_accounts": 2, "measured_at": measured_at,
        })) as fetch:
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(result["value"], 66.67)
        self.assertEqual(result["data_status"], "available")
        self.assertEqual(result["total_accounts"], 3)
        self.assertEqual(result["measured_at"], measured_at.isoformat())
        self.assertIn("cyberark_compliance_snapshot", fetch.await_args.args[1])
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=AsyncMock(return_value=None)):
            missing = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(missing["data_status"], "unavailable")

    def test_kr6_snapshot_outside_the_thirty_day_window_is_pending_not_unavailable(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="kr6", title="KR6 · Compliance CyberArk", kind="count",
            measure="cyberark_compliance", value_format="percentage", filters={},
            target_value=None, target_direction=None,
        )]).widgets[0].model_dump()
        measured_at = datetime.now(timezone.utc) - timedelta(days=31)
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=AsyncMock(return_value={
            "total_accounts": 3, "compliant_accounts": 2, "measured_at": measured_at,
        })):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        # The value and its date stay visible: the snapshot exists, it is the
        # recalc that is overdue.
        self.assertEqual(result["data_status"], "pending")
        self.assertEqual(result["value"], 66.67)
        self.assertEqual(result["measured_at"], measured_at.isoformat())

    def test_connections_follows_the_current_import_age(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="conn", title="Conexiones inventariadas", kind="count",
            measure="connections", value_format="count", filters={},
            target_value=None, target_direction=None,
        )]).widgets[0].model_dump()
        fresh = datetime.now(timezone.utc) - timedelta(days=2)
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=AsyncMock(return_value={"value": 7, "measured_at": fresh})):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(result["value"], 7)
        self.assertEqual(result["data_status"], "available")
        self.assertEqual(result["measured_at"], fresh.isoformat())
        stale = datetime.now(timezone.utc) - timedelta(days=31)
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=AsyncMock(return_value={"value": 7, "measured_at": stale})):
            pending = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(pending["data_status"], "pending")
        self.assertEqual(pending["value"], 7)
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=AsyncMock(return_value={"value": 0, "measured_at": None})):
            missing = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(missing["data_status"], "unavailable")
        self.assertEqual(missing["value"], 0)

    def test_inventory_counts_confirm_only_a_completed_run_inside_the_window(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="safes", title="Safes activos", kind="count", measure="safes",
            value_format="count", filters={}, target_value=None, target_direction=None,
        )]).widgets[0].model_dump()
        completed = datetime.now(timezone.utc) - timedelta(hours=1)

        async def fetch_one(_pool, query, _params):
            if "cyberark_ingestion_runs" in query:
                return {"status": "completed", "started_at": completed - timedelta(hours=1), "completed_at": completed}
            return {"value": 465}

        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=fetch_one):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(result["value"], 465)
        self.assertEqual(result["data_status"], "available")
        self.assertEqual(result["measured_at"], completed.isoformat())

    def test_inventory_counts_are_pending_when_the_last_run_did_not_complete_or_is_stale(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="roles", title="Roles PAM", kind="count", measure="pam_roles",
            value_format="count", filters={}, target_value=None, target_direction=None,
        )]).widgets[0].model_dump()
        started = datetime.now(timezone.utc) - timedelta(minutes=30)

        async def partial_run(_pool, query, _params):
            if "cyberark_ingestion_runs" in query:
                return {"status": "partial", "started_at": started, "completed_at": None}
            return {"value": 78}

        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=partial_run):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        # A partial run is never confirmado, even when it just happened.
        self.assertEqual(result["data_status"], "pending")
        self.assertEqual(result["value"], 78)
        self.assertEqual(result["measured_at"], started.isoformat())

        old = datetime.now(timezone.utc) - timedelta(hours=25)

        async def stale_run(_pool, query, _params):
            if "cyberark_ingestion_runs" in query:
                return {"status": "completed", "started_at": old - timedelta(hours=1), "completed_at": old}
            return {"value": 78}

        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=stale_run):
            stale = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(stale["data_status"], "pending")
        self.assertEqual(stale["measured_at"], old.isoformat())

    def test_inventory_counts_without_any_run_are_unavailable(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="accounts", title="Cuentas", kind="count", measure="accounts",
            value_format="count", filters={}, target_value=None, target_direction=None,
        )]).widgets[0].model_dump()

        async def no_runs(_pool, query, _params):
            if "cyberark_ingestion_runs" in query:
                return None
            return {"value": 0}

        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=no_runs):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(result["data_status"], "unavailable")
        self.assertEqual(result["value"], 0)

    def test_sia_policies_read_the_sia_full_run_and_charts_carry_the_state(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="policies", title="Políticas SIA", kind="count", measure="sia_policies",
            value_format="count", filters={}, target_value=None, target_direction=None,
        )]).widgets[0].model_dump()
        chart = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="by-unit", title="Safes por unidad", kind="chart", measure="safes",
            chart={"style": "pie", "group_by": "business_unit"},
            target_value=None, target_direction=None, period_label=None, filters={}, size="sm",
        )]).widgets[0].model_dump()
        seen_params: list[tuple] = []
        completed = datetime.now(timezone.utc) - timedelta(minutes=30)

        async def fake_fetch_one(_pool, query, params):
            if "cyberark_ingestion_runs" in query:
                seen_params.append(params)
                return {"status": "completed", "started_at": completed - timedelta(hours=1), "completed_at": completed}
            return {"value": 12}

        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=fake_fetch_one):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(seen_params, [("sia", "sia-api")])
        self.assertEqual(result["data_status"], "available")

        rows = [{"key": "Pagos", "count": 12}]
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=rows)), \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=("pending", "2026-09-20T10:00:00+00:00"))):
            chart_result = asyncio.run(evaluate_dashboard_widgets(object(), [chart]))[0]
        self.assertEqual(chart_result["data_status"], "pending")
        self.assertEqual(chart_result["measured_at"], "2026-09-20T10:00:00+00:00")
        self.assertEqual(chart_result["value"], 12)

    def test_kr6_snapshot_metadata_is_not_saved_in_preferences(self):
        payload = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="kr6", title="KR6", kind="count", measure="cyberark_compliance",
            value_format="percentage", filters={}, target_value=None, target_direction=None,
        )])
        evaluated = [{**payload.widgets[0].model_dump(), "value": 75, "data_status": "available",
                      "total_accounts": 4, "compliant_accounts": 3, "measured_at": "2026-09-17T00:00:00+00:00"}]
        with patch("app.cyberark.pam.api.routes.dashboard_preferences.evaluate_dashboard_widgets", new=AsyncMock(return_value=evaluated)), patch(
            "app.cyberark.pam.api.routes.dashboard_preferences.save_dashboard_preferences", new=AsyncMock(return_value={"widgets": [payload.widgets[0].model_dump()]}),
        ) as save:
            asyncio.run(dashboard_preferences_update(payload, self.request, "actor"))
        saved_widget = save.await_args.args[2][0]
        self.assertNotIn("data_status", saved_widget)
        self.assertNotIn("total_accounts", saved_widget)
        self.assertNotIn("measured_at", saved_widget)

    def test_percentage_goal_accepts_fractional_baseline(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            measure="cyberark_compliance", value_format="percentage", filters={},
            baseline_value=66.67,
        )]).widgets[0]
        self.assertEqual(widget.baseline_value, 66.67)

    def test_kr1_shortcut_previously_saved_as_a_count_is_converted_to_percentage(self):
        legacy = _widget(widget_id="shortcut-kr1-safe-inventory-123-0", title="KR1 · Safes inventariados",
                         kind="count", measure="safes", filters={}, target_value=None,
                         target_direction=None)
        converted = _normalise_widgets([legacy])[0]
        self.assertEqual(converted["measure"], "safe_account_coverage")
        self.assertEqual(converted["value_format"], "percentage")
        self.assertEqual(converted["title"], "KR1 · Safes con cuentas")

    def test_saved_kr1_bu_shortcut_switches_to_safe_completeness(self):
        saved = _widget(widget_id="shortcut-kr1-safe-coverage-123-0", title="KR1 · Cobertura de Safes",
                        kind="count", measure="kr1_safe_bu_coverage", value_format="percentage",
                        filters={}, target_value=None, target_direction=None)
        converted = _normalise_widgets([saved])[0]
        self.assertEqual(converted["title"], "KR1 · Safes con cuentas")
        self.assertEqual(converted["measure"], "safe_account_coverage")
        saved["title"] = "Safes con unidad asignada"
        self.assertEqual(_normalise_widgets([saved])[0]["measure"], "safe_account_coverage")
        saved["widget_id"] = "shortcut-kr1-safe-inventory-123-0"
        self.assertEqual(_normalise_widgets([saved])[0]["measure"], "safe_account_coverage")

    def test_saved_safe_account_shortcut_uses_business_title_without_changing_custom_titles(self):
        saved = _widget(widget_id="shortcut-safe-account-coverage-123-0", title="Safes con cuentas",
                        kind="count", measure="safe_account_coverage", value_format="percentage",
                        filters={}, target_value=None, target_direction=None)
        self.assertEqual(_normalise_widgets([saved])[0]["title"], "KR1 · Safes con cuentas")
        saved["title"] = "Mi indicador"
        self.assertEqual(_normalise_widgets([saved])[0]["title"], "Mi indicador")
        saved["widget_id"] = "shortcut-kr1-safe-coverage-123-0"
        for title in ("Safes con cuentas", "KR1 · Safes con cuentas (completitud)"):
            saved["title"] = title
            self.assertEqual(_normalise_widgets([saved])[0]["title"], "KR1 · Safes con cuentas")
        for title in ("Mi indicador", "KR1 · Revisión Finanzas"):
            saved["title"] = title
            self.assertEqual(_normalise_widgets([saved])[0]["title"], title)

    def test_saved_kr1_bu_widget_is_read_as_87_84_percent_safe_completeness(self):
        saved_widget = _widget(
            widget_id="shortcut-kr1-safe-coverage-1789667366048-6",
            title="Safes con unidad asignada", kind="count",
            measure="kr1_safe_bu_coverage", value_format="percentage",
            filters={}, target_value=None, target_direction=None,
        )
        with patch("app.cyberark.pam.api.routes.dashboard_preferences.get_dashboard_preferences", new=AsyncMock(return_value={"widgets": [saved_widget]})), patch(
            "app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=[{"total": 436, "covered": 383}]),
        ):
            response = asyncio.run(dashboard_preferences(self.request, "actor"))
        widget = response["widgets"][0]
        self.assertEqual(widget["title"], "KR1 · Safes con cuentas")
        self.assertEqual(widget["measure"], "safe_account_coverage")
        self.assertEqual(widget["value"], 87.84)
        self.assertEqual(widget["covered_count"], 383)

    def test_safe_completeness_uses_active_safes_with_active_accounts_and_two_decimals(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            kind="count", measure="safe_account_coverage", value_format="percentage",
            filters={}, target_value=None, target_direction=None,
        )]).widgets[0].model_dump()
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=[{"total": 436, "covered": 383}])) as fetch, \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(result["value"], 87.84)
        self.assertEqual(result["covered_count"], 383)
        self.assertEqual(result["total_count"], 436)
        query = fetch.await_args.args[1]
        self.assertIn("a.lifecycle_status = 'active'", query)
        self.assertIn("s.lifecycle_status = 'active'", query)

    def test_kr1_safe_bu_coverage_counts_assigned_active_safes_in_scope(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            kind="count", measure="kr1_safe_bu_coverage", value_format="percentage",
            filters={}, target_value=None, target_direction=None,
        )]).widgets[0].model_dump()
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=AsyncMock(return_value={"total": 10, "covered": 8})) as fetch:
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget], include_internal=False))[0]
        self.assertEqual(result["value"], 80)
        self.assertEqual(result["covered_count"], 8)
        self.assertIn("business_unit_id IS NOT NULL", fetch.await_args.args[1])
        self.assertEqual(fetch.await_args.args[2], (False,))

    def test_kr2_uses_union_of_pam_and_sia_connection_coverage(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            kind="count", measure="kr2_connection_coverage", value_format="percentage",
            filters={}, target_value=None, target_direction=None,
        )]).widgets[0].model_dump()
        with patch("app.cyberark.pam.services.dashboard_widgets.get_connection_coverage", new=AsyncMock(return_value={
            "totals": {"total": 51, "both": 25, "pam_only": 1, "sia_only": 24, "none": 1},
        })):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(result["value"], 98.04)
        self.assertEqual(result["covered_count"], 50)
        self.assertEqual(result["total_count"], 51)
        with patch("app.cyberark.pam.services.dashboard_widgets.get_connection_coverage", new=AsyncMock(return_value={
            "totals": {"total": 0, "both": 0, "pam_only": 0, "sia_only": 0},
        })):
            empty = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(empty["data_status"], "unavailable")

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
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch, \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
            result = asyncio.run(evaluate_dashboard_widgets(object(), [widget]))[0]
        self.assertEqual(result["value"], 120)
        self.assertEqual(result["chart_data"]["series"], [{"key": "safes", "label": "Safes", "values": [100, 120]}])
        self.assertIn("source_system = 'cyberark'", fetch.await_args.args[1])
        self.assertIn("source_file = 'cyberark-api'", fetch.await_args.args[1])
        # UX-AUD-012: the label keeps the timestamp for intraday HH:MM ticks.
        self.assertIn("started_at AS label", fetch.await_args.args[1])

    def test_heatmap_returns_business_unit_and_workflow_cells(self):
        widget = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="heatmap", title="Estado por empresa", kind="chart", measure="safes",
            chart={"style": "heatmap", "group_by": "business_unit_workflow"},
            target_value=None, target_direction=None, period_label=None, filters={}, size="md",
        )]).widgets[0].model_dump()
        rows = [{"business_unit": "UENO", "business_unit_value": "4", "workflow_status": "pending", "count": 7}]
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=rows)), \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
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
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=rows)) as fetch, \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
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
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=combo_rows)), \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
            combo_result = asyncio.run(evaluate_dashboard_widgets(object(), [combo]))[0]
        self.assertEqual(combo_result["chart_data"]["series"][1]["values"], [31])

        scatter = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="scatter", title="Cuentas vs miembros", kind="chart", measure="safes",
            chart={"style": "scatter", "group_by": "safe_accounts_members"},
            target_value=None, target_direction=None, period_label=None, filters={}, size="md",
        )]).widgets[0].model_dump()
        scatter_rows = [{"label": "SAFE-A", "accounts": 3, "members": 8}]
        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=AsyncMock(return_value=scatter_rows)), \
             patch("app.cyberark.pam.services.dashboard_widgets._inventory_freshness", new=AsyncMock(return_value=FRESH_INVENTORY)):
            scatter_result = asyncio.run(evaluate_dashboard_widgets(object(), [scatter]))[0]
        self.assertEqual(scatter_result["chart_data"]["points"][0]["x"], 3)
        self.assertEqual(scatter_result["chart_data"]["points"][0]["y"], 8)

    def test_one_widgets_failed_query_degrades_only_that_widget_not_the_whole_batch(self):
        # The picker's batched preview and the personal dashboard's own load
        # both evaluate several widgets in one call; a single bad widget
        # (this exact scenario: a malformed dimension expression) must not
        # 500 the whole response and blank out every other widget in it.
        good = DashboardPreferenceUpdate(widgets=[_widget(widget_id="good", title="Good")]).widgets[0].model_dump()
        bad = DashboardPreferenceUpdate(widgets=[_widget(
            widget_id="bad", title="Bad", kind="chart", measure="safes",
            chart={"style": "bars", "group_by": "next_action"},
            target_value=None, target_direction=None, period_label=None, filters={}, size="sm",
        )]).widgets[0].model_dump()

        async def fetch_one_or_raise(_pool, query, _params):
            if "cyberark_ingestion_runs" in query:
                return {"status": "completed", "started_at": datetime.now(timezone.utc) - timedelta(hours=2),
                        "completed_at": datetime.now(timezone.utc) - timedelta(hours=1)}
            return {"value": 12}

        async def fetch_all_or_raise(_pool, _query, _params):
            raise RuntimeError("syntax error at or near WHEN")

        with patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_one", new=fetch_one_or_raise), \
             patch("app.cyberark.pam.repositories.dashboard_widget_queries.fetch_all", new=fetch_all_or_raise):
            results = asyncio.run(evaluate_dashboard_widgets(object(), [good, bad]))

        self.assertEqual(results[0]["value"], 12)
        self.assertEqual(results[0]["data_status"], "available")
        self.assertEqual(results[1]["value"], 0)
        self.assertEqual(results[1]["buckets"], [])
        self.assertEqual(results[1]["data_status"], "unavailable")

    def test_next_action_expression_has_balanced_parentheses(self):
        # A mocked fetch_all (every test above) never sends this SQL to a
        # real server, so a missing ')' in the CASE expression's leading
        # lower(trim(coalesce(...))) call went undetected until the widget
        # picker's batched preview actually executed it and got a genuine
        # PostgreSQL "syntax error at or near WHEN". This is a fast,
        # always-on guard against that class of regression; the real query
        # is exercised end to end by
        # test_dashboard_widgets_postgres_integration.py (opt-in, needs a
        # real database).
        self.assertEqual(_NEXT_ACTION_EXPR.count("("), _NEXT_ACTION_EXPR.count(")"))

    def test_saving_a_personal_view_audits_in_the_same_transaction(self):
        pool = _Pool()
        widgets = [_widget()]
        with patch("app.cyberark.pam.repositories.dashboard_preferences.record_audit", new=AsyncMock()) as audit:
            saved = asyncio.run(save_dashboard_preferences(pool, "octavio", widgets))
        self.assertEqual(saved["widgets"], widgets)
        self.assertIn("ON CONFLICT", pool.connection_instance.cursor_instance.calls[1][0])
        self.assertIs(audit.await_args.kwargs["connection"], pool.connection_instance)
        self.assertEqual(audit.await_args.kwargs["entity_type"], "dashboard_preferences")


class RetiredInventoryEvolutionTests(unittest.TestCase):
    def _widget(self, widget_id, group_by, style="line"):
        return {"widget_id": widget_id, "title": widget_id, "kind": "chart", "measure": "safes", "chart": {"style": style, "group_by": group_by}, "filters": {}}

    def test_saved_views_open_without_the_inventory_evolution_chart(self):
        saved = [self._widget("a", "business_unit", "pie"), self._widget("trend", "inventory_trend"), self._widget("b", "workflow_status", "bars")]
        self.assertEqual([widget["widget_id"] for widget in _without_retired_widgets(saved)], ["a", "b"])
        self.assertEqual([widget["widget_id"] for widget in _normalise_widgets(saved)], ["a", "b"])

    def test_a_view_that_only_held_the_retired_chart_falls_back_to_the_defaults_but_an_empty_one_stays_empty(self):
        only_trend = [self._widget("trend", "inventory_trend")]
        self.assertEqual(_without_retired_widgets(only_trend), list(DEFAULT_DASHBOARD_WIDGETS))
        self.assertEqual(_without_retired_widgets([]), [])


if __name__ == "__main__":
    unittest.main()
