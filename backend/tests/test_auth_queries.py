"""SQL-shape and transaction regression coverage for
repositories/auth_queries.py -- moved here from auth_session.py/
auth_bootstrap.py's own tests once the raw SQL moved into this module.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.auth_queries import (
    FirstUserAlreadyExists, count_local_users, create_bootstrap_admin, create_first_local_admin,
    find_local_user_for_login, get_local_account_status, get_role_assignment_names, get_session_version,
)


class AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


class FakeCursor:
    def __init__(self, fetchone_results=None):
        self.execute_calls: list[tuple[str, tuple]] = []
        self._fetchone_results = list(fetchone_results or [])

    async def execute(self, query, params=()):
        self.execute_calls.append((query, params))

    async def fetchone(self):
        return self._fetchone_results.pop(0)


class FakeConnection:
    def __init__(self, cursor: FakeCursor):
        self.cursor_value = cursor

    def transaction(self):
        return AsyncContext(None)

    def cursor(self):
        return AsyncContext(self.cursor_value)


class FakePool:
    def __init__(self, connection: FakeConnection):
        self.connection_value = connection

    def connection(self):
        return AsyncContext(self.connection_value)


class CountLocalUsersTests(unittest.TestCase):
    def test_returns_zero_when_no_row_is_found(self):
        with patch("app.repositories.auth_queries.fetch_one", new=AsyncMock(return_value=None)):
            result = asyncio.run(count_local_users(object()))
        self.assertEqual(result, 0)

    def test_returns_the_row_count(self):
        with patch("app.repositories.auth_queries.fetch_one", new=AsyncMock(return_value={"count": 3})):
            result = asyncio.run(count_local_users(object()))
        self.assertEqual(result, 3)


class FindLocalUserForLoginTests(unittest.TestCase):
    def test_query_filters_by_lowercase_email_and_active_users(self):
        with patch("app.repositories.auth_queries.fetch_one", new=AsyncMock(return_value=None)) as fetch_one:
            asyncio.run(find_local_user_for_login(object(), "Reader@Example.com"))
        query, params = fetch_one.await_args.args[1], fetch_one.await_args.args[2]
        self.assertIn("lower(email) = lower(%s)", query)
        self.assertIn("is_active = true", query)
        self.assertIn("session_version", query)
        self.assertEqual(params, ("Reader@Example.com",))


class GetSessionVersionTests(unittest.TestCase):
    """PENTEST-004: require_read_access/require_write_access compare this
    against the session's cached value on every request."""

    def test_returns_the_current_version_for_an_active_account(self):
        with patch("app.repositories.auth_queries.fetch_one", new=AsyncMock(return_value={"session_version": 3})) as fetch_one:
            result = asyncio.run(get_session_version(object(), "reader-1"))
        self.assertEqual(result, 3)
        query, params = fetch_one.await_args.args[1], fetch_one.await_args.args[2]
        self.assertIn("is_active = true", query)
        self.assertEqual(params, ("reader-1",))

    def test_returns_none_for_a_missing_or_deactivated_account(self):
        with patch("app.repositories.auth_queries.fetch_one", new=AsyncMock(return_value=None)):
            result = asyncio.run(get_session_version(object(), "ghost"))
        self.assertIsNone(result)


class GetLocalAccountStatusTests(unittest.TestCase):
    def test_scopes_by_actor_id_and_active_users(self):
        with patch("app.repositories.auth_queries.fetch_one", new=AsyncMock(return_value=None)) as fetch_one:
            asyncio.run(get_local_account_status(object(), "reader-1"))
        query, params = fetch_one.await_args.args[1], fetch_one.await_args.args[2]
        self.assertIn("actor_id = %s AND is_active = true", query)
        self.assertEqual(params, ("reader-1",))


class GetRoleAssignmentNamesTests(unittest.TestCase):
    def test_returns_empty_lists_when_the_actor_has_no_roles(self):
        with patch("app.repositories.auth_queries.fetch_one", new=AsyncMock(return_value=None)):
            result = asyncio.run(get_role_assignment_names(object(), "ghost"))
        self.assertEqual(result, {"roles": [], "role_names": []})

    def test_returns_the_aggregated_role_names(self):
        with patch(
            "app.repositories.auth_queries.fetch_one",
            new=AsyncMock(return_value={"roles": ["security_lead"], "role_names": ["Responsable de seguridad"]}),
        ):
            result = asyncio.run(get_role_assignment_names(object(), "oidc-user"))
        self.assertEqual(result, {"roles": ["security_lead"], "role_names": ["Responsable de seguridad"]})


class CreateFirstLocalAdminTests(unittest.TestCase):
    def test_rejects_once_an_account_already_exists(self):
        cursor = FakeCursor(fetchone_results=[{"count": 1}])
        pool = FakePool(FakeConnection(cursor))
        with self.assertRaises(FirstUserAlreadyExists):
            asyncio.run(create_first_local_admin(pool, "admin@example.com", "Admin", "hash"))
        # Only the advisory lock + count check ran; no INSERT was attempted.
        self.assertEqual(len(cursor.execute_calls), 2)

    def test_creates_the_admin_under_an_advisory_lock(self):
        cursor = FakeCursor(fetchone_results=[{"count": 0}])
        pool = FakePool(FakeConnection(cursor))
        asyncio.run(create_first_local_admin(pool, "admin@example.com", "Admin", "hash"))
        queries = [call[0] for call in cursor.execute_calls]
        self.assertIn("pg_advisory_xact_lock", queries[0])
        self.assertIn("count(*)", queries[1])
        self.assertIn("INSERT INTO public.access_users", queries[2])
        self.assertIn("INSERT INTO public.access_user_roles", queries[3])
        self.assertIn("'admin'", queries[3])
        self.assertEqual(cursor.execute_calls[3][1], ("admin@example.com",))


class CreateBootstrapAdminTests(unittest.TestCase):
    def test_inserts_the_user_then_the_role_with_a_conflict_safe_insert(self):
        cursor = FakeCursor()
        pool = FakePool(FakeConnection(cursor))
        asyncio.run(create_bootstrap_admin(pool, "admin@example.com", "Admin", "hash"))
        queries = [call[0] for call in cursor.execute_calls]
        self.assertIn("INSERT INTO public.access_users", queries[0])
        self.assertIn("ON CONFLICT DO NOTHING", queries[1])


if __name__ == "__main__":
    unittest.main()
