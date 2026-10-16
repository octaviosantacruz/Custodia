"""ACCESS-OIDC-HEALTH-001: deterministic OIDC diagnostic coverage.

Covers the four mandatory deterministic warnings (empty role mapping,
unknown/inactive destination role, privileged default role, missing group
claim), the local/hybrid/oidc distinction, the read-only repository query and
the guarantee that no secret material ever reaches the payload.
"""
import asyncio
import json
import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.cross.api.routes.access_control import oidc_health as oidc_health_route
from app.cross.api.routes.access_models import OidcHealthResponse
from app.cross.repositories.auth_queries import get_oidc_login_summary
from app.cross.services import oidc_health

BASE_ENV = {
    "OIDC_GROUP_CLAIM": "groups",
    "OIDC_ROLE_MAP_JSON": '{"sg_ds-hub_admins": "admin"}',
    "OIDC_DEFAULT_ROLE": "",
    "OIDC_SCOPES": "openid profile email",
}


def _role(role_code: str, status: str = "active", permissions: tuple[str, ...] = (), display: str = "Rol"):
    return {
        "role_code": role_code,
        "display_name": display,
        "lifecycle_status": status,
        "permission_codes": list(permissions),
    }


def _payload(**overrides):
    payload = {
        "mode": "local",
        "enabled": False,
        "configured": False,
        "issuer": None,
        "scopes": "openid profile email",
        "redirect_uri_configured": False,
        "group_claim": None,
        "group_claim_effective": "groups",
        "default_role": None,
        "default_role_status": None,
        "default_role_display_name": None,
        "role_map": [],
        "last_oidc_login_at": None,
        "oidc_identity_count": 0,
        "warnings": [],
    }
    payload.update(overrides)
    return payload


def _warnings(env_overrides: dict, roles: dict, config_overrides: dict | None = None):
    with patch.object(oidc_health, "AUTH_MODE", "hybrid"), \
         patch.object(oidc_health, "OIDC_CONFIGURED", True), \
         patch.dict(os.environ, {**BASE_ENV, **env_overrides}, clear=True):
        config = oidc_health.collect_oidc_configuration()
    config.update(config_overrides or {})
    return oidc_health.build_warnings(config, roles)


class OidcModeTests(unittest.TestCase):
    def test_local_mode_is_disabled_and_inert_mapping_never_warns(self):
        with patch.object(oidc_health, "AUTH_MODE", "local"), \
             patch.object(oidc_health, "OIDC_CONFIGURED", False), \
             patch.dict(os.environ, {**BASE_ENV, "OIDC_DEFAULT_ROLE": "admin"}, clear=True):
            config = oidc_health.collect_oidc_configuration()
            warnings = oidc_health.build_warnings(config, {})
        self.assertEqual(config["mode"], "local")
        self.assertFalse(config["enabled"])
        self.assertEqual(warnings, [])

    def test_hybrid_mode_is_reported_as_hybrid_and_enabled(self):
        with patch.object(oidc_health, "AUTH_MODE", "hybrid"), \
             patch.object(oidc_health, "OIDC_CONFIGURED", True), \
             patch.object(oidc_health, "OIDC_ISSUER_URL", "https://idp.example.test"), \
             patch.dict(os.environ, BASE_ENV, clear=True):
            config = oidc_health.collect_oidc_configuration()
        self.assertEqual(config["mode"], "hybrid")
        self.assertTrue(config["enabled"])
        self.assertTrue(config["configured"])
        self.assertEqual(config["issuer"], "https://idp.example.test")

    def test_oidc_mode_is_reported_as_enabled(self):
        with patch.object(oidc_health, "AUTH_MODE", "OIDC"), \
             patch.object(oidc_health, "OIDC_CONFIGURED", True), \
             patch.dict(os.environ, BASE_ENV, clear=True):
            config = oidc_health.collect_oidc_configuration()
        self.assertEqual(config["mode"], "oidc")
        self.assertTrue(config["enabled"])

    def test_unknown_auth_mode_falls_back_to_local_like_the_auth_routes(self):
        with patch.object(oidc_health, "AUTH_MODE", "kerberos"), \
             patch.dict(os.environ, BASE_ENV, clear=True):
            config = oidc_health.collect_oidc_configuration()
        self.assertEqual(config["mode"], "local")
        self.assertFalse(config["enabled"])


class OidcHealthWarningTests(unittest.TestCase):
    def test_empty_role_mapping_warns(self):
        codes = [warning["code"] for warning in _warnings({"OIDC_ROLE_MAP_JSON": "{}"}, {})]
        self.assertEqual(codes, ["role_map_empty"])

    def test_missing_group_claim_warns(self):
        warnings = _warnings({"OIDC_GROUP_CLAIM": ""}, {"admin": _role("admin")})
        self.assertEqual([warning["code"] for warning in warnings], ["group_claim_missing"])
        self.assertIn("OIDC_GROUP_CLAIM", warnings[0]["message"])

    def test_unknown_destination_role_warns_with_the_group_context(self):
        warnings = _warnings({"OIDC_ROLE_MAP_JSON": '{"sg_ds-hub_futuro": "ghost_role"}'}, {})
        self.assertEqual([warning["code"] for warning in warnings], ["role_unknown"])
        self.assertIn("sg_ds-hub_futuro", warnings[0]["message"])
        self.assertIn("ghost_role", warnings[0]["message"])

    def test_inactive_destination_role_warns_with_its_lifecycle_status(self):
        warnings = _warnings(
            {"OIDC_ROLE_MAP_JSON": '{"sg_ds-hub_futuro": "planned_role"}'},
            {"planned_role": _role("planned_role", status="planned")},
        )
        self.assertEqual([warning["code"] for warning in warnings], ["role_inactive"])
        self.assertIn("planned", warnings[0]["message"])

    def test_privileged_default_role_warns(self):
        warnings = _warnings(
            {"OIDC_ROLE_MAP_JSON": '{"sg_ds-hub_lectores": "reader"}', "OIDC_DEFAULT_ROLE": "admin"},
            {
                "reader": _role("reader", permissions=("inventory:read",)),
                "admin": _role("admin", permissions=("access:manage", "inventory:read")),
            },
        )
        self.assertEqual([warning["code"] for warning in warnings], ["default_role_privileged"])
        self.assertIn("access:manage", warnings[0]["message"])

    def test_unknown_default_role_warns_and_is_not_privileged(self):
        warnings = _warnings(
            {"OIDC_ROLE_MAP_JSON": '{"sg_ds-hub_lectores": "reader"}', "OIDC_DEFAULT_ROLE": "ghost"},
            {"reader": _role("reader", permissions=("inventory:read",))},
        )
        self.assertEqual([warning["code"] for warning in warnings], ["role_unknown"])
        self.assertIn("default role", warnings[0]["message"])

    def test_oidc_enabled_without_configuration_warns(self):
        with patch.object(oidc_health, "AUTH_MODE", "oidc"), \
             patch.object(oidc_health, "OIDC_CONFIGURED", False), \
             patch.dict(os.environ, BASE_ENV, clear=True):
            config = oidc_health.collect_oidc_configuration()
        warnings = oidc_health.build_warnings(config, {"admin": _role("admin")})
        self.assertEqual([warning["code"] for warning in warnings], ["oidc_not_configured"])

    def test_invalid_role_map_json_warns_once_instead_of_crashing(self):
        warnings = _warnings({"OIDC_ROLE_MAP_JSON": "{not-json"}, {})
        self.assertEqual([warning["code"] for warning in warnings], ["role_map_invalid"])

    def test_combined_warnings_keep_the_declared_deterministic_order(self):
        with patch.object(oidc_health, "AUTH_MODE", "hybrid"), \
             patch.object(oidc_health, "OIDC_CONFIGURED", False), \
             patch.dict(os.environ, {
                 "OIDC_ROLE_MAP_JSON": '{"sg_ds-hub_futuro": "planned_role"}',
                 "OIDC_DEFAULT_ROLE": "admin",
             }, clear=True):
            config = oidc_health.collect_oidc_configuration()
        warnings = oidc_health.build_warnings(config, {
            "planned_role": _role("planned_role", status="planned"),
            "admin": _role("admin", permissions=("access:manage",)),
        })
        self.assertEqual(
            [warning["code"] for warning in warnings],
            ["oidc_not_configured", "group_claim_missing", "role_inactive", "default_role_privileged"],
        )


class OidcLoginSummaryQueryTests(unittest.IsolatedAsyncioTestCase):
    @patch("app.cross.repositories.auth_queries.fetch_one", new_callable=AsyncMock)
    async def test_reads_last_login_and_identity_count(self, fetch_one):
        moment = datetime(2026, 9, 20, tzinfo=timezone.utc)
        fetch_one.return_value = {"last_login_at": moment, "identities": 3}
        result = await get_oidc_login_summary(object())
        query = fetch_one.await_args.args[1]
        self.assertIn("max(last_login_at)", query)
        self.assertIn("public.access_oidc_users", query)
        self.assertEqual(result, {"last_login_at": moment, "identities": 3})

    @patch("app.cross.repositories.auth_queries.fetch_one", new_callable=AsyncMock)
    async def test_no_login_yet_is_null_not_an_invented_date(self, fetch_one):
        fetch_one.return_value = {"last_login_at": None, "identities": 0}
        result = await get_oidc_login_summary(object())
        self.assertIsNone(result["last_login_at"])
        self.assertEqual(result["identities"], 0)


class OidcHealthCollectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_payload_enriches_role_map_and_never_exposes_secret_values(self):
        roles = [
            _role("admin", permissions=("access:manage",), display="Administrador"),
            _role("planned_role", status="planned", display="Preparado"),
        ]
        login = {"last_login_at": datetime(2026, 9, 20, tzinfo=timezone.utc), "identities": 3}
        with patch.object(oidc_health, "AUTH_MODE", "hybrid"), \
             patch.object(oidc_health, "OIDC_CONFIGURED", True), \
             patch.object(oidc_health, "OIDC_ISSUER_URL", "https://idp.example.test"), \
             patch.dict(os.environ, {
                 **BASE_ENV,
                 "OIDC_ROLE_MAP_JSON": '{"sg_ds-hub_admins": "admin", "sg_ds-hub_futuro": "planned_role"}',
                 "OIDC_DEFAULT_ROLE": "admin",
                 "OIDC_CLIENT_SECRET": "super-secret-value",
             }, clear=True), \
             patch.object(oidc_health, "list_roles", new=AsyncMock(return_value=roles)), \
             patch.object(oidc_health, "get_oidc_login_summary", new=AsyncMock(return_value=login)), \
             patch.object(oidc_health, "stored_group_role_pairs", new=AsyncMock(return_value=None)):
            result = await oidc_health.collect_oidc_health(object())

        OidcHealthResponse.model_validate(result)
        entries = {entry["group"]: entry for entry in result["role_map"]}
        self.assertTrue(entries["sg_ds-hub_admins"]["role_exists"])
        self.assertEqual(entries["sg_ds-hub_admins"]["role_status"], "active")
        self.assertEqual(entries["sg_ds-hub_admins"]["role_display_name"], "Administrador")
        self.assertTrue(entries["sg_ds-hub_futuro"]["role_exists"])
        self.assertEqual(entries["sg_ds-hub_futuro"]["role_status"], "planned")
        self.assertEqual(result["default_role"], "admin")
        self.assertEqual(result["default_role_status"], "active")
        self.assertEqual(result["default_role_display_name"], "Administrador")
        self.assertEqual(result["last_oidc_login_at"], login["last_login_at"])
        self.assertEqual(result["oidc_identity_count"], 3)
        self.assertEqual(
            [warning["code"] for warning in result["warnings"]],
            ["role_inactive", "default_role_privileged"],
        )
        serialized = json.dumps(result, default=str)
        self.assertNotIn("super-secret-value", serialized)
        self.assertNotIn("client_secret", serialized)
        self.assertNotIn("client_id", serialized)
        self.assertNotIn("token", serialized)


class OidcHealthRouteTests(unittest.TestCase):
    def test_route_returns_the_service_payload(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=object())))
        with patch(
            "app.cross.api.routes.access_control.collect_oidc_health",
            new=AsyncMock(return_value=_payload()),
        ) as service:
            result = asyncio.run(oidc_health_route(request, actor_id="admin"))
        self.assertEqual(result["mode"], "local")
        service.assert_awaited_once_with(request.app.state.db)


if __name__ == "__main__":
    unittest.main()
