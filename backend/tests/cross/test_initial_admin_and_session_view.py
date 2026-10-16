import unittest
from unittest.mock import AsyncMock, patch

from app.cross.services import initial_admin as admin
from app.cross.services import session_view as view


class InitialAdminServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_register_normalizes_identity_and_stores_only_the_hash(self):
        create = AsyncMock()
        with patch.object(admin, "hash_password_async", new=AsyncMock(return_value="$argon2id$h")), \
             patch.object(admin, "create_first_local_admin", new=create):
            actor = await admin.register_first_admin("pool", "  Admin@Example.COM ", " Ana ", "pw")
        self.assertEqual(actor, "admin@example.com")
        create.assert_awaited_once_with("pool", "admin@example.com", "Ana", "$argon2id$h")

    async def test_register_rejects_blank_email_after_hashing_and_never_persists(self):
        create = AsyncMock()
        with patch.object(admin, "hash_password_async", new=AsyncMock(return_value="h")), patch.object(admin, "create_first_local_admin", new=create):
            with self.assertRaises(admin.InvalidInitialAdminError):
                await admin.register_first_admin("pool", "   ", "Ana", "pw")
        create.assert_not_awaited()

    async def test_password_policy_error_propagates_before_any_write(self):
        create = AsyncMock()
        with patch.object(admin, "hash_password_async", new=AsyncMock(side_effect=ValueError("política"))), \
             patch.object(admin, "create_first_local_admin", new=create):
            with self.assertRaises(ValueError):
                await admin.register_first_admin("pool", "a@x.com", "Ana", "weak")
        create.assert_not_awaited()

    async def test_register_translates_the_race_loser(self):
        with patch.object(admin, "hash_password_async", new=AsyncMock(return_value="h")), \
             patch.object(admin, "create_first_local_admin", new=AsyncMock(side_effect=admin.FirstUserAlreadyExists("ya"))):
            with self.assertRaises(admin.InitialAdminAlreadyExistsError):
                await admin.register_first_admin("pool", "a@x.com", "Ana", "pw")

    async def test_bootstrap_checks_emptiness_before_hashing(self):
        hasher = AsyncMock()
        with patch.object(admin, "count_local_users", new=AsyncMock(return_value=1)), patch.object(admin, "hash_password_async", new=hasher):
            with self.assertRaises(admin.InitialAdminAlreadyExistsError):
                await admin.bootstrap_first_admin("pool", "a@x.com", "Ana", "pw")
        hasher.assert_not_awaited()


class SessionViewTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_account_overrides_session_roles_and_is_persisted(self):
        account = {"roles": ["admin"], "role_names": None, "must_change_password": 0}
        with patch.object(view, "get_local_account_status", new=AsyncMock(return_value=account)):
            user, persist = await view.refresh_session_user("p", "a", {"roles": ["stale"], "name": "A"}, local_auth_enabled=True)
        self.assertTrue(persist)
        self.assertEqual(user, {"roles": ["admin"], "role_names": [], "must_change_password": False, "name": "A"})

    async def test_oidc_session_uses_role_assignments_without_persisting(self):
        names = {"roles": ["reader"], "role_names": ["Lector"]}
        with patch.object(view, "get_role_assignment_names", new=AsyncMock(return_value=names)):
            user, persist = await view.refresh_session_user("p", "a", {"name": "A"}, local_auth_enabled=False)
        self.assertFalse(persist)
        self.assertEqual(user["roles"], ["reader"])

    async def test_anonymous_touches_nothing(self):
        guard = AsyncMock(side_effect=AssertionError)
        with patch.object(view, "get_local_account_status", new=guard), patch.object(view, "get_role_assignment_names", new=guard):
            self.assertEqual(await view.refresh_session_user("p", None, None, local_auth_enabled=True), (None, False))


if __name__ == "__main__":
    unittest.main()
