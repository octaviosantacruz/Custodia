"""ACCESS-UI-001 phase 2 on real PostgreSQL: the Okta group -> role mapping is
edited in DS Hub. Until the first edit the login reads OIDC_ROLE_MAP_JSON; the
first edit adopts it whole, and from then on the table is the only source even
when empty. Ceiling and catalog checks roll back the whole edit.
Opt-in; see tests/support/pg_integration_base.py."""

import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import app.auth as auth
from app.cross.repositories.access_delegation import DelegationCeilingError
from app.cross.repositories.oidc_group_roles import UnknownMappedRoleError, set_group_roles
from app.cross.services.access_management import change_oidc_group_roles, role_catalog
from app.cross.services.oidc_groups import list_observed_oidc_groups
from app.cross.services.oidc_mapping import effective_role_pairs
from app.db import fetch_all, fetch_one
from tests.support.pg_integration_base import PostgresIntegrationTestCase


async def reset_mapping(pool):
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM access_oidc_group_roles")
        await conn.execute("DELETE FROM access_oidc_mapping_state")
        await conn.execute("DELETE FROM access_audit_log WHERE entity_type IN ('oidc_mapping', 'oidc_group')")


class OidcGroupRolesPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.subject = f"okta-{uuid4()}"
        self.admin = f"admin-{uuid4()}@example.test"
        self.delegate = f"delegate-{uuid4()}@example.test"
        self.delegate_role = f"itest_delegate_{uuid4().hex[:8]}"
        self.issuer = f"https://issuer.example/{uuid4()}"
        self.env = patch.dict(os.environ, {
            "OIDC_ISSUER_URL": self.issuer, "OIDC_GROUP_CLAIM": "groups",
            "OIDC_ROLE_MAP_JSON": json.dumps({"team-readers": "reader", "team-admins": "admin"}),
            "OIDC_DEFAULT_ROLE": "",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        await reset_mapping(self.pool)
        self.addAsyncCleanup(reset_mapping, self.pool)
        self.addAsyncCleanup(self.clean_rows)
        async with self.pool.connection() as conn:
            await conn.execute("INSERT INTO access_users (actor_id, email, display_name, password_hash) VALUES (%s, %s, 'Admin', 'x')", (self.admin, self.admin))
            await conn.execute("INSERT INTO access_user_roles (actor_id, role_code, granted_by) VALUES (%s, 'admin', 'itest')", (self.admin,))

    async def clean_rows(self):
        actors = [self.subject, self.admin, self.delegate]
        async with self.pool.connection() as conn:
            for table in ("access_user_roles", "access_oidc_users", "access_users"):
                await conn.execute(f"DELETE FROM {table} WHERE actor_id = ANY(%s)", (actors,))
            await conn.execute("DELETE FROM access_audit_log WHERE entity_id = ANY(%s) OR actor_id = ANY(%s)", (actors, actors))
            await conn.execute("DELETE FROM access_role_permissions WHERE role_code = %s", (self.delegate_role,))
            await conn.execute("DELETE FROM access_roles WHERE role_code = %s", (self.delegate_role,))

    async def login(self, groups):
        request = SimpleNamespace(session={}, app=SimpleNamespace(state=SimpleNamespace(db=self.pool)))
        provider = SimpleNamespace(authorize_access_token=AsyncMock(return_value={"userinfo": {
            "sub": self.subject, "email": "okta-person@example.test", "name": "Okta person", "groups": groups,
        }}))
        with patch.object(auth, "OIDC_ENABLED", True), patch.object(auth, "OIDC_CONFIGURED", True), \
             patch.object(auth, "OIDC_ISSUER_URL", self.issuer), patch.object(auth.oauth, "idp", provider, create=True), \
             patch.object(auth, "record_security_event_for_request", new=AsyncMock()):
            await auth.finish_oidc_login(request)
        rows = await fetch_all(self.pool, "SELECT role_code FROM access_user_roles WHERE actor_id = %s ORDER BY role_code", (self.subject,))
        return [row["role_code"] for row in rows]

    async def test_the_first_edit_adopts_the_environment_and_the_table_rules_from_then_on(self):
        self.assertEqual(await effective_role_pairs(self.pool), ([("team-admins", "admin"), ("team-readers", "reader")], "environment"))
        self.assertEqual(await self.login(["team-readers"]), ["reader"])

        self.assertEqual(await change_oidc_group_roles(self.pool, " team-sia ", ["sia_reader", "netskope_reader", "sia_reader"], self.admin), ["netskope_reader", "sia_reader"])
        pairs, source = await effective_role_pairs(self.pool)
        self.assertEqual(source, "database")
        self.assertEqual(pairs, [("team-admins", "admin"), ("team-readers", "reader"), ("team-sia", "netskope_reader"), ("team-sia", "sia_reader")])
        self.assertEqual(await self.login(["team-sia", "unmapped"]), ["netskope_reader", "sia_reader"])

        groups = await list_observed_oidc_groups(self.pool)
        self.assertEqual(groups["source"], "database")
        self.assertEqual({row["group"]: row["role_codes"] for row in groups["rows"]}["team-sia"], ["netskope_reader", "sia_reader"])
        catalog = {row["role_code"]: row["oidc_groups"] for row in await role_catalog(self.pool, include_oidc_groups=True)}
        self.assertEqual(catalog["sia_reader"], ["team-sia"])

        for group in ("team-admins", "team-readers", "team-sia"):
            await change_oidc_group_roles(self.pool, group, [], self.admin)
        self.assertEqual(await effective_role_pairs(self.pool), ([], "database"))
        # An emptied table does not fall back to OIDC_ROLE_MAP_JSON.
        self.assertEqual(await self.login(["team-readers"]), [])

        audit = await fetch_all(self.pool, "SELECT action, entity_id, after_data FROM access_audit_log WHERE entity_type IN ('oidc_mapping', 'oidc_group') ORDER BY audit_id")
        self.assertEqual(audit[0]["action"], "oidc_mapping_adopted")
        self.assertEqual(len(audit[0]["after_data"]["pairs"]), 2)
        self.assertEqual([(row["action"], row["entity_id"]) for row in audit[1:]], [
            ("oidc_group_roles_update", "team-sia"), ("oidc_group_roles_update", "team-admins"),
            ("oidc_group_roles_update", "team-readers"), ("oidc_group_roles_update", "team-sia"),
        ])

    async def test_an_invalid_or_over_ceiling_edit_rolls_back_the_adoption_too(self):
        with self.assertRaises(UnknownMappedRoleError):
            await change_oidc_group_roles(self.pool, "team-x", ["no_such_role"], self.admin)
        self.assertIsNone(await fetch_one(self.pool, "SELECT 1 AS present FROM access_oidc_mapping_state"))

        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO access_roles (role_code, display_name, description, domain_code, lifecycle_status, system_managed, role_kind) VALUES (%s, 'Delegado', 'itest', 'platform', 'active', false, 'direct')",
                (self.delegate_role,),
            )
            await conn.execute(
                "INSERT INTO access_role_permissions (role_code, permission_code) SELECT %s, permission_code FROM access_role_permissions WHERE role_code = 'reader' UNION SELECT %s, 'access:role_assignments_manage'",
                (self.delegate_role, self.delegate_role),
            )
            await conn.execute("INSERT INTO access_users (actor_id, email, display_name, password_hash) VALUES (%s, %s, 'Delegado', 'x')", (self.delegate, self.delegate))
            await conn.execute("INSERT INTO access_user_roles (actor_id, role_code, granted_by) VALUES (%s, %s, 'itest')", (self.delegate, self.delegate_role))
        with self.assertRaises(DelegationCeilingError):
            await set_group_roles(self.pool, "team-new", ["admin"], self.delegate, [])
        self.assertIsNone(await fetch_one(self.pool, "SELECT 1 AS present FROM access_oidc_mapping_state"))
        # Removing a role the delegate could not grant is refused as well.
        with self.assertRaises(DelegationCeilingError):
            await change_oidc_group_roles(self.pool, "team-admins", [], self.delegate)
        self.assertEqual(await change_oidc_group_roles(self.pool, "team-readers", ["reader"], self.delegate), ["reader"])
        self.assertEqual((await effective_role_pairs(self.pool))[1], "database")
