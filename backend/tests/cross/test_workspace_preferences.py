import asyncio
import re
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from app.cross.api.routes.workspace_preferences import (
    ALLOWED_WORKSPACES,
    QUICK_ACCESS_WORKSPACES_BY_DOMAIN,
    WorkspacePreferencesUpdate,
    _validate,
    _validate_visible_per_domain,
    workspace_preferences,
    workspace_preferences_update,
)
from app.cross.repositories.workspace_preferences import save_workspace_preferences

FRONTEND_SRC = Path(__file__).resolve().parents[3] / "frontend" / "src"


def _catalog_entries() -> list[dict]:
    """Parse id/domain/switcher from every frontend tool registration.

    Workspaces are declared in each tool's `source.ts` (composed by
    `frontend/src/sources.ts`). The backend keeps its own allowlist because it
    validates persisted preferences; this is the bridge that keeps both sides
    from drifting."""
    entries = []
    for path in sorted(FRONTEND_SRC.glob("**/source.ts")):
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"\n    \{\s*\n\s*id:\s*'([^']+)'(.*?)\n    \},", text, re.DOTALL):
            body = match.group(2)
            domain = re.search(r"domain:\s*'([^']+)'", body)
            entries.append({
                "id": match.group(1),
                "domain": domain.group(1) if domain else "",
                "switcher": "switcher: true" in body,
            })
    return entries


class WorkspaceCatalogContractTests(unittest.TestCase):
    """The backend rejects unknown ids on every preference save, so a catalog
    addition that is not mirrored here surfaces as "Workspace desconocido" in
    the UI. Regression: identityGraph, person and netskopeChains were added to
    the catalog without the mirror, and saving preferences failed with a 422."""

    def test_every_catalog_workspace_is_allowlisted(self):
        catalog_ids = {entry["id"] for entry in _catalog_entries()}
        self.assertGreater(len(catalog_ids), 20)
        self.assertEqual(catalog_ids - ALLOWED_WORKSPACES, set())

    def test_quick_access_domains_mirror_the_switcher_workspaces(self):
        expected: dict[str, set[str]] = {}
        for entry in _catalog_entries():
            if entry["switcher"]:
                expected.setdefault(entry["domain"], set()).add(entry["id"])
        self.assertEqual(QUICK_ACCESS_WORKSPACES_BY_DOMAIN, expected)

    def test_chain_workspaces_added_by_the_catalog_are_accepted(self):
        for view in ("graph", "person", "netskopeChains"):
            with self.subTest(view=view):
                self.assertEqual(_validate([view], "recent_workspaces"), [view])


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

    def test_quick_access_allows_six_pam_workspaces_plus_a_custodia_shortcut(self):
        six_pam = ["general", "posture", "graph", "safes", "identity", "sia"]
        combined = [*six_pam, "person"]
        self.assertEqual(WorkspacePreferencesUpdate(visible_workspaces=combined).visible_workspaces, combined)
        self.assertEqual(_validate_visible_per_domain(combined), combined)
        # Inventario became a seventh CyberArk destination (2026-10-10); like
        # Netskope, the domain now has more destinations than the per-tool cap,
        # so pinning all of them is rejected.
        self.assertEqual(QUICK_ACCESS_WORKSPACES_BY_DOMAIN["pam"], {*six_pam, "assets"})
        with self.assertRaises(HTTPException) as over_cap:
            _validate_visible_per_domain([*six_pam, "assets"])
        self.assertEqual(over_cap.exception.status_code, 422)

    def test_saves_only_allowlisted_preferences_for_current_actor(self):
        payload = WorkspacePreferencesUpdate(
            visible_workspaces=["safes", "sia"],
            hidden_workspaces=["posture"],
            recent_workspaces=["sia", "safes"],
        )
        expected = {"visible_workspaces": ["safes", "sia"], "hidden_workspaces": ["posture"], "recent_workspaces": ["sia", "safes"]}
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=expected)), patch(
            "app.cross.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=expected),
        ) as save, patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]),
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
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=expected)), patch(
            "app.cross.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=expected),
        ) as save, patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read", "access:manage"]),
        ):
            result = asyncio.run(workspace_preferences_update(payload, self.request, "operator"))

        self.assertEqual(result, expected)
        self.assertEqual(save.await_args.kwargs["visible_workspaces"], ["platforms", "connectors"])

    def test_accepts_assets_workspace_name(self):
        payload = WorkspacePreferencesUpdate(recent_workspaces=["assets"])
        expected = {"visible_workspaces": ["safes"], "hidden_workspaces": [], "recent_workspaces": ["assets"]}
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value={"visible_workspaces": ["safes"], "hidden_workspaces": [], "recent_workspaces": []})), patch(
            "app.cross.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=expected),
        ) as save, patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]),
        ):
            result = asyncio.run(workspace_preferences_update(payload, self.request, "operator"))

        self.assertEqual(result["recent_workspaces"], ["assets"])
        self.assertEqual(save.await_args.kwargs["recent_workspaces"], ["assets"])

    def test_accepts_netskope_workspaces_for_netskope_readers(self):
        views = ["netskope", "netskopeOperations", "netskopePosture", "netskopeInventory"]
        payload = WorkspacePreferencesUpdate(visible_workspaces=views, recent_workspaces=["netskopeDevices"])
        expected = {"visible_workspaces": views, "hidden_workspaces": [], "recent_workspaces": ["netskopeDevices"]}
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=expected)), patch(
            "app.cross.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=expected),
        ) as save, patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read", "netskope:read"]),
        ):
            result = asyncio.run(workspace_preferences_update(payload, self.request, "netskope-reader"))

        self.assertEqual(result, expected)
        self.assertEqual(save.await_args.kwargs["visible_workspaces"], views)

    def test_rejects_and_depurates_the_retired_netskope_investigation_workspace(self):
        # Regression: the frontend now saves netskopeInventory, and the
        # retired Investigación id must neither be accepted in a write nor
        # survive in stored preferences.
        with self.assertRaises(HTTPException) as unknown:
            asyncio.run(workspace_preferences_update(
                WorkspacePreferencesUpdate(visible_workspaces=["netskopeInventory", "netskopeAlerts"]),
                self.request, "netskope-reader",
            ))
        self.assertEqual(unknown.exception.status_code, 422)
        self.assertIn("netskopeAlerts", unknown.exception.detail)

        saved = {
            "visible_workspaces": ["netskopeInventory", "netskopeAlerts"],
            "hidden_workspaces": ["netskopeAlerts"],
            "recent_workspaces": ["netskopeAlerts", "netskopeDevices"],
        }
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read", "netskope:read"]),
        ):
            result = asyncio.run(workspace_preferences(self.request, "netskope-reader"))

        self.assertEqual(result["visible_workspaces"], ["netskopeInventory"])
        self.assertEqual(result["hidden_workspaces"], [])
        self.assertEqual(result["recent_workspaces"], ["netskopeDevices"])

        expected = {"visible_workspaces": ["netskopeInventory"], "hidden_workspaces": [], "recent_workspaces": ["netskopeDevices"]}
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.cross.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=expected),
        ) as save, patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read", "netskope:read"]),
        ):
            asyncio.run(workspace_preferences_update(
                WorkspacePreferencesUpdate(recent_workspaces=["netskopeDevices"]), self.request, "netskope-reader",
            ))

        self.assertEqual(save.await_args.kwargs["visible_workspaces"], ["netskopeInventory"])
        self.assertEqual(save.await_args.kwargs["hidden_workspaces"], [])
        self.assertEqual(save.await_args.kwargs["recent_workspaces"], ["netskopeDevices"])

    def test_hides_strict_dlp_alerts_preferences_without_the_narrow_permission(self):
        # NSK-DLP-001: netskopeDlp is a strict workspace; access:manage and
        # netskope:read do NOT unlock it.
        saved = {
            "visible_workspaces": ["safes", "netskope", "netskopeDlp"],
            "hidden_workspaces": [],
            "recent_workspaces": ["netskopeDlp"],
        }
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions",
            new=AsyncMock(return_value=["inventory:read", "access:manage", "netskope:read"]),
        ):
            result = asyncio.run(workspace_preferences(self.request, "netskope-reader"))

        self.assertEqual(result["visible_workspaces"], ["safes", "netskope"])
        self.assertEqual(result["recent_workspaces"], [])

        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions",
            new=AsyncMock(return_value=["inventory:read", "netskope:read", "netskope:dlp_read"]),
        ):
            granted = asyncio.run(workspace_preferences(self.request, "dlp-reader"))

        self.assertEqual(granted["visible_workspaces"], ["safes", "netskope", "netskopeDlp"])
        self.assertEqual(granted["recent_workspaces"], ["netskopeDlp"])

    def test_uci_workspace_is_opened_only_by_the_strict_uba_permission(self):
        saved = {"visible_workspaces": ["netskope", "netskopeUci"], "hidden_workspaces": [], "recent_workspaces": ["netskopeUci"]}
        from app.cross.api.routes.workspace_preferences import workspace_preferences
        for permissions, expected in (
            (["inventory:read", "netskope:read"], ["netskope"]),
            (["inventory:read", "access:manage", "netskope:read", "netskope:dlp_read"], ["netskope"]),
            (["inventory:read", "netskope:read", "netskope:uba_read"], ["netskope", "netskopeUci"]),
        ):
            with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
                "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=permissions),
            ):
                result = asyncio.run(workspace_preferences(self.request, "reader"))
            self.assertEqual(result["visible_workspaces"], expected, permissions)

    def test_admins_workspace_is_opened_only_by_the_strict_admin_inventory_permission(self):
        saved = {"visible_workspaces": ["netskope", "netskopeAdmins"], "hidden_workspaces": [], "recent_workspaces": ["netskopeAdmins"]}
        from app.cross.api.routes.workspace_preferences import workspace_preferences
        for permissions, expected in (
            (["inventory:read", "netskope:read"], ["netskope"]),
            (["inventory:read", "access:manage", "netskope:read", "netskope:uba_read", "netskope:dlp_read"], ["netskope"]),
            (["inventory:read", "netskope:read", "netskope:admin_inventory_read"], ["netskope", "netskopeAdmins"]),
        ):
            with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
                "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=permissions),
            ):
                result = asyncio.run(workspace_preferences(self.request, "reader"))
            self.assertEqual(result["visible_workspaces"], expected, permissions)

    def test_netskope_posture_workspace_follows_the_ordinary_netskope_read_permission(self):
        saved = {"visible_workspaces": ["safes", "netskopePosture"], "hidden_workspaces": [], "recent_workspaces": ["netskopePosture"]}
        from app.cross.api.routes.workspace_preferences import workspace_preferences
        for permissions, expected in (
            (["inventory:read"], ["safes"]),
            (["inventory:read", "netskope:uba_read"], ["safes"]),
            (["inventory:read", "netskope:read"], ["safes", "netskopePosture"]),
            (["inventory:read", "access:manage"], ["safes", "netskopePosture"]),
        ):
            with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
                "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=permissions),
            ):
                result = asyncio.run(workspace_preferences(self.request, "reader"))
            self.assertEqual(result["visible_workspaces"], expected, permissions)

    def test_retired_client_coverage_is_removed_from_saved_preferences_for_every_reader(self):
        saved = {
            "visible_workspaces": ["person", "personCoverage"],
            "hidden_workspaces": ["personCoverage"],
            "recent_workspaces": ["personCoverage", "person"],
        }
        for permissions in (
            ["inventory:read", "netskope:read"],
            ["inventory:read", "identity:catalogs_read"],
            ["inventory:read", "identity:catalogs_read", "netskope:read"],
            ["inventory:read", "access:manage"],
        ):
            with self.subTest(permissions=permissions), patch(
                "app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved),
            ), patch(
                "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=permissions),
            ):
                result = asyncio.run(workspace_preferences(self.request, "reader"))
            self.assertEqual(result["visible_workspaces"], ["person"])
            self.assertEqual(result["hidden_workspaces"], [])
            self.assertEqual(result["recent_workspaces"], ["person"])

        # Stale clients cannot persist the retired destination again.
        for field in ("visible_workspaces", "hidden_workspaces", "recent_workspaces"):
            with self.subTest(field=field), patch(
                "app.cross.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(),
            ) as save, self.assertRaises(HTTPException) as write:
                asyncio.run(workspace_preferences_update(
                    WorkspacePreferencesUpdate(**{field: ["personCoverage"]}), self.request, "admin",
                ))
            self.assertEqual(write.exception.status_code, 422)
            save.assert_not_awaited()

    def test_hides_netskope_preferences_without_netskope_permission(self):
        saved = {"visible_workspaces": ["safes", "netskope", "netskopeOperations"], "hidden_workspaces": [], "recent_workspaces": ["netskopeUsers"]}
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]),
        ):
            from app.cross.api.routes.workspace_preferences import workspace_preferences
            result = asyncio.run(workspace_preferences(self.request, "reader"))

        self.assertEqual(result["visible_workspaces"], ["safes"])
        self.assertEqual(result["recent_workspaces"], [])

    def test_drops_retired_identity_graph_and_hides_netskope_chain_without_permission(self):
        saved = {
            "visible_workspaces": ["safes", "identityGraph", "netskopeChains"],
            "hidden_workspaces": [],
            "recent_workspaces": ["identityGraph", "netskopeChains"],
        }
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions",
            new=AsyncMock(return_value=["inventory:read", "identity:catalogs_read"]),
        ):
            result = asyncio.run(workspace_preferences(self.request, "identity-reader"))

        # identityGraph is retired (folded into Relaciones) and never returned;
        # netskopeChains stays stored but is not returned without netskope:read.
        self.assertEqual(result["visible_workspaces"], ["safes"])
        self.assertEqual(result["recent_workspaces"], [])
        with self.assertRaises(HTTPException) as write:
            _validate(["identityGraph"], "recent_workspaces")
        self.assertEqual(write.exception.status_code, 422)

    def test_discards_retired_workspace_from_legacy_preferences(self):
        saved = {
            "visible_workspaces": ["safes", "aimApplications"],
            "hidden_workspaces": ["aimApplications"],
            "recent_workspaces": ["aimApplications", "safes"],
        }
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]),
        ):
            result = asyncio.run(workspace_preferences(self.request, "reader"))
        self.assertEqual(result["visible_workspaces"], ["safes"])
        self.assertEqual(result["hidden_workspaces"], [])
        self.assertEqual(result["recent_workspaces"], ["safes"])

        expected = {"visible_workspaces": ["safes"], "hidden_workspaces": [], "recent_workspaces": ["safes"]}
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.cross.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=expected),
        ) as save, patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]),
        ):
            result = asyncio.run(workspace_preferences_update(
                WorkspacePreferencesUpdate(recent_workspaces=["safes"]), self.request, "reader",
            ))
        self.assertEqual(save.await_args.kwargs["visible_workspaces"], ["safes"])
        self.assertEqual(save.await_args.kwargs["hidden_workspaces"], [])
        self.assertEqual(save.await_args.kwargs["recent_workspaces"], ["safes"])
        self.assertEqual(result, expected)

    def test_drops_the_retired_access_assets_sia_target_set_and_steering_views(self):
        saved = {
            "visible_workspaces": ["safes", "accessAssets", "sia", "netskopeSteering", "netskopePolicies"],
            "hidden_workspaces": ["siaTargetSets"],
            "recent_workspaces": ["siaTargetSets", "assets", "accessAssets"],
        }
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions",
            new=AsyncMock(return_value=["inventory:read", "pam:catalogs_read", "sia:catalogs_read"]),
        ):
            result = asyncio.run(workspace_preferences(self.request, "reader"))
        self.assertEqual(result["visible_workspaces"], ["safes", "sia"])
        self.assertEqual(result["hidden_workspaces"], [])
        self.assertEqual(result["recent_workspaces"], ["assets"])
        for view in ("accessAssets", "siaTargetSets", "netskopeSteering", "netskopePolicies"):
            with self.subTest(view=view), self.assertRaises(HTTPException) as write:
                _validate([view], "recent_workspaces")
            self.assertEqual(write.exception.status_code, 422)

    def test_partial_update_preserves_preferences_not_sent_by_the_client(self):
        saved = {
            "visible_workspaces": ["safes", "posture"],
            "hidden_workspaces": ["identity"],
            "recent_workspaces": ["sia"],
        }
        updated = {**saved, "recent_workspaces": ["safes", "sia"]}
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.cross.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=updated),
        ) as save, patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]),
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
        with patch("app.cross.api.routes.workspace_preferences.get_workspace_preferences", new=AsyncMock(return_value=saved)), patch(
            "app.cross.api.routes.workspace_preferences.save_workspace_preferences", new=AsyncMock(return_value=persisted),
        ) as save, patch(
            "app.cross.api.routes.workspace_preferences.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]),
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

        with patch("app.cross.repositories.workspace_preferences.record_audit", new=AsyncMock()) as audit:
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
