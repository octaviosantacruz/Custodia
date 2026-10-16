"""ACCESS-UI-001 on real PostgreSQL: DS Hub roles coexist with the roles an OIDC
login maps from groups. A login replaces only its own rows, an OIDC role is
never removed from DS Hub, the delegation ceiling applies, and every change is
audited. Opt-in; see tests/support/pg_integration_base.py."""

import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import app.auth as auth
from app.cross.repositories.access_delegation import DelegationCeilingError
from app.cross.repositories.user_admin import OidcManagedRoleError, grant_user_role, list_people, list_users, revoke_user_role
from app.db import fetch_all
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class UserRoleAssignmentsPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.subject = f"okta-{uuid4()}"
        self.delegate = f"delegate-{uuid4()}@example.test"
        self.admin = f"admin-{uuid4()}@example.test"
        self.delegate_role = f"itest_delegate_{uuid4().hex[:8]}"
        self.issuer = f"https://issuer.example/{uuid4()}"
        self.env = patch.dict(os.environ, {
            "OIDC_ISSUER_URL": self.issuer, "OIDC_GROUP_CLAIM": "groups",
            "OIDC_ROLE_MAP_JSON": json.dumps({"team-readers": "reader", "team-netskope": "netskope_reader"}),
            "OIDC_DEFAULT_ROLE": "",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addAsyncCleanup(self.clean_rows)
        async with self.pool.connection() as conn:
            await conn.execute("INSERT INTO access_users (actor_id, email, display_name, password_hash) VALUES (%s, %s, 'Admin', 'x')", (self.admin, self.admin))
            await conn.execute("INSERT INTO access_user_roles (actor_id, role_code, granted_by) VALUES (%s, 'admin', 'itest')", (self.admin,))

    async def clean_rows(self):
        actors = [self.subject, self.delegate, self.admin]
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

    async def assignments(self):
        rows = await fetch_all(self.pool, "SELECT role_code, assignment_source FROM access_user_roles WHERE actor_id = %s ORDER BY role_code", (self.subject,))
        return [(row["role_code"], row["assignment_source"]) for row in rows]

    async def test_a_manual_role_survives_every_login_and_logins_replace_only_their_own(self):
        await self.login(["team-readers"])
        self.assertEqual(await self.assignments(), [("reader", "oidc")])

        self.assertTrue(await grant_user_role(self.pool, self.subject, "sia_reader", self.admin))
        self.assertFalse(await grant_user_role(self.pool, self.subject, "sia_reader", self.admin))
        self.assertIsNone(await grant_user_role(self.pool, "nobody-" + self.subject, "sia_reader", self.admin))

        await self.login(["team-netskope"])
        self.assertEqual(await self.assignments(), [("netskope_reader", "oidc"), ("sia_reader", "manual")])

        # The groups now also grant the manual role: the human decision stays manual.
        with patch.dict(os.environ, {"OIDC_ROLE_MAP_JSON": json.dumps({"team-sia": "sia_reader"})}):
            await self.login(["team-sia"])
        self.assertEqual(await self.assignments(), [("sia_reader", "manual")])

        listed = await list_users(self.pool, "okta-person@example.test")
        self.assertEqual(listed["rows"][0]["role_assignments"], [{"role_code": "sia_reader", "source": "manual"}])
        people = await list_people(self.pool, "okta-person@example.test")
        self.assertEqual(people["rows"][0]["identities"][0]["role_assignments"], [{"role_code": "sia_reader", "source": "manual"}])

    async def test_an_oidc_role_is_changed_only_in_the_provider_and_every_change_is_audited(self):
        await self.login(["team-readers"])
        with self.assertRaises(OidcManagedRoleError):
            await revoke_user_role(self.pool, self.subject, "reader", self.admin)
        self.assertFalse(await revoke_user_role(self.pool, self.subject, "sia_reader", self.admin))

        await grant_user_role(self.pool, self.subject, "sia_reader", self.admin)
        self.assertTrue(await revoke_user_role(self.pool, self.subject, "sia_reader", self.admin))
        self.assertEqual(await self.assignments(), [("reader", "oidc")])

        audit = await fetch_all(
            self.pool,
            "SELECT action, before_data, after_data FROM access_audit_log WHERE entity_id = %s AND action IN ('role_grant', 'role_revoke') ORDER BY audit_id",
            (self.subject,),
        )
        self.assertEqual([row["action"] for row in audit], ["role_grant", "role_revoke"])
        self.assertEqual(audit[0]["after_data"]["roles"], [{"role_code": "reader", "source": "oidc"}, {"role_code": "sia_reader", "source": "manual"}])
        self.assertEqual(audit[1]["after_data"]["roles"], [{"role_code": "reader", "source": "oidc"}])

    async def test_a_delegated_actor_cannot_grant_or_revoke_beyond_its_ceiling(self):
        await self.login(["team-readers"])
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO access_roles (role_code, display_name, description, domain_code, lifecycle_status, system_managed, role_kind) VALUES (%s, 'Delegado', 'itest', 'platform', 'active', false, 'direct')",
                (self.delegate_role,),
            )
            await conn.execute(
                "INSERT INTO access_role_permissions (role_code, permission_code) SELECT %s, permission_code FROM access_role_permissions WHERE role_code = 'sia_reader' UNION SELECT %s, 'access:role_assignments_manage'",
                (self.delegate_role, self.delegate_role),
            )
            await conn.execute(
                "INSERT INTO access_users (actor_id, email, display_name, password_hash) VALUES (%s, %s, 'Delegado', 'x')",
                (self.delegate, self.delegate),
            )
            await conn.execute("INSERT INTO access_user_roles (actor_id, role_code, granted_by) VALUES (%s, %s, 'itest')", (self.delegate, self.delegate_role))

        with self.assertRaises(DelegationCeilingError):
            await grant_user_role(self.pool, self.subject, "admin", self.delegate)
        self.assertTrue(await grant_user_role(self.pool, self.subject, "sia_reader", self.delegate))
        await grant_user_role(self.pool, self.subject, "netskope_reader", self.admin)
        with self.assertRaises(DelegationCeilingError):
            await revoke_user_role(self.pool, self.subject, "netskope_reader", self.delegate)
        self.assertTrue(await revoke_user_role(self.pool, self.subject, "sia_reader", self.delegate))
