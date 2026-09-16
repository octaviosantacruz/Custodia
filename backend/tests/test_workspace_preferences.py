import asyncio
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from app.api.routes.workspace_preferences import WorkspacePreferencesUpdate, _validate_visible_per_domain, workspace_preferences_update
from app.repositories.workspace_preferences import save_workspace_preferences


class _Context:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *_):
        return False


class _Cursor:
    def __init__(self, saved):
        self.calls = []
        self.rows = [None, saved]

    async def execute(self, query, params=()):
        self.calls.append((query, params))

    async def fetchone(self):
        return self.rows.pop(0)


class _Connection:
    def __init__(self, saved):
        self.cursor_instance = _Cursor(saved)

    def transaction(self):
        return _Context(self)

    def cursor(self):
        return _Context(self.cursor_instance)


class _Pool:
    def __init__(self, saved):
        self.connection_instance = _Connection(saved)

    def connection(self):
        return _Context(self.connection_instance)


class WorkspacePreferencesRouteTests(unittest.TestCase):
    def setUp(self):
        self.request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=object())))

    def test_rejects_unknown_or_overlapping_workspace_preferences(self):
        with self.assertRaises(HTTPException) as unknown:
            asyncio.run(workspace_preferences_update(
                WorkspacePreferencesUpdate(visible_workspaces=["unknown"]), self.request, "operator",
            ))
        self.assertEqual(unknown.exception.status_code, 422)
        with self.assertRaises(HTTPException) as overlap:
            asyncio.run(workspace_preferences_update(
                WorkspacePreferencesUpdate(visible_workspaces=["safes"], hidden_workspaces=["safes"]), self.request, "operator",
            ))
        self.assertEqual(overlap.exception.status_code, 422)

    def test_quick_access_allows_six_pam_workspaces_plus_an_admin_shortcut(self):
        six_pam = ["general", "posture", "graph", "safes", "identity", "sia"]
        combined = [*six_pam, "users", "aimApplications"]
        self.assertEqual(WorkspacePreferencesUpdate(visible_workspaces=combined).visible_workspaces, combined)
        self.assertEqual(_validate_visible_per_domain(combined), combined)
        with self.assertRaises(HTTPException) as too_many_pam:
            _validate_visible_per_domain([*six_pam, "platforms"])
        self.assertEqual(too_many_pam.exception.status_code, 422)

    def test_saves_only_allowlisted_preferences_for_current_actor(self):
        payload = WorkspacePreferencesUpdate(
            visible_workspaces=["safes", "sia"],
            hidden_workspaces=["posture"],
            recent_workspaces=["sia", "safes"],
        )
        expected = {"visible_workspaces": ["safes", "sia"], "hidden_workspaces": ["posture"], "recent_workspaces": ["sia", "safes"]}
        with patch("app.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=expected)), patch(
            "app.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=expected),
        ) as save, patch(
            "app.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]),
        ):
            result = asyncio.run(workspace_preferences_update(payload, self.request, "operator"))
        self.assertEqual(result, expected)
        self.assertEqual(save.await_args.args[1], "operator")
        self.assertEqual(save.await_args.kwargs["visible_workspaces"], ["safes", "sia"])

    def test_accepts_platform_and_connector_workspaces_for_access_managers(self):
        payload = WorkspacePreferencesUpdate(
            visible_workspaces=["platforms", "connectors"],
        )
        expected = {"visible_workspaces": ["platforms", "connectors"], "hidden_workspaces": [], "recent_workspaces": []}
        with patch("app.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=expected)), patch(
            "app.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=expected),
        ) as save, patch(
            "app.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read", "access:manage"]),
        ):
            result = asyncio.run(workspace_preferences_update(payload, self.request, "operator"))

        self.assertEqual(result, expected)
        self.assertEqual(save.await_args.kwargs["visible_workspaces"], ["platforms", "connectors"])

    def test_accepts_assets_workspace_name(self):
        payload = WorkspacePreferencesUpdate(recent_workspaces=["assets"])
        expected = {"visible_workspaces": ["safes"], "hidden_workspaces": [], "recent_workspaces": ["assets"]}
        with patch("app.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value={"visible_workspaces": ["safes"], "hidden_workspaces": [], "recent_workspaces": []})), patch(
            "app.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=expected),
        ) as save, patch(
            "app.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]),
        ):
            result = asyncio.run(workspace_preferences_update(payload, self.request, "operator"))

        self.assertEqual(result["recent_workspaces"], ["assets"])
        self.assertEqual(save.await_args.kwargs["recent_workspaces"], ["assets"])

    def test_partial_update_preserves_preferences_not_sent_by_the_client(self):
        saved = {
            "visible_workspaces": ["safes", "posture"],
            "hidden_workspaces": ["identity"],
            "recent_workspaces": ["sia"],
        }
        updated = {**saved, "recent_workspaces": ["safes", "sia"]}
        with patch("app.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=updated),
        ) as save, patch(
            "app.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]),
        ):
            result = asyncio.run(workspace_preferences_update(
                WorkspacePreferencesUpdate(recent_workspaces=["safes", "sia"]), self.request, "operator",
            ))

        self.assertEqual(result, updated)
        self.assertEqual(save.await_args.kwargs["visible_workspaces"], saved["visible_workspaces"])
        self.assertEqual(save.await_args.kwargs["hidden_workspaces"], saved["hidden_workspaces"])
        self.assertEqual(save.await_args.kwargs["recent_workspaces"], ["safes", "sia"])

    def test_partial_update_preserves_restricted_entries_after_role_demotion(self):
        saved = {
            "visible_workspaces": ["safes", "graph"],
            "hidden_workspaces": [],
            "recent_workspaces": ["graph"],
        }
        persisted = {**saved, "recent_workspaces": ["graph", "safes"]}
        with patch("app.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=persisted),
        ) as save, patch(
            "app.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]),
        ):
            result = asyncio.run(workspace_preferences_update(
                WorkspacePreferencesUpdate(recent_workspaces=["safes"]), self.request, "operator",
            ))

        self.assertEqual(save.await_args.kwargs["visible_workspaces"], ["safes", "graph"])
        self.assertEqual(save.await_args.kwargs["recent_workspaces"], ["graph", "safes"])
        self.assertEqual(result["visible_workspaces"], ["safes"])
        self.assertEqual(result["recent_workspaces"], ["safes"])

    def test_repository_does_not_send_database_timestamp_to_json_audit(self):
        updated_at = datetime(2026, 9, 10, 12, 30, tzinfo=timezone.utc)
        saved_row = {
            "visible_workspaces": ["safes", "sia"],
            "hidden_workspaces": ["posture"],
            "recent_workspaces": ["sia"],
            "updated_at": updated_at,
        }
        pool = _Pool(saved_row)

        with patch("app.repositories.workspace_preferences.record_audit", new=AsyncMock()) as audit:
            saved = asyncio.run(save_workspace_preferences(
                pool,
                "operator",
                visible_workspaces=["safes", "sia"],
                hidden_workspaces=["posture"],
                recent_workspaces=["sia"],
            ))

        self.assertIs(saved["updated_at"], updated_at)
        self.assertEqual(audit.await_args.kwargs["after_data"], {
            "visible_workspaces": ["safes", "sia"],
            "hidden_workspaces": ["posture"],
            "recent_workspaces": ["sia"],
        })
        self.assertIs(audit.await_args.kwargs["connection"], pool.connection_instance)


if __name__ == "__main__":
    unittest.main()
