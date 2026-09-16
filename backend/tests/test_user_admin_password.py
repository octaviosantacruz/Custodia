import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.auth import hash_password
from app.repositories.user_admin import change_own_password, generate_temp_password, list_users, reissue_temporary_password, update_user


class GenerateTempPasswordTests(unittest.TestCase):
    def test_generated_password_satisfies_local_policy(self):
        for _ in range(50):
            password = generate_temp_password()
            hash_password(password)  # raises ValueError if the policy rejects it

    def test_generated_passwords_are_not_repeated(self):
        passwords = {generate_temp_password() for _ in range(20)}
        self.assertEqual(len(passwords), 20)


class ListUsersTests(unittest.TestCase):
    def test_list_users_selects_onboarding_status(self):
        with patch("app.repositories.user_admin.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            asyncio.run(list_users(object()))

        query = fetch_all.await_args.args[1]
        self.assertIn("u.must_change_password", query)

    def test_list_users_applies_search_role_and_pending_status_filters(self):
        with patch("app.repositories.user_admin.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            asyncio.run(list_users(object(), search="ana", role_filter="operator", status_filter="pending", limit=25, offset=25))

        _pool, query, params = fetch_all.await_args.args
        self.assertIn("r.role_code = %s", query)
        self.assertIn("u.must_change_password = true", query)
        self.assertEqual(params, ("ana", "ana", "ana", "operator", 25, 25))

    def test_list_users_omits_role_and_status_clauses_when_unset(self):
        with patch("app.repositories.user_admin.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            asyncio.run(list_users(object()))

        _pool, query, _params = fetch_all.await_args.args
        self.assertNotIn("r.role_code = %s", query)
        self.assertNotIn("u.is_active = true", query)


class _AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


class _FakeCursor:
    def __init__(self, fetchone_values):
        self.execute_calls = []
        self.fetchone_values = list(fetchone_values)

    async def execute(self, query, params=()):
        self.execute_calls.append((query, params))

    async def fetchone(self):
        return self.fetchone_values.pop(0)


class _FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor
        self.execute = AsyncMock()

    def transaction(self):
        return _AsyncContext(None)

    def cursor(self):
        return _AsyncContext(self.cursor_value)


class _FakePool:
    def __init__(self, connection):
        self.connection_value = connection

    def connection(self):
        return _AsyncContext(self.connection_value)


class ReissueTemporaryPasswordTests(unittest.TestCase):
    def test_reissues_password_and_flags_must_change_password(self):
        cursor = _FakeCursor([{"is_active": True, "must_change_password": False}])
        pool = _FakePool(_FakeConnection(cursor))

        password = asyncio.run(reissue_temporary_password(pool, "user@example.com", "admin@example.com"))

        self.assertIsInstance(password, str)
        hash_password(password)  # raises if the generated password fails the policy
        update_query, update_params = cursor.execute_calls[1]
        self.assertIn("must_change_password = true", update_query)
        self.assertEqual(update_params[1], "user@example.com")

    def test_returns_none_for_inactive_user(self):
        cursor = _FakeCursor([{"is_active": False, "must_change_password": False}])
        pool = _FakePool(_FakeConnection(cursor))

        result = asyncio.run(reissue_temporary_password(pool, "user@example.com", "admin@example.com"))

        self.assertIsNone(result)
        self.assertEqual(len(cursor.execute_calls), 1)  # only the SELECT ran, no UPDATE

    def test_returns_none_for_missing_user(self):
        cursor = _FakeCursor([None])
        pool = _FakePool(_FakeConnection(cursor))

        result = asyncio.run(reissue_temporary_password(pool, "ghost@example.com", "admin@example.com"))

        self.assertIsNone(result)

    def test_bumps_session_version_so_a_stolen_session_is_invalidated(self):
        """PENTEST-004: an admin-issued temporary password must invalidate
        any session already open for that account, the same way a
        self-service password change does."""
        cursor = _FakeCursor([{"is_active": True, "must_change_password": False}])
        pool = _FakePool(_FakeConnection(cursor))

        asyncio.run(reissue_temporary_password(pool, "user@example.com", "admin@example.com"))

        update_query, _params = cursor.execute_calls[1]
        self.assertIn("session_version = session_version + 1", update_query)


class ChangeOwnPasswordTests(unittest.TestCase):
    def test_bumps_session_version_and_returns_the_new_value(self):
        """PENTEST-004: the caller (auth_session.py's change_password route)
        must stamp this returned value into the *current* session so that
        session doesn't invalidate itself, while every other copy of the
        session (e.g. a stolen cookie) fails its next version check."""
        current_hash = hash_password("Sample123456789!")
        cursor = _FakeCursor([
            {"password_hash": current_hash, "data": {}},  # SELECT ... FOR UPDATE
            {"session_version": 4},  # UPDATE ... RETURNING session_version
        ])
        pool = _FakePool(_FakeConnection(cursor))

        new_version = asyncio.run(change_own_password(pool, "user@example.com", "Sample123456789!", "NewPassw0rd123456!"))

        self.assertEqual(new_version, 4)
        update_query, _params = cursor.execute_calls[1]
        self.assertIn("session_version = session_version + 1", update_query)
        self.assertIn("RETURNING session_version", update_query)


class UpdateUserSessionVersionTests(unittest.TestCase):
    """PENTEST-004: an admin resetting someone's password or deactivating
    their account must invalidate any session already open for it; an
    unrelated change (e.g. just their display name) must not."""

    def test_bumps_session_version_when_an_admin_sets_a_new_password(self):
        cursor = _FakeCursor([{"data": {}}, {"data": {}}])
        pool = _FakePool(_FakeConnection(cursor))

        asyncio.run(update_user(pool, "user@example.com", None, None, None, "NewPassw0rd123456!", "admin@example.com"))

        update_query = cursor.execute_calls[1][0]
        self.assertIn("session_version = session_version + 1", update_query)

    def test_bumps_session_version_when_an_admin_deactivates_the_account(self):
        cursor = _FakeCursor([{"data": {}}, {"is_active": True}, {"count": 5}, {"has_admin": True}, {"data": {}}])
        pool = _FakePool(_FakeConnection(cursor))

        asyncio.run(update_user(pool, "user@example.com", None, False, None, None, "admin@example.com"))

        update_query = [call[0] for call in cursor.execute_calls if "UPDATE public.access_users SET" in call[0]][0]
        self.assertIn("session_version = session_version + 1", update_query)

    def test_does_not_bump_session_version_for_an_unrelated_display_name_change(self):
        cursor = _FakeCursor([{"data": {}}, {"data": {}}])
        pool = _FakePool(_FakeConnection(cursor))

        asyncio.run(update_user(pool, "user@example.com", "Nuevo Nombre", None, None, None, "admin@example.com"))

        update_query = cursor.execute_calls[1][0]
        self.assertNotIn("session_version", update_query)


if __name__ == '__main__':
    unittest.main()
