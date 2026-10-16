"""IF-002 / ACCESS-CEILING-001: repository invariants for access mutations.

IF-002: at least one active local user must always retain effective
access:manage.

ACCESS-CEILING-001: a delegated actor can never grant more than they hold --
neither through a direct role's permission bundle, a composite role's level
selection, nor a role assigned to a user."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.cross.repositories.access_control import create_composite_role, create_role, update_composite_role, update_role
from app.cross.repositories.access_delegation import (
    DelegationCeilingError,
    assert_composite_levels_within_ceiling,
    assert_delegation_ceiling,
    assert_role_assignment_ceiling,
)
from app.cross.repositories.admin_invariant import ADMIN_INVARIANT_LOCK_KEY, assert_at_least_one_active_admin, lock_admin_invariant
from app.cross.repositories.user_admin import create_user, delete_user, update_user
from tests.support.fake_pg import FakeConnection as _FakeConnection, FakeCursor as _FakeCursor, FakePool as _FakePool


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
            {"codes": ["access:manage"]},  # ACCESS-CEILING-001: superpermission bypass
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
            {"codes": ["access:manage"]},  # ACCESS-CEILING-001: superpermission bypass
            {"has_admin": True},
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
                {"codes": ["inventory:read"]},  # ACCESS-CEILING-001: actor holds the requested subset
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
        with patch("app.cross.repositories.access_control._validate_level_selections", new=AsyncMock(return_value=({"pam"}, "active"))), \
             patch("app.cross.repositories.access_control._find_duplicate_combination", new=AsyncMock(return_value=None)):
            cursor = _FakeCursor(
                fetchone_values=[
                    {"data": {}, "role_kind": "composite", "system_managed": False},  # SELECT role FOR UPDATE
                    {"codes": ["access:manage"]},  # ACCESS-CEILING-001: superpermission bypass
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


def _level_permission_rows():
    """Seed-faithful level catalog (migration 028 + role permission seeds):
    levels are nested per domain, which is what makes the level-order and
    subset checks agree for level-based actors."""
    rows = []
    levels = {
        "platform": {
            "reader": ["inventory:read", "domain:pam"],
            "operator": ["inventory:read", "inventory:write", "catalogs:read", "domain:pam"],
            "admin": ["inventory:read", "inventory:write", "catalogs:read", "catalogs:write", "access:manage", "domain:pam", "domain:admin"],
        },
        "pam": {
            "reader": ["inventory:read", "domain:pam"],
            "operator": ["inventory:read", "inventory:write", "catalogs:read", "domain:pam"],
            "admin": ["inventory:read", "inventory:write", "inventory:export", "catalogs:read", "catalogs:write", "domain:pam"],
        },
        "dlp": {
            "reader": ["domain:dlp", "netskope:read"],
            "admin": ["domain:dlp", "netskope:read", "netskope:admin"],
        },
        "dspm": {
            "reader": ["domain:dspm", "bigid:read"],
            "admin": ["domain:dspm", "bigid:read", "bigid:admin"],
        },
    }
    orders = {"reader": 10, "operator": 20, "admin": 30}
    for domain_code, domain_levels in levels.items():
        for level_code, permission_codes in domain_levels.items():
            for permission_code in permission_codes:
                rows.append({
                    "domain_code": domain_code,
                    "level_code": level_code,
                    "sort_order": orders[level_code],
                    "permission_code": permission_code,
                })
    return rows


class DelegationCeilingHelperTests(unittest.TestCase):
    def test_rejects_a_permission_the_actor_does_not_hold(self):
        cursor = _FakeCursor([{"codes": ["inventory:read"]}])
        with self.assertRaisesRegex(DelegationCeilingError, "access:manage"):
            asyncio.run(assert_delegation_ceiling(cursor, "actor@example.com", ["inventory:read", "access:manage"]))

    def test_allows_a_subset_of_the_actor_permissions(self):
        cursor = _FakeCursor([{"codes": ["inventory:read", "inventory:write"]}])
        asyncio.run(assert_delegation_ceiling(cursor, "actor@example.com", ["inventory:read"]))

    def test_superpermission_bypasses_the_direct_ceiling_without_extra_queries(self):
        cursor = _FakeCursor([{"codes": ["access:manage"]}])
        asyncio.run(assert_delegation_ceiling(cursor, "admin@example.com", ["anything:goes"]))
        self.assertEqual(len(cursor.execute_calls), 1)

    def test_composite_rejects_a_level_above_the_actor(self):
        cursor = _FakeCursor(
            [{"codes": ["inventory:read", "inventory:write", "catalogs:read", "domain:pam"]}],
            fetchall_values=[_level_permission_rows()],
        )
        with self.assertRaisesRegex(DelegationCeilingError, "supera tu nivel de delegación"):
            asyncio.run(assert_composite_levels_within_ceiling(
                cursor, "operator@example.com", [{"domain_code": "platform", "level_code": "admin"}],
            ))

    def test_composite_allows_an_equal_or_lower_level(self):
        cursor = _FakeCursor(
            [{"codes": ["inventory:read", "inventory:write", "catalogs:read", "domain:pam"]}],
            fetchall_values=[_level_permission_rows()],
        )
        asyncio.run(assert_composite_levels_within_ceiling(cursor, "operator@example.com", [
            {"domain_code": "platform", "level_code": "operator"},
            {"domain_code": "platform", "level_code": "reader"},
            {"domain_code": "pam", "level_code": "reader"},
        ]))

    def test_composite_rejects_a_domain_where_the_actor_has_no_level(self):
        cursor = _FakeCursor(
            [{"codes": ["inventory:read", "domain:pam"]}],
            fetchall_values=[_level_permission_rows()],
        )
        with self.assertRaisesRegex(DelegationCeilingError, "dlp"):
            asyncio.run(assert_composite_levels_within_ceiling(
                cursor, "reader@example.com", [{"domain_code": "dlp", "level_code": "reader"}],
            ))

    def test_role_assignment_rejects_a_role_that_grants_more(self):
        cursor = _FakeCursor([{"codes": ["inventory:read"]}, {"codes": ["inventory:read", "access:manage"]}])
        with self.assertRaisesRegex(DelegationCeilingError, "access:manage"):
            asyncio.run(assert_role_assignment_ceiling(cursor, "actor@example.com", "admin"))

    def test_role_assignment_allows_a_subset_role(self):
        cursor = _FakeCursor([{"codes": ["inventory:read", "inventory:write"]}, {"codes": ["inventory:read"]}])
        asyncio.run(assert_role_assignment_ceiling(cursor, "actor@example.com", "reader"))

    def test_role_assignment_superpermission_skips_the_role_lookup(self):
        cursor = _FakeCursor([{"codes": ["access:manage"]}])
        asyncio.run(assert_role_assignment_ceiling(cursor, "admin@example.com", "admin"))
        self.assertEqual(len(cursor.execute_calls), 1)


class DelegationCeilingWiringTests(unittest.TestCase):
    def test_create_role_rejects_a_permission_the_actor_lacks(self):
        cursor = _FakeCursor(
            fetchone_values=[{"1": 1}, {"codes": ["inventory:read"]}],
            fetchall_values=[[{"permission_code": "access:manage"}]],
        )
        pool = _FakePool(_FakeConnection(cursor))

        with self.assertRaisesRegex(DelegationCeilingError, "access:manage"):
            asyncio.run(create_role(
                pool, role_code="delegated_admin", display_name="Delegated", description="d",
                domain_code="platform", permission_codes=["access:manage"], actor_id="delegated@example.com",
            ))

        inserts = [q for q, _ in cursor.execute_calls if "INSERT INTO public.access_roles" in q]
        self.assertEqual(inserts, [])
        # One shared advisory key for both invariants: no lock-order conflict.
        lock_calls = [(q, params) for q, params in cursor.execute_calls if "pg_advisory_xact_lock" in q]
        self.assertEqual(lock_calls, [("SELECT pg_advisory_xact_lock(hashtext(%s))", (ADMIN_INVARIANT_LOCK_KEY,))])

    def test_create_role_allows_a_permission_the_actor_holds(self):
        cursor = _FakeCursor(
            fetchone_values=[{"1": 1}, {"codes": ["inventory:read", "inventory:write"]}],
            fetchall_values=[[{"permission_code": "inventory:read"}]],
        )
        pool = _FakePool(_FakeConnection(cursor))

        with patch("app.cross.repositories.access_control.record_audit", new=AsyncMock()):
            role_code = asyncio.run(create_role(
                pool, role_code="delegated_reader", display_name="Delegated", description="d",
                domain_code="pam", permission_codes=["inventory:read"], actor_id="delegated@example.com",
            ))
        self.assertEqual(role_code, "delegated_reader")
        inserts = [q for q, _ in cursor.execute_calls if "INSERT INTO public.access_roles" in q]
        self.assertEqual(len(inserts), 1)

    def test_update_role_rejects_a_permission_the_actor_lacks(self):
        cursor = _FakeCursor(
            fetchone_values=[
                {"data": {}, "system_managed": False, "role_kind": "direct"},
                {"codes": []},
                {"1": 1},
                {"codes": ["inventory:read"]},
            ],
            fetchall_values=[[{"permission_code": "access:manage"}]],
        )
        pool = _FakePool(_FakeConnection(cursor))

        with self.assertRaisesRegex(DelegationCeilingError, "access:manage"):
            asyncio.run(update_role(
                pool, role_code="custom", display_name="Custom", description="d",
                domain_code="pam", permission_codes=["access:manage"], actor_id="delegated@example.com",
            ))
        updates = [q for q, _ in cursor.execute_calls if "UPDATE public.access_roles" in q]
        self.assertEqual(updates, [])

    def test_create_composite_role_rejects_a_level_above_the_actor(self):
        cursor = _FakeCursor(
            fetchone_values=[{"codes": ["inventory:read", "domain:pam"]}],
            fetchall_values=[_level_permission_rows()],
        )
        pool = _FakePool(_FakeConnection(cursor))

        with patch("app.cross.repositories.access_control._validate_level_selections", new=AsyncMock(return_value=({"pam"}, "active"))):
            with self.assertRaisesRegex(DelegationCeilingError, "supera tu nivel de delegación"):
                asyncio.run(create_composite_role(
                    pool, role_code="regional", display_name="Regional", description="d",
                    level_refs=[{"domain_code": "platform", "level_code": "admin"}], actor_id="reader@example.com",
                ))
        inserts = [q for q, _ in cursor.execute_calls if "INSERT INTO public.access_roles" in q]
        self.assertEqual(inserts, [])
        lock_calls = [q for q, _ in cursor.execute_calls if "pg_advisory_xact_lock" in q]
        self.assertEqual(len(lock_calls), 1)

    def test_update_composite_role_rejects_a_level_above_the_actor(self):
        cursor = _FakeCursor(
            fetchone_values=[
                {"data": {}, "role_kind": "composite", "system_managed": False},
                {"codes": ["inventory:read", "domain:pam"]},
            ],
            fetchall_values=[[], _level_permission_rows()],  # before_level_refs, then level catalog
        )
        pool = _FakePool(_FakeConnection(cursor))

        with patch("app.cross.repositories.access_control._validate_level_selections", new=AsyncMock(return_value=({"pam"}, "active"))):
            with self.assertRaisesRegex(DelegationCeilingError, "supera tu nivel de delegación"):
                asyncio.run(update_composite_role(
                    pool, role_code="custom_composite", display_name="Custom", description="d",
                    level_refs=[{"domain_code": "platform", "level_code": "admin"}], actor_id="reader@example.com",
                ))
        updates = [q for q, _ in cursor.execute_calls if "UPDATE public.access_roles" in q]
        self.assertEqual(updates, [])

    def test_create_user_rejects_an_over_ceiling_role(self):
        cursor = _FakeCursor([None, {"codes": ["inventory:read"]}, {"codes": ["access:manage"]}])
        pool = _FakePool(_FakeConnection(cursor))

        with patch("app.cross.repositories.user_admin.hash_password_async", new=AsyncMock(return_value="hash")):
            with self.assertRaisesRegex(DelegationCeilingError, "access:manage"):
                asyncio.run(create_user(pool, "new@example.com", "New", "admin", "delegated@example.com"))
        inserts = [q for q, _ in cursor.execute_calls if "INSERT INTO public.access_users" in q]
        self.assertEqual(inserts, [])
        lock_calls = [q for q, _ in cursor.execute_calls if "pg_advisory_xact_lock" in q]
        self.assertEqual(len(lock_calls), 1)

    def test_update_user_rejects_an_over_ceiling_role(self):
        cursor = _FakeCursor([
            {"data": {}},
            {"roles": ["reader"]},
            {"codes": ["inventory:read"]},
            {"codes": ["inventory:read", "access:manage"]},
        ])
        pool = _FakePool(_FakeConnection(cursor))

        with self.assertRaisesRegex(DelegationCeilingError, "access:manage"):
            asyncio.run(update_user(pool, "target@example.com", None, None, "admin", None, "delegated@example.com"))
        deletes = [q for q, _ in cursor.execute_calls if "DELETE FROM public.access_user_roles" in q]
        self.assertEqual(deletes, [])

    def test_update_user_allows_a_role_within_the_actor_ceiling(self):
        cursor = _FakeCursor([
            {"data": {}},
            {"roles": ["operator"]},
            {"codes": ["inventory:read", "inventory:write"]},
            {"codes": ["inventory:read"]},
            {"has_admin": True},
        ])
        pool = _FakePool(_FakeConnection(cursor))

        with patch("app.cross.repositories.user_admin.record_audit", new=AsyncMock()):
            result = asyncio.run(update_user(pool, "target@example.com", None, None, "reader", None, "delegated@example.com"))
        self.assertTrue(result)
        role_inserts = [q for q, _ in cursor.execute_calls if "INSERT INTO public.access_user_roles" in q]
        self.assertEqual(len(role_inserts), 1)


if __name__ == "__main__":
    unittest.main()
