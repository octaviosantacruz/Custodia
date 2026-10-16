import asyncio
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError
import app.netskope.sse.api.routes.netskope_dashboard_preferences as netskope_dashboard_preferences_module

from app.netskope.sse.api.routes.netskope_dashboard_preferences import (
    CHART_WIDGETS,
    DATA_WIDGETS,
    DEFAULT_CHART_WIDGETS,
    DEFAULT_DATA_WIDGETS,
    NetskopeDashboardPreferenceUpdate,
    netskope_dashboard_preferences,
    netskope_dashboard_preferences_update,
    netskope_dashboard_templates,
    RETIRED_WIDGETS,
)
from app.netskope.sse.repositories.netskope_dashboard_preferences import save_netskope_dashboard_preferences

DASHBOARD_LIB = Path(__file__).resolve().parents[3] / "frontend" / "src" / "netskope/sse/lib/netskope-dashboard.ts"


class NetskopeDashboardCatalogContractTests(unittest.TestCase):
    """NSK-XMET-001: a widget registered in the frontend board must be
    accepted by the preferences PUT, or saving the view fails with 422. The
    frontend lib is the catalog of record; this mirrors it into the allowlist
    the same way the workspace catalog contract does."""

    def test_every_frontend_widget_is_allowlisted_with_its_kind(self):
        entries = re.findall(r"\{ id: '([^']+)', kind: '(data|chart)'", DASHBOARD_LIB.read_text(encoding="utf-8"))
        self.assertEqual({widget_id for widget_id, _ in entries}, DATA_WIDGETS | CHART_WIDGETS)
        self.assertEqual(len(entries), len(DATA_WIDGETS | CHART_WIDGETS))
        for widget_id, kind in entries:
            allowed = DATA_WIDGETS if kind == "data" else CHART_WIDGETS
            self.assertIn(widget_id, allowed, f"{widget_id} ({kind}) falta en el allowlist del backend")

    def test_cross_device_widgets_can_be_saved(self):
        payload = NetskopeDashboardPreferenceUpdate(widgets=[
            {"id": "devices_observed_user_matched", "size": "sm"},
            {"id": "users_without_observed_devices", "size": "sm"},
            {"id": "devices_by_observed_user_status", "size": "md"},
            {"id": "users_by_device_count", "size": "md"},
            {"id": "users_by_recent_device_age", "size": "md"},
            {"id": "coverage_risk_devices_by_user", "size": "md"},
        ])
        self.assertEqual([widget.id for widget in payload.widgets], [
            "devices_observed_user_matched", "users_without_observed_devices",
            "devices_by_observed_user_status", "users_by_device_count",
            "users_by_recent_device_age", "coverage_risk_devices_by_user",
        ])


class _Context:
    def __init__(self, value): self.value = value
    async def __aenter__(self): return self.value
    async def __aexit__(self, *_): return False


class _Cursor:
    def __init__(self):
        self.calls = []
        self.rows = [None, {
            "widgets": [{"id": "users_total", "size": "sm", "filters": {}}],
            "data_widgets": ["users_total"],
            "chart_widgets": ["devices_by_os"],
            "updated_at": None,
        }]
    async def execute(self, query, params=()): self.calls.append((query, params))
    async def fetchone(self): return self.rows.pop(0)


class _Connection:
    def __init__(self): self.cursor_instance = _Cursor()
    def transaction(self): return _Context(self)
    def cursor(self): return _Context(self.cursor_instance)


class _Pool:
    def __init__(self): self.connection_instance = _Connection()
    def connection(self): return _Context(self.connection_instance)


class NetskopeDashboardPreferenceTests(unittest.TestCase):
    def setUp(self):
        self.request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=object())))

    def test_new_actor_receives_an_extensible_default_view(self):
        with patch(
            "app.netskope.sse.api.routes.netskope_dashboard_preferences.get_netskope_dashboard_preferences",
            new=AsyncMock(return_value=None),
        ):
            response = asyncio.run(netskope_dashboard_preferences(self.request, "actor-1"))
        self.assertTrue(response["is_default"])
        self.assertEqual(response["data_widgets"], DEFAULT_DATA_WIDGETS)
        self.assertEqual(response["chart_widgets"], DEFAULT_CHART_WIDGETS)
        self.assertEqual(len(response["widgets"]), 7)
        self.assertEqual(response["widgets"][0], {"id": DEFAULT_DATA_WIDGETS[0], "size": "sm", "filters": {}})
        self.assertEqual(response["widgets"][len(DEFAULT_DATA_WIDGETS)], {"id": DEFAULT_CHART_WIDGETS[0], "size": "md", "filters": {}})

    def test_legacy_arrays_are_accepted_and_normalized_to_instances(self):
        payload = NetskopeDashboardPreferenceUpdate(
            data_widgets=["users_total"], chart_widgets=["devices_by_os"],
        )
        self.assertEqual(
            [widget.model_dump(exclude_none=True) for widget in payload.widgets],
            [
                {"id": "users_total", "size": "sm", "filters": {}},
                {"id": "devices_by_os", "size": "md", "filters": {}},
            ],
        )

    def test_legacy_saved_row_without_widgets_is_normalized(self):
        saved = {"widgets": None, "data_widgets": ["users_total"], "chart_widgets": ["devices_by_os"], "updated_at": None}
        with patch(
            "app.netskope.sse.api.routes.netskope_dashboard_preferences.get_netskope_dashboard_preferences",
            new=AsyncMock(return_value=saved),
        ):
            response = asyncio.run(netskope_dashboard_preferences(self.request, "actor-legacy"))
        self.assertFalse(response["is_default"])
        self.assertEqual(
            response["widgets"],
            [
                {"id": "users_total", "size": "sm", "filters": {}},
                {"id": "devices_by_os", "size": "md", "filters": {}},
            ],
        )

    def test_retired_heartbeat_widgets_are_dropped_when_reading_but_never_saved(self):
        # NSK-HB-001 and NSK-MET-POL-001: views saved before a retirement open without those widgets.
        saved = {"widgets": [
            {"id": "users_total", "size": "sm", "filters": {}},
            {"id": "devices_heartbeat_active", "size": "sm", "filters": {}},
            {"id": "heartbeat_status", "size": "md", "filters": {}},
            {"id": "alerts_by_policy", "size": "md", "filters": {}},
            {"id": "devices_by_os", "size": "md", "filters": {}},
        ], "data_widgets": [], "chart_widgets": []}
        with patch(
            "app.netskope.sse.api.routes.netskope_dashboard_preferences.get_netskope_dashboard_preferences",
            new=AsyncMock(return_value=saved),
        ):
            response = asyncio.run(netskope_dashboard_preferences(self.request, "actor-old"))
        self.assertEqual([widget["id"] for widget in response["widgets"]], ["users_total", "devices_by_os"])
        self.assertEqual(response["data_widgets"], ["users_total"])
        self.assertEqual(response["chart_widgets"], ["devices_by_os"])
        for retired in RETIRED_WIDGETS:
            with self.subTest(retired=retired), self.assertRaises(ValidationError):
                NetskopeDashboardPreferenceUpdate(widgets=[{"id": retired}])

    def test_a_view_made_only_of_retired_widgets_falls_back_to_the_defaults(self):
        saved = {"widgets": [{"id": "devices_heartbeat_inactive", "size": "sm", "filters": {}}], "data_widgets": [], "chart_widgets": []}
        with patch(
            "app.netskope.sse.api.routes.netskope_dashboard_preferences.get_netskope_dashboard_preferences",
            new=AsyncMock(return_value=saved),
        ):
            response = asyncio.run(netskope_dashboard_preferences(self.request, "actor-old"))
        self.assertEqual(response["data_widgets"], DEFAULT_DATA_WIDGETS)
        self.assertNotIn("devices_heartbeat_active", DEFAULT_DATA_WIDGETS)

    def test_role_templates_drop_retired_widgets_too(self):
        template = {"role_code": "netskope_reader", "role_name": "Lector", "version": 2, "published_at": None, "widgets": [
            {"id": "devices_total", "size": "sm", "filters": {}},
            {"id": "devices_heartbeat_unknown", "size": "sm", "filters": {}},
        ]}
        with patch(
            "app.netskope.sse.api.routes.netskope_dashboard_preferences.list_actor_dashboard_templates",
            new=AsyncMock(return_value=[template]),
        ):
            response = asyncio.run(netskope_dashboard_templates(self.request, "actor-1"))
        self.assertEqual([widget["id"] for widget in response["templates"][0]["widgets"]], ["devices_total"])

    def test_unknown_and_duplicate_widgets_are_rejected(self):
        with self.assertRaises(ValidationError):
            NetskopeDashboardPreferenceUpdate(data_widgets=["unknown"], chart_widgets=[])
        with self.assertRaises(ValidationError):
            NetskopeDashboardPreferenceUpdate(data_widgets=["users_total", "users_total"], chart_widgets=[])
        with self.assertRaises(ValidationError):
            NetskopeDashboardPreferenceUpdate(widgets=[{"id": "unknown"}])
        with self.assertRaises(ValidationError):
            NetskopeDashboardPreferenceUpdate(widgets=[{"id": "users_total"}, {"id": "users_total"}])

    def test_widget_sizes_and_kind_limits_are_validated(self):
        with self.assertRaises(ValidationError):
            NetskopeDashboardPreferenceUpdate(widgets=[{"id": "users_total", "size": "xl"}])
        seven_data_widgets = [
            "users_total", "devices_total", "devices_stale_30d", "devices_observed_user_matched",
            "devices_observed_user_unmatched", "devices_with_observed_user", "alerts_7d",
        ]
        with self.assertRaises(ValidationError):
            NetskopeDashboardPreferenceUpdate(widgets=[{"id": widget} for widget in seven_data_widgets])

    def test_widget_filters_are_allowlisted_and_normalized(self):
        payload = NetskopeDashboardPreferenceUpdate(widgets=[{
            "id": "devices_by_os",
            "filters": {"os": "  Windows  ", "company": "ITTI", "classification_status": ""},
        }])
        self.assertEqual(
            payload.widgets[0].filters,
            {"os": "Windows", "company": "ITTI"},
        )
        with self.assertRaises(ValidationError):
            NetskopeDashboardPreferenceUpdate(widgets=[{"id": "devices_by_os", "filters": {"user_status": "active"}}])
        with self.assertRaises(ValidationError):
            NetskopeDashboardPreferenceUpdate(widgets=[{"id": "devices_by_os", "filters": {"os": "x" * 161}}])

    def test_filters_must_belong_to_the_specific_metric_contract(self):
        for widget_id, filters in (
            ("users_total", {"os": "Windows"}),
            ("users_recent_activity", {"classification_status": "managed"}),
            ("alerts_7d", {"company": "ITTI"}),
            ("alerts_by_severity", {"os": "Windows"}),
        ):
            with self.subTest(widget_id=widget_id), self.assertRaises(ValidationError):
                NetskopeDashboardPreferenceUpdate(widgets=[{"id": widget_id, "filters": filters}])

    def test_a_category_chart_keeps_its_donut_or_bars_choice(self):
        payload = NetskopeDashboardPreferenceUpdate(widgets=[
            {"id": "devices_by_company", "size": "md", "style": "donut"},
            {"id": "devices_by_os", "size": "md"},
        ])
        self.assertEqual([widget.style for widget in payload.widgets], ["donut", None])
        stored = {"widgets": [widget.model_dump() for widget in payload.widgets], "data_widgets": [], "chart_widgets": []}
        response = netskope_dashboard_preferences_module._response(stored)
        self.assertEqual(response["widgets"][0]["style"], "donut")
        self.assertNotIn("style", response["widgets"][1])

    def test_only_category_charts_accept_a_style(self):
        for widget_id in ("users_total", "alerts_7d", "alerts_by_severity"):
            with self.subTest(widget_id=widget_id), self.assertRaises(ValidationError):
                NetskopeDashboardPreferenceUpdate(widgets=[{"id": widget_id, "style": "donut"}])
        with self.assertRaises(ValidationError):
            NetskopeDashboardPreferenceUpdate(widgets=[{"id": "devices_by_os", "style": "line"}])

    def test_retired_alert_rankings_are_dropped_when_reading(self):
        saved = {"widgets": [{"id": "alerts_by_type", "size": "md", "filters": {}}, {"id": "alerts_by_action", "size": "md", "filters": {}}, {"id": "devices_by_os", "size": "md", "filters": {}}], "data_widgets": [], "chart_widgets": []}
        self.assertEqual([widget["id"] for widget in netskope_dashboard_preferences_module._response(saved)["widgets"]], ["devices_by_os"])
        for retired in ("alerts_by_type", "alerts_by_action"):
            with self.subTest(retired=retired), self.assertRaises(ValidationError):
                NetskopeDashboardPreferenceUpdate(widgets=[{"id": retired}])

    def test_preferences_are_saved_for_the_authenticated_actor(self):
        payload = NetskopeDashboardPreferenceUpdate(
            widgets=[
                {"id": "users_total", "size": "lg"},
                {"id": "devices_by_os", "size": "sm", "filters": {"os": "Windows"}},
            ],
        )
        saved = {
            "widgets": [widget.model_dump(exclude_none=True) for widget in payload.widgets],
            "data_widgets": ["users_total"], "chart_widgets": ["devices_by_os"], "updated_at": None,
        }
        with patch(
            "app.netskope.sse.api.routes.netskope_dashboard_preferences.save_netskope_dashboard_preferences",
            new=AsyncMock(return_value=saved),
        ) as save:
            response = asyncio.run(netskope_dashboard_preferences_update(payload, self.request, "actor-2"))
        self.assertFalse(response["is_default"])
        self.assertEqual(
            save.await_args.args[1:],
            (
                "actor-2",
                [
                    {"id": "users_total", "size": "lg", "filters": {}},
                    {"id": "devices_by_os", "size": "sm", "filters": {"os": "Windows"}},
                ],
                ["users_total"],
                ["devices_by_os"],
            ),
        )

    def test_repository_saves_and_audits_in_the_same_transaction(self):
        pool = _Pool()
        with patch(
            "app.netskope.sse.repositories.netskope_dashboard_preferences.record_audit", new=AsyncMock(),
        ) as audit:
            saved = asyncio.run(save_netskope_dashboard_preferences(
                pool, "actor-3",
                [{"id": "users_total", "size": "sm", "filters": {}}],
                ["users_total"], ["devices_by_os"],
            ))
        self.assertEqual(saved["widgets"], [{"id": "users_total", "size": "sm", "filters": {}}])
        self.assertIs(audit.await_args.kwargs["connection"], pool.connection_instance)
        self.assertEqual(audit.await_args.kwargs["entity_type"], "netskope_dashboard_preferences")
        self.assertEqual(
            audit.await_args.kwargs["after_data"]["widgets"],
            [{"id": "users_total", "size": "sm", "filters": {}}],
        )


if __name__ == "__main__":
    unittest.main()
