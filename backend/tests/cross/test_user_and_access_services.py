import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, PropertyMock, patch

from psycopg.errors import UniqueViolation

from app.cross.services import access_management as access
from app.cross.services import user_management as users


def _unique_violation(constraint: str) -> UniqueViolation:
    exc = UniqueViolation("duplicate key value violates unique constraint")
    patcher = patch.object(type(exc), "diag", new_callable=PropertyMock, return_value=SimpleNamespace(constraint_name=constraint))
    patcher.start()
    return exc


class UserManagementServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        patch.stopall()

    async def test_register_rejects_unknown_role_before_persisting(self):
        create = AsyncMock()
        with patch.object(users, "role_exists", new=AsyncMock(return_value=False)), patch.object(users, "create_user", new=create):
            with self.assertRaises(users.UnknownRoleError):
                await users.register_user(object(), "a@x.com", "A", "ghost", "admin")
        create.assert_not_awaited()

    async def test_register_maps_only_known_constraints_to_duplicate(self):
        with patch.object(users, "role_exists", new=AsyncMock(return_value=True)), \
             patch.object(users, "create_user", new=AsyncMock(side_effect=_unique_violation("uq_access_users_email_lower"))):
            with self.assertRaises(users.DuplicateUserError):
                await users.register_user(object(), "a@x.com", "A", "reader", "admin")
        with patch.object(users, "role_exists", new=AsyncMock(return_value=True)), \
             patch.object(users, "create_user", new=AsyncMock(side_effect=_unique_violation("other"))):
            with self.assertRaises(UniqueViolation):
                await users.register_user(object(), "a@x.com", "A", "reader", "admin")

    async def test_modify_blocks_self_demotion_before_role_lookup_and_update(self):
        update = AsyncMock()
        with patch.object(users, "role_grants_permission", new=AsyncMock(return_value=False)), \
             patch.object(users, "update_user", new=update):
            with self.assertRaises(users.SelfAdminLockoutError):
                await users.modify_user(object(), "me", None, None, "reader", None, "me")
        update.assert_not_awaited()

    async def test_modify_without_role_skips_role_checks(self):
        with patch.object(users, "role_exists", new=AsyncMock(side_effect=AssertionError)), \
             patch.object(users, "update_user", new=AsyncMock(return_value=True)):
            self.assertTrue(await users.modify_user(object(), "u", "N", None, None, None, "admin"))


class AccessManagementServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_duplicate_key_becomes_domain_error(self):
        with patch.object(access, "create_role", new=AsyncMock(side_effect=RuntimeError("Duplicate KEY value"))):
            with self.assertRaises(access.DuplicateRoleError):
                await access.add_role(object(), actor_id="a", role_code="x")
        with patch.object(access, "create_permission", new=AsyncMock(side_effect=RuntimeError("duplicate key"))):
            with self.assertRaises(access.DuplicatePermissionError):
                await access.add_permission(object(), actor_id="a")

    async def test_ceiling_and_validation_errors_pass_through(self):
        with patch.object(access, "create_role", new=AsyncMock(side_effect=access.DelegationCeilingError("no"))):
            with self.assertRaises(access.DelegationCeilingError):
                await access.add_role(object(), actor_id="a")
        with patch.object(access, "create_composite_role", new=AsyncMock(side_effect=ValueError("bad"))):
            with self.assertRaises(ValueError):
                await access.add_composite_role(object(), role_code="r", display_name="d", description="d", level_refs=[], actor_id="a")

    async def test_oidc_groups_are_only_exposed_when_allowed(self):
        roles = [{"role_code": "reader"}, {"role_code": "admin"}]
        with patch.object(access, "list_roles", new=AsyncMock(return_value=roles)), \
             patch.object(access, "effective_role_pairs", new=AsyncMock(return_value=([("g2", "reader"), ("g1", "reader")], "database"))):
            shown = await access.role_catalog(object(), include_oidc_groups=True)
            hidden = await access.role_catalog(object(), include_oidc_groups=False)
        self.assertEqual(shown[0]["oidc_groups"], ["g1", "g2"])
        self.assertEqual(shown[1]["oidc_groups"], [])
        self.assertEqual([r["oidc_groups"] for r in hidden], [[], []])


if __name__ == "__main__":
    unittest.main()
