"""Optional domains must never grant a default Platform/PAM level.

Exercises persisted selections, live permission inheritance and audit rollback
on PostgreSQL. Existing admin-invariant tests own last-admin protection.
"""

from uuid import uuid4

from app.cross.repositories.access_control import create_composite_role, create_role, list_roles, update_composite_role, update_role
from app.cross.repositories.access_delegation import DelegationCeilingError
from app.db import fetch_all, fetch_one
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class CompositeRolesPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        suffix = uuid4().hex[:12]
        self.admin = f"composite-admin-{suffix}@example.test"
        self.delegate = f"composite-delegate-{suffix}@example.test"
        self.role = f"composite_{suffix}"
        self.base = f"base_{suffix}"
        self.level = f"level_{suffix}"
        self.addAsyncCleanup(self.clean_rows)
        async with self.pool.connection() as conn, conn.cursor() as cursor:
            await cursor.executemany(
                "INSERT INTO access_users (actor_id, email, display_name, password_hash) VALUES (%s, %s, 'Composite test', 'x')",
                [(actor, actor) for actor in (self.admin, self.delegate)],
            )
            await cursor.executemany(
                "INSERT INTO access_user_roles (actor_id, role_code, granted_by) VALUES (%s, %s, 'itest')",
                [(self.admin, 'admin'), (self.delegate, 'netskope_reader')],
            )

    async def clean_rows(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM access_user_roles WHERE actor_id = ANY(%s)", ([self.admin, self.delegate],))
            await conn.execute("DELETE FROM access_users WHERE actor_id = ANY(%s)", ([self.admin, self.delegate],))
            await conn.execute("DELETE FROM access_custom_role_levels WHERE custom_role_code = %s", (self.role,))
            await conn.execute("DELETE FROM access_domain_levels WHERE domain_code = 'dlp' AND level_code = %s", (self.level,))
            await conn.execute("DELETE FROM access_role_permissions WHERE role_code = ANY(%s)", ([self.role, self.base],))
            await conn.execute("DELETE FROM access_roles WHERE role_code = ANY(%s)", ([self.role, self.base],))
            await conn.execute("DELETE FROM access_audit_log WHERE actor_id = ANY(%s)", ([self.admin, self.delegate],))

    async def create(self, refs, actor=None):
        return await create_composite_role(
            self.pool, role_code=self.role, display_name="Equipo Netskope", description="Scope test",
            level_refs=refs, actor_id=actor or self.admin,
        )

    async def change(self, refs, actor=None):
        return await update_composite_role(
            self.pool, role_code=self.role, display_name="Equipo Netskope", description="Scope test",
            level_refs=refs, actor_id=actor or self.admin,
        )

    async def test_netskope_only_stays_active_and_adding_then_omitting_identity_changes_only_its_permissions(self):
        netskope = {"domain_code": "dlp", "level_code": "reader"}
        identity = {"domain_code": "identity", "level_code": "reader"}
        await self.create([netskope])
        row = next(role for role in await list_roles(self.pool) if role['role_code'] == self.role)
        self.assertEqual(row['lifecycle_status'], 'active')
        self.assertEqual([(ref['domain_code'], ref['level_code']) for ref in row['level_refs']], [('dlp', 'reader')])
        self.assertEqual(set(row['permission_codes']), {'domain:dlp', 'netskope:read'})
        await self.change([netskope, identity])
        expanded = await fetch_all(self.pool, "SELECT permission_code FROM access_effective_role_permissions WHERE role_code = %s", (self.role,))
        self.assertIn('identity:catalogs_read', {row['permission_code'] for row in expanded})
        await self.change([netskope])
        trimmed = await fetch_all(self.pool, "SELECT permission_code FROM access_effective_role_permissions WHERE role_code = %s", (self.role,))
        self.assertEqual({row['permission_code'] for row in trimmed}, {'domain:dlp', 'netskope:read'})
        audit = await fetch_all(self.pool, "SELECT before_data, after_data FROM access_audit_log WHERE entity_id = %s AND action = 'update' ORDER BY audit_id", (self.role,))
        self.assertEqual(audit[-1]['before_data']['level_refs'], [netskope, identity])
        self.assertEqual(audit[-1]['after_data']['level_refs'], [netskope])

        await self.change([netskope, {"domain_code": "dspm", "level_code": "reader"}])
        planned = next(role for role in await list_roles(self.pool) if role['role_code'] == self.role)
        self.assertEqual(planned['lifecycle_status'], 'planned')
        await self.change([netskope])
        active = next(role for role in await list_roles(self.pool) if role['role_code'] == self.role)
        self.assertEqual(active['lifecycle_status'], 'active')
        self.assertEqual(set(active['permission_codes']), {'domain:dlp', 'netskope:read'})

    async def test_sparse_composition_inherits_live_base_changes(self):
        await create_role(self.pool, role_code=self.base, display_name='Base', description='Base test', domain_code='dlp', permission_codes=['netskope:read'], actor_id=self.admin)
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO access_domain_levels (domain_code, level_code, display_name, base_role_code, sort_order) VALUES ('dlp', %s, 'Test level', %s, 100)",
                (self.level, self.base),
            )
        await self.create([{'domain_code': 'dlp', 'level_code': self.level}])
        await update_role(self.pool, role_code=self.base, display_name='Base', description='Base test', domain_code='dlp', permission_codes=['netskope:read', 'audit:read'], actor_id=self.admin)
        inherited = await fetch_all(self.pool, "SELECT permission_code FROM access_effective_role_permissions WHERE role_code = %s", (self.role,))
        self.assertEqual({row['permission_code'] for row in inherited}, {'netskope:read', 'audit:read'})

    async def test_invalid_selections_and_over_ceiling_changes_leave_no_partial_role_or_audit(self):
        for refs in ([], [{'domain_code': 'missing', 'level_code': 'reader'}], [{'domain_code': 'dlp', 'level_code': 'missing'}], [{'domain_code': 'dlp', 'level_code': 'reader'}] * 2):
            with self.subTest(refs=refs), self.assertRaises(ValueError):
                await self.create(refs)
            self.assertIsNone(await fetch_one(self.pool, "SELECT 1 FROM access_roles WHERE role_code = %s", (self.role,)))
        await self.create([{'domain_code': 'dlp', 'level_code': 'reader'}], self.delegate)
        with self.assertRaises(DelegationCeilingError):
            await self.change([{'domain_code': 'dlp', 'level_code': 'admin'}], self.delegate)
        row = next(role for role in await list_roles(self.pool) if role['role_code'] == self.role)
        self.assertEqual(set(row['permission_codes']), {'domain:dlp', 'netskope:read'})
        audit = await fetch_all(self.pool, "SELECT action FROM access_audit_log WHERE entity_id = %s", (self.role,))
        self.assertEqual([row['action'] for row in audit], ['create'])
