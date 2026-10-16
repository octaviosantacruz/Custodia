"""COV-001: the migration grants each new permission to every role holding its old equivalent, custom roles included."""

import re
from pathlib import Path
from uuid import uuid4

from app.db import fetch_all
from tests.support.pg_integration_base import PostgresIntegrationTestCase

MIGRATION = Path(__file__).resolve().parents[3] / "migrations" / "101_safes_and_coverage_permissions.sql"
EQUIVALENTS = {
    "safes:read": {"inventory:read"},
    "coverage:read": {"inventory:read"},
    "safes:manage": {"safes:classify", "safes:bulk_classify"},
    "coverage:manage": {"connections:import"},
}


class SafesCoveragePermissionsPostgresTests(PostgresIntegrationTestCase):
    async def permissions_by_role(self):
        rows = await fetch_all(self.pool, "SELECT role_code, permission_code FROM public.access_role_permissions")
        held: dict[str, set[str]] = {}
        for row in rows:
            held.setdefault(row["role_code"], set()).add(row["permission_code"])
        return held

    async def test_the_new_permissions_are_in_the_catalog_as_active_pam_permissions(self):
        rows = await fetch_all(self.pool, "SELECT permission_code, domain_code, lifecycle_status FROM public.access_permissions WHERE permission_code = ANY(%s)", (list(EQUIVALENTS),))
        self.assertEqual({row["permission_code"]: (row["domain_code"], row["lifecycle_status"]) for row in rows},
                         {code: ("pam", "active") for code in EQUIVALENTS})

    async def test_every_system_role_holding_an_old_code_holds_the_new_one(self):
        held = await self.permissions_by_role()
        for role, codes in held.items():
            for new_code, old_codes in EQUIVALENTS.items():
                if codes & old_codes:
                    self.assertIn(new_code, codes, f"{role} lost the access that {sorted(old_codes)} gave")

    async def test_the_new_codes_do_not_widen_access_beyond_their_equivalents(self):
        held = await self.permissions_by_role()
        for role, codes in held.items():
            if role == "admin":
                continue  # the platform administrator holds every active permission
            for new_code, old_codes in EQUIVALENTS.items():
                if new_code in codes:
                    self.assertTrue(codes & old_codes, f"{role} gained {new_code} without holding {sorted(old_codes)}")
        self.assertTrue(set(EQUIVALENTS) <= held["admin"])

    async def test_running_the_grant_again_covers_a_custom_role_and_changes_nothing_else(self):
        statement = re.search(r"INSERT INTO public\.access_role_permissions \(role_code, permission_code\)\nSELECT DISTINCT.*?;", MIGRATION.read_text(), re.S).group(0)
        role = f"cov_custom_{uuid4().hex[:10]}"
        async with self.pool.connection() as conn:
            self.addAsyncCleanup(self.cleanup_role, role)
            await conn.execute("INSERT INTO public.access_roles (role_code, description, display_name) VALUES (%s, 'cov test', 'Cov test')", (role,))
            await conn.execute(
                "INSERT INTO public.access_role_permissions (role_code, permission_code) VALUES (%s, 'safes:classify'), (%s, 'inventory:read')",
                (role, role),
            )
            before = await self.permissions_by_role()
            await conn.execute(statement)
            await conn.commit()
        after = await self.permissions_by_role()
        self.assertEqual(after[role], {"safes:classify", "inventory:read", "safes:manage", "safes:read", "coverage:read"})
        for other in before.keys() - {role}:
            self.assertEqual(after[other], before[other], f"{other} changed on a second run")

    async def cleanup_role(self, role):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.access_role_permissions WHERE role_code = %s", (role,))
            await conn.execute("DELETE FROM public.access_roles WHERE role_code = %s", (role,))
            await conn.commit()
