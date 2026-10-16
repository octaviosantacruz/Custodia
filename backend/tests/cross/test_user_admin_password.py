import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.auth import hash_password
from app.cross.repositories.user_admin import change_own_password, create_user, generate_temp_password, list_people, list_users, reissue_temporary_password, update_user
from tests.support.fake_pg import FakeConnection as _FakeConnection, FakeCursor as _FakeCursor, FakePool as _FakePool


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
        with patch("app.cross.repositories.user_admin.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            asyncio.run(list_users(object()))

        query = fetch_all.await_args.args[1]
        self.assertIn("u.must_change_password", query)
        self.assertIn("FROM public.access_oidc_users", query)
        self.assertIn("'oidc'::text AS auth_source", query)

    def test_list_users_returns_oidc_identity_with_roles_and_source(self):
        row = {
            "actor_id": "okta-sub", "email": "user@example.com", "display_name": "Okta User",
            "is_active": True, "must_change_password": False, "auth_source": "oidc",
            "roles": ["admin"], "last_login_at": "2026-09-17T12:00:00Z", "total_count": 2,
        }
        with patch("app.cross.repositories.user_admin.fetch_all", new=AsyncMock(return_value=[row])):
            result = asyncio.run(list_users(object()))
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["rows"][0]["auth_source"], "oidc")
        self.assertEqual(result["rows"][0]["roles"], ["admin"])
        self.assertNotIn("total_count", result["rows"][0])

    def test_list_users_applies_search_role_and_pending_status_filters(self):
        with patch("app.cross.repositories.user_admin.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            asyncio.run(list_users(object(), search="ana", role_filter="operator", status_filter="pending", limit=25, offset=25))

        _pool, query, params = fetch_all.await_args.args
        self.assertIn("r.role_code = %s", query)
        self.assertIn("u.must_change_password = true", query)
        self.assertEqual(params, ("ana", "ana", "ana", "operator", 25, 25))

    def test_list_users_omits_role_and_status_clauses_when_unset(self):
        with patch("app.cross.repositories.user_admin.fetch_all", new=AsyncMock(return_value=[])) as fetch_all:
            asyncio.run(list_users(object()))

        _pool, query, _params = fetch_all.await_args.args
        self.assertNotIn("r.role_code = %s", query)
        self.assertNotIn("u.is_active = true", query)


class ListPeopleTests(unittest.TestCase):
    def test_groups_matching_email_without_combining_identity_roles(self):
        rows = [
            {"person_key": "user@example.com", "total_count": 2, "actor_id": "okta-sub", "email": "User@example.com", "display_name": "Okta User", "auth_source": "oidc", "roles": ["reader"]},
            {"person_key": "user@example.com", "total_count": 2, "actor_id": "user@example.com", "email": "user@example.com", "display_name": "Local User", "auth_source": "local", "roles": ["admin"]},
        ]
        with patch("app.cross.repositories.user_admin.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_people(object(), search="user", role_filter="admin", limit=20, offset=0))
        self.assertEqual(result["total"], 2)
        self.assertEqual(len(result["rows"]), 1)
        self.assertEqual(result["rows"][0]["display_name"], "Okta User")
        self.assertEqual([identity["roles"] for identity in result["rows"][0]["identities"]], [["reader"], ["admin"]])
        query, params = fetch_all.await_args.args[1:]
        self.assertIn("lower(btrim(email))", query)
        self.assertIn("bool_or(%s = ANY(u.roles))", query)
        self.assertIn("count(*) OVER ()", query)
        self.assertEqual(params, ("user", "user", "user", "admin", "admin", "", "", 20, 0))


class CreateUserTests(unittest.TestCase):
    def test_oidc_subject_cannot_be_created_as_local_account(self):
        cursor = _FakeCursor([{"exists": 1}])
        pool = _FakePool(_FakeConnection(cursor))
        with patch("app.cross.repositories.user_admin.hash_password_async", new=AsyncMock(return_value="hash")):
            with self.assertRaisesRegex(ValueError, "identidad OIDC"):
                asyncio.run(create_user(pool, "subject@example.com", "Nombre", "reader", "admin@example.com"))
        self.assertEqual(len(cursor.execute_calls), 2)
        self.assertIn("pg_advisory_xact_lock", cursor.execute_calls[0][0])
        self.assertIn("access_oidc_users", cursor.execute_calls[1][0])


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
