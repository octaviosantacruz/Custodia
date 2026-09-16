"""IF-002: at least one active local user must always retain effective
access:manage. Covers the shared invariant helper directly, plus its
wiring into every mutation that can reduce the active-admin set."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.access_control import update_composite_role, update_role
from app.repositories.admin_invariant import assert_at_least_one_active_admin, lock_admin_invariant
from app.repositories.user_admin import delete_user, update_user


class _AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


class _FakeCursor:
    def __init__(self, fetchone_values, fetchall_values=None):
        self.execute_calls = []
        self.fetchone_values = list(fetchone_values)
        self.fetchall_values = list(fetchall_values or [])

    async def execute(self, query, params=()):
        self.execute_calls.append((query, params))

    async def fetchone(self):
        return self.fetchone_values.pop(0)

    async def fetchall(self):
        return self.fetchall_values.pop(0)

    async def executemany(self, query, seq):
        self.execute_calls.append((query, list(seq)))


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


class AdminInvariantHelperTests(unittest.TestCase):
    def test_lock_uses_an_advisory_transaction_lock_keyed_by_a_stable_name(self):
        cursor = _FakeCursor([])
        asyncio.run(lock_admin_invariant(cursor))
        query, params = cursor.execute_calls[0]
        self.assertIn("pg_advisory_xact_lock", query)
        self.assertEqual(params, ("dshub-effective-admin",))

    def test_raises_when_no_active_admin_would_remain(self):
        cursor = _FakeCursor([{"has_admin": False}])
        with self.assertRaisesRegex(ValueError, "sin ningún administrador activo"):
            asyncio.run(assert_at_least_one_active_admin(cursor))

    def test_does_not_raise_when_an_active_admin_remains(self):
        cursor = _FakeCursor([{"has_admin": True}])
        asyncio.run(assert_at_least_one_active_admin(cursor))  # must not raise


class UpdateUserAdminInvariantTests(unittest.TestCase):
    def test_rejects_a_role_change_that_would_strip_the_last_admin(self):
        cursor = _FakeCursor([
            {"data": {}},              # SELECT before FOR UPDATE
            {"roles": ["admin"]},      # SELECT before_roles
            {"has_admin": False},      # assert_at_least_one_active_admin
        ])
        pool = _FakePool(_FakeConnection(cursor))

        with self.assertRaisesRegex(ValueError, "sin ningún administrador activo"):
            asyncio.run(update_user(pool, "only-admin@example.com", None, None, "reader", None, "only-admin@example.com"))

        lock_calls = [q for q, _ in cursor.execute_calls if "pg_advisory_xact_lock" in q]
        self.assertEqual(len(lock_calls), 1)

    def test_allows_a_role_change_that_keeps_an_active_admin(self):
        cursor = _FakeCursor([
            {"data": {}},
            {"roles": ["operator"]},
            {"has_admin": True},
            {"data": {}},
        ])
        pool = _FakePool(_FakeConnection(cursor))

        result = asyncio.run(update_user(pool, "user@example.com", None, None, "admin", None, "admin@example.com"))
        self.assertTrue(result)

    def test_rejects_an_empty_patch(self):
        with self.assertRaisesRegex(ValueError, "no modifica ningún campo"):
            asyncio.run(update_user(object(), "user@example.com", None, None, None, None, "admin@example.com"))

    def test_does_not_lock_or_check_the_invariant_for_an_unrelated_change(self):
        """A display-name-only change can't affect who has access:manage --
        it must not pay for the lock/invariant check at all."""
        cursor = _FakeCursor([{"data": {}}, {"data": {}}])
        pool = _FakePool(_FakeConnection(cursor))

        asyncio.run(update_user(pool, "user@example.com", "Nuevo Nombre", None, None, None, "admin@example.com"))

        lock_calls = [q for q, _ in cursor.execute_calls if "pg_advisory_xact_lock" in q]
        self.assertEqual(lock_calls, [])


class DeleteUserAdminInvariantTests(unittest.TestCase):
    def test_rejects_deleting_the_last_active_admin(self):
        cursor = _FakeCursor([
            {"data": {}, "is_active": True},  # SELECT target FOR UPDATE
            {"count": 5},                      # active users count (well above 1)
            {"has_admin": False},              # assert_at_least_one_active_admin, post-delete
        ])
        pool = _FakePool(_FakeConnection(cursor))

        with self.assertRaisesRegex(ValueError, "sin ningún administrador activo"):
            asyncio.run(delete_user(pool, "only-admin@example.com", "someone-else@example.com"))

        lock_calls = [q for q, _ in cursor.execute_calls if "pg_advisory_xact_lock" in q]
        self.assertEqual(len(lock_calls), 1)

    def test_allows_deleting_a_non_admin_active_user(self):
        cursor = _FakeCursor([
            {"data": {}, "is_active": True},
            {"count": 5},
            {"has_admin": True},
        ])
        pool = _FakePool(_FakeConnection(cursor))

        result = asyncio.run(delete_user(pool, "user@example.com", "admin@example.com"))
        self.assertTrue(result)

    def test_inactive_target_never_touches_the_admin_invariant(self):
        """Deleting an already-inactive user can't change who's an active
        admin -- the invariant check must not even run."""
        cursor = _FakeCursor([{"data": {}, "is_active": False}])
        pool = _FakePool(_FakeConnection(cursor))

        result = asyncio.run(delete_user(pool, "user@example.com", "admin@example.com"))
        self.assertTrue(result)
        self.assertEqual(cursor.fetchone_values, [])  # nothing extra was consumed


class UpdateRoleAdminInvariantTests(unittest.TestCase):
    def test_rejects_stripping_access_manage_from_a_custom_role_that_is_the_last_admin_source(self):
        cursor = _FakeCursor(
            fetchone_values=[
                {"data": {}, "system_managed": False, "role_kind": "direct"},  # SELECT role FOR UPDATE
                {"codes": ["access:manage"]},  # before_permission_codes
                {"1": 1},  # domain exists
                {"has_admin": False},  # assert_at_least_one_active_admin
            ],
            fetchall_values=[[{"permission_code": "inventory:read"}]],
        )
        pool = _FakePool(_FakeConnection(cursor))

        with self.assertRaisesRegex(ValueError, "sin ningún administrador activo"):
            asyncio.run(update_role(
                pool, role_code="custom_admin", display_name="Custom", description="d",
                domain_code="pam", permission_codes=["inventory:read"], actor_id="admin@example.com",
            ))

        lock_calls = [q for q, _ in cursor.execute_calls if "pg_advisory_xact_lock" in q]
        self.assertEqual(len(lock_calls), 1)


class UpdateCompositeRoleAdminInvariantTests(unittest.TestCase):
    def test_rejects_editing_levels_away_from_the_last_admin_source(self):
        with patch("app.repositories.access_control._validate_level_selections", new=AsyncMock(return_value=({"pam"}, "active"))), \
             patch("app.repositories.access_control._find_duplicate_combination", new=AsyncMock(return_value=None)):
            cursor = _FakeCursor(
                fetchone_values=[
                    {"data": {}, "role_kind": "composite", "system_managed": False},  # SELECT role FOR UPDATE
                    {"has_admin": False},  # assert_at_least_one_active_admin
                ],
                fetchall_values=[[]],  # before_level_refs: empty for this fixture
            )
            pool = _FakePool(_FakeConnection(cursor))

            with self.assertRaisesRegex(ValueError, "sin ningún administrador activo"):
                asyncio.run(update_composite_role(
                    pool, role_code="custom_composite", display_name="Custom", description="d",
                    level_refs=[{"domain_code": "pam", "level_code": "reader"}], actor_id="admin@example.com",
                ))

        lock_calls = [q for q, _ in cursor.execute_calls if "pg_advisory_xact_lock" in q]
        self.assertEqual(len(lock_calls), 1)


if __name__ == "__main__":
    unittest.main()
