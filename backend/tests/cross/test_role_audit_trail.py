"""IF-004: role-change audit entries must capture the *previous*
permission set / level selection in before_data, not just the new one in
after_data. to_jsonb(access_roles) alone never contains
access_role_permissions or access_custom_role_levels rows, so before_data
used to be asymmetric with after_data and the audit log couldn't show
what permission/level was actually removed by an edit."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.cross.repositories.access_control import update_composite_role, update_role
from tests.support.fake_pg import FakeConnection as _FakeConnection, FakeCursor as _FakeCursor, FakePool as _FakePool


class UpdateRoleAuditTrailTests(unittest.TestCase):
    def test_before_data_includes_the_permission_codes_the_role_actually_had(self):
        cursor = _FakeCursor(
            fetchone_values=[
                {"data": {"role_code": "custom_reader", "display_name": "Old"}, "system_managed": False, "role_kind": "direct"},
                {"codes": ["inventory:read", "safes:classify"]},  # before_permission_codes
                {"1": 1},  # domain exists
                {"codes": ["access:manage"]},  # ACCESS-CEILING-001: superpermission bypass
                {"has_admin": True},
            ],
            fetchall_values=[[{"permission_code": "inventory:read"}]],
        )
        pool = _FakePool(_FakeConnection(cursor))

        with patch("app.cross.repositories.access_control.record_audit", new=AsyncMock()) as record_audit:
            asyncio.run(update_role(
                pool, role_code="custom_reader", display_name="New", description="d",
                domain_code="pam", permission_codes=["inventory:read"], actor_id="admin@example.com",
            ))

        before_data = record_audit.await_args.kwargs["before_data"]
        after_data = record_audit.await_args.kwargs["after_data"]
        self.assertEqual(before_data["permission_codes"], ["inventory:read", "safes:classify"])
        self.assertEqual(after_data["permission_codes"], ["inventory:read"])
        # The removed permission is visible by diffing before/after -- the
        # entire point of this fix.
        self.assertIn("safes:classify", set(before_data["permission_codes"]) - set(after_data["permission_codes"]))

    def test_before_data_permission_codes_is_an_empty_list_for_a_role_with_none_yet(self):
        cursor = _FakeCursor(
            fetchone_values=[
                {"data": {}, "system_managed": False, "role_kind": "direct"},
                {"codes": None},  # array_agg over zero rows -> NULL
                {"1": 1},
                {"codes": ["access:manage"]},  # ACCESS-CEILING-001: superpermission bypass
                {"has_admin": True},
            ],
            fetchall_values=[[{"permission_code": "inventory:read"}]],
        )
        pool = _FakePool(_FakeConnection(cursor))

        with patch("app.cross.repositories.access_control.record_audit", new=AsyncMock()) as record_audit:
            asyncio.run(update_role(
                pool, role_code="brand_new", display_name="New", description="d",
                domain_code="pam", permission_codes=["inventory:read"], actor_id="admin@example.com",
            ))

        self.assertEqual(record_audit.await_args.kwargs["before_data"]["permission_codes"], [])


class UpdateCompositeRoleAuditTrailTests(unittest.TestCase):
    def test_before_data_includes_the_level_refs_the_role_actually_had(self):
        with patch("app.cross.repositories.access_control._validate_level_selections", new=AsyncMock(return_value=({"pam"}, "active"))), \
             patch("app.cross.repositories.access_control._find_duplicate_combination", new=AsyncMock(return_value=None)):
            cursor = _FakeCursor(
                fetchone_values=[
                    {"data": {}, "role_kind": "composite", "system_managed": False},
                    {"codes": ["access:manage"]},  # ACCESS-CEILING-001: superpermission bypass
                    {"has_admin": True},
                ],
                fetchall_values=[[{"domain_code": "pam", "level_code": "admin"}]],  # before_level_refs
            )
            pool = _FakePool(_FakeConnection(cursor))

            with patch("app.cross.repositories.access_control.record_audit", new=AsyncMock()) as record_audit:
                asyncio.run(update_composite_role(
                    pool, role_code="custom_composite", display_name="Custom", description="d",
                    level_refs=[{"domain_code": "pam", "level_code": "reader"}], actor_id="admin@example.com",
                ))

        before_data = record_audit.await_args.kwargs["before_data"]
        after_data = record_audit.await_args.kwargs["after_data"]
        self.assertEqual(before_data["level_refs"], [{"domain_code": "pam", "level_code": "admin"}])
        self.assertEqual(after_data["level_refs"], [{"domain_code": "pam", "level_code": "reader"}])


if __name__ == "__main__":
    unittest.main()
