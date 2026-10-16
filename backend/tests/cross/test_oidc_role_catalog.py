import asyncio
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from app.cross.api.routes.access_control import roles


class OidcRoleCatalogTests(unittest.TestCase):
    def test_roles_expose_configured_okta_groups_without_changing_permissions(self):
        catalog = [
            {"role_code": "admin", "permission_codes": ["access:manage"]},
            {"role_code": "reader", "permission_codes": ["inventory:read"]},
        ]
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=object())))
        with patch("app.cross.services.access_management.list_roles", new=AsyncMock(return_value=catalog)), \
             patch("app.cross.api.routes.access_control.get_actor_permissions", new=AsyncMock(return_value=["access:manage"])), \
             patch("app.cross.services.access_management.effective_role_pairs", new=AsyncMock(return_value=(
                 [("sg_ds-hub_admins", "admin"), ("sg_ds-hub_lectores", "reader")], "environment",
             ))):
            result = asyncio.run(roles(request, actor_id="admin"))
        self.assertEqual(result["rows"][0]["oidc_groups"], ["sg_ds-hub_admins"])
        self.assertEqual(result["rows"][1]["oidc_groups"], ["sg_ds-hub_lectores"])
        self.assertEqual(result["rows"][0]["permission_codes"], ["access:manage"])
        self.assertNotIn("oidc_groups", catalog[0])

    def test_roles_redact_okta_groups_without_mapping_permission(self):
        catalog = [{"role_code": "reader", "permission_codes": ["inventory:read"]}]
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=object())))
        with patch("app.cross.services.access_management.list_roles", new=AsyncMock(return_value=catalog)), \
             patch("app.cross.api.routes.access_control.get_actor_permissions", new=AsyncMock(return_value=["access:roles_read"])), \
             patch("app.cross.services.access_management.effective_role_pairs", new=AsyncMock(return_value=([("sg_ds-hub_lectores", "reader")], "environment"))) as pairs:
            result = asyncio.run(roles(request, actor_id="role-reader"))
        self.assertEqual(result["rows"][0]["oidc_groups"], [])
        pairs.assert_not_awaited()  # without the permission the mapping is not even read


if __name__ == "__main__":
    unittest.main()
