"""AUD-API-002 block 5: exact-shape proof for the preference responses.

The OpenAPI tests validate representative payloads against the declared
models; this file drives the real routes over ASGI and asserts the JSON is
exactly the dict the route built. That is what catches the regression
`response_model_exclude_unset=True` exists for: a declared optional extra
(`buckets`, `chart_data`, `data_status`, ...) must not appear as an invented
`null` when the evaluating branch never set it, and no envelope key may be
added or dropped.
"""

import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app
from app.cyberark.pam.schemas import DashboardPreferenceUpdate


def _definition(**overrides):
    payload = {
        'widget_id': 'widget', 'title': 'Widget', 'kind': 'goal',
        'filters': {'inventory_scope': 'business', 'data_quality_status': 'clean'},
        'target_value': 400, 'target_direction': 'at_least', 'period_label': 'Q4 2026',
    }
    payload.update(overrides)
    return DashboardPreferenceUpdate(widgets=[payload]).widgets[0].model_dump()


class PreferencesResponseContractHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_dashboard_widgets_keep_their_exact_evaluated_shape(self):
        self.session.set_permissions(["inventory:read"])
        definitions = [
            _definition(),
            _definition(widget_id='count', title='Dato', kind='count', target_value=None,
                        target_direction=None, period_label=None),
            _definition(widget_id='coverage', title='Cobertura', kind='count',
                        measure='safe_account_coverage', value_format='percentage',
                        filters={}, target_value=None, target_direction=None, period_label=None),
            _definition(widget_id='by-unit', title='Por unidad', kind='chart', measure='safes',
                        chart={'style': 'pie', 'group_by': 'business_unit'},
                        target_value=None, target_direction=None, period_label=None),
            _definition(widget_id='heatmap', title='Mapa', kind='chart', measure='safes',
                        chart={'style': 'heatmap', 'group_by': 'business_unit_workflow'},
                        filters={}, target_value=None, target_direction=None, period_label=None),
            _definition(widget_id='degraded', title='Degradado', kind='chart', measure='safes',
                        chart={'style': 'bars', 'group_by': 'next_action'},
                        target_value=None, target_direction=None, period_label=None),
        ]
        evaluated = [
            {**definitions[0], 'value': 315},
            {**definitions[1], 'value': 12},
            {**definitions[2], 'value': 87.84, 'data_status': 'available',
             'covered_count': 383, 'total_count': 436},
            {**definitions[3], 'value': 15,
             'buckets': [{'key': 'Pagos', 'filter_value': 'Pagos', 'count': 12},
                         {'key': 'Otros', 'count': 3}]},
            {**definitions[4], 'buckets': [], 'value': 7,
             'chart_data': {'x_labels': ['UENO'], 'y_labels': ['pending'],
                            'cells': [{'x': 0, 'y': 0, 'value': 7,
                                       'filter_value': '{"business_unit": "4", "workflow_status": "pending"}'}]}},
            {**definitions[5], 'value': 0, 'buckets': [], 'chart_data': None,
             'data_status': 'unavailable'},
        ]
        with patch("app.cyberark.pam.api.routes.dashboard_preferences.get_dashboard_preferences",
                   new=AsyncMock(return_value={"widgets": definitions, "updated_at": None})), \
             patch("app.cyberark.pam.api.routes.dashboard_preferences.evaluate_dashboard_widgets",
                   new=AsyncMock(return_value=evaluated)):
            response = await self.client.get("/api/dashboard/preferences")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertFalse(body["is_default"])
        self.assertEqual(body["widgets"], evaluated)

    async def test_dashboard_preview_omits_is_default_and_invented_extras(self):
        self.session.set_permissions(["inventory:read"])
        definition = _definition(widget_id='count', title='Dato', kind='count',
                                 target_value=None, target_direction=None, period_label=None)
        evaluated = [{**definition, 'value': 12}]
        with patch("app.cyberark.pam.api.routes.dashboard_preferences.evaluate_dashboard_widgets",
                   new=AsyncMock(return_value=evaluated)):
            response = await self.client.post(
                "/api/dashboard/preferences/preview", json={"widgets": [definition]}
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"widgets": evaluated})

    async def test_netskope_preferences_response_is_exact(self):
        # The router gate accepts netskope:read, but the route itself also
        # requires the inventory read permission.
        self.session.set_permissions(["netskope:read", "inventory:read"])
        saved = {
            "widgets": [{"id": "users_total", "size": "sm", "filters": {}},
                        {"id": "devices_by_os", "size": "md", "filters": {"os": "Windows"}}],
            "data_widgets": ["users_total"],
            "chart_widgets": ["devices_by_os"],
            "updated_at": None,
        }
        with patch("app.netskope.sse.api.routes.netskope_dashboard_preferences.get_netskope_dashboard_preferences",
                   new=AsyncMock(return_value=saved)):
            response = await self.client.get("/api/dashboard/netskope/preferences")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {
            "widgets": saved["widgets"],
            "data_widgets": ["users_total"],
            "chart_widgets": ["devices_by_os"],
            "is_default": False,
        })

    async def test_workspace_preferences_response_is_exact(self):
        self.session.set_permissions(["inventory:read"])
        updated_at = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
        saved = {
            "visible_workspaces": ["general", "safes"],
            "hidden_workspaces": [],
            "recent_workspaces": ["safes"],
            "updated_at": updated_at,
        }
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences",
                   new=AsyncMock(return_value=saved)), \
             patch("app.cross.api.routes.workspace_preferences.get_actor_permissions",
                   new=AsyncMock(return_value=["inventory:read"])):
            response = await self.client.get("/api/workspaces/preferences")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body), set(saved))
        self.assertEqual(body["visible_workspaces"], ["general", "safes"])
        self.assertEqual(body["hidden_workspaces"], [])
        self.assertEqual(body["recent_workspaces"], ["safes"])
        self.assertEqual(datetime.fromisoformat(body["updated_at"]), updated_at)
