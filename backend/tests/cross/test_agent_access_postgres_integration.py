"""AUTH-AGENT-001 on real PostgreSQL: the automation account opens with a credential
that signs in without a first-login change, closes behind another one, every
change ends its sessions and is audited without the secret, and closing never
leaves Custodia without an administrator. Opt-in; see tests/support/pg_integration_base.py."""

import json
import os
from unittest.mock import patch
from uuid import uuid4

from app.cross.services.local_authentication import authenticate_local_user
from app.cross.services.password_hashing import hash_password_async
from app.cross.services.user_management import close_automation_access, open_automation_access
from app.db import fetch_all, fetch_one
from tests.support.pg_integration_base import PostgresIntegrationTestCase

OLD_PASSWORD = "an-old-agent-password-value"
ACTOR = "system:agent-access:test"


class AgentAccessPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.account = f"agent-{uuid4()}@example.test"
        self.admin = f"admin-{uuid4()}@example.test"
        self.okta_admin = f"okta-{uuid4()}"
        self.issuer = f"https://issuer.example/{uuid4()}"
        self.addAsyncCleanup(self.clean_rows)
        old_hash = await hash_password_async(OLD_PASSWORD)
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO access_users (actor_id, email, display_name, password_hash, must_change_password, is_active) VALUES (%s, %s, 'Agent', %s, true, false)",
                (self.account, self.account, old_hash),
            )
            await conn.execute("INSERT INTO access_user_roles (actor_id, role_code, granted_by) VALUES (%s, 'admin', 'itest')", (self.account,))

    async def clean_rows(self):
        actors = [self.account, self.admin, self.okta_admin]
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM access_audit_log WHERE entity_id = ANY(%s)", (actors,))
            await conn.execute("DELETE FROM access_user_roles WHERE actor_id = ANY(%s)", (actors,))
            await conn.execute("DELETE FROM access_users WHERE actor_id = ANY(%s)", (actors,))
            await conn.execute("DELETE FROM access_oidc_users WHERE actor_id = ANY(%s)", (actors,))

    async def add_other_admin(self):
        async with self.pool.connection() as conn:
            await conn.execute("INSERT INTO access_users (actor_id, email, display_name, password_hash) VALUES (%s, %s, 'Admin', 'x')", (self.admin, self.admin))
            await conn.execute("INSERT INTO access_user_roles (actor_id, role_code, granted_by) VALUES (%s, 'admin', 'itest')", (self.admin,))

    async def add_okta_admin(self):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO access_oidc_users (actor_id, issuer, subject, email, display_name) VALUES (%s, %s, %s, 'okta-admin@example.test', 'Okta Admin')",
                (self.okta_admin, self.issuer, self.okta_admin),
            )
            await conn.execute("INSERT INTO access_user_roles (actor_id, role_code, granted_by, assignment_source) VALUES (%s, 'admin', 'oidc', 'oidc')", (self.okta_admin,))

    async def state(self):
        return await fetch_one(self.pool, "SELECT is_active, must_change_password, session_version FROM access_users WHERE actor_id = %s", (self.account,))

    async def test_open_and_close_replace_the_credential_end_sessions_and_audit_without_the_secret(self):
        await self.add_other_admin()
        before = await self.state()
        password = await open_automation_access(self.pool, self.account.upper(), ACTOR)

        self.assertGreaterEqual(len(password), 40)
        opened = await self.state()
        self.assertEqual((opened["is_active"], opened["must_change_password"]), (True, False))
        self.assertEqual(opened["session_version"], before["session_version"] + 1)
        self.assertIsNotNone(await authenticate_local_user(self.pool, self.account, password))
        self.assertIsNone(await authenticate_local_user(self.pool, self.account, OLD_PASSWORD))

        self.assertTrue(await close_automation_access(self.pool, self.account, ACTOR))
        closed = await self.state()
        self.assertFalse(closed["is_active"])
        self.assertEqual(closed["session_version"], opened["session_version"] + 1)
        self.assertIsNone(await authenticate_local_user(self.pool, self.account, password))

        audit = await fetch_all(self.pool, "SELECT actor_id, action, before_data, after_data FROM access_audit_log WHERE entity_id = %s ORDER BY audit_id", (self.account,))
        self.assertEqual([(row["actor_id"], row["action"]) for row in audit], [(ACTOR, "automation_access_opened"), (ACTOR, "automation_access_closed")])
        self.assertEqual([row["after_data"] for row in audit], [{"is_active": True}, {"is_active": False}])
        self.assertNotIn(password, json.dumps([row["before_data"] for row in audit] + [row["after_data"] for row in audit]))

    async def test_closing_the_last_administrator_is_rejected_and_changes_nothing(self):
        password = await open_automation_access(self.pool, self.account, ACTOR)
        opened = await self.state()
        with patch.dict(os.environ, {"AUTH_MODE": "local"}), self.assertRaisesRegex(ValueError, "administrador"):
            await close_automation_access(self.pool, self.account, ACTOR)
        self.assertEqual(await self.state(), opened)
        self.assertIsNotNone(await authenticate_local_user(self.pool, self.account, password))

    async def test_a_missing_account_is_never_created(self):
        missing = f"missing-{uuid4()}@example.test"
        self.assertIsNone(await open_automation_access(self.pool, missing, ACTOR))
        self.assertFalse(await close_automation_access(self.pool, missing, ACTOR))
        self.assertIsNone(await fetch_one(self.pool, "SELECT 1 FROM access_users WHERE actor_id = %s", (missing,)))

    async def test_an_okta_administrator_of_the_configured_issuer_lets_the_account_close(self):
        await self.add_okta_admin()
        await open_automation_access(self.pool, self.account, ACTOR)
        for environment in (
            {"AUTH_MODE": "local", "OIDC_ISSUER_URL": self.issuer},
            {"AUTH_MODE": "hybrid", "OIDC_ISSUER_URL": "https://other-issuer.example"},
            {"AUTH_MODE": "hybrid", "OIDC_ISSUER_URL": ""},
        ):
            with self.subTest(environment=environment), patch.dict(os.environ, environment):
                with self.assertRaisesRegex(ValueError, "administrador"):
                    await close_automation_access(self.pool, self.account, ACTOR)
                self.assertTrue((await self.state())["is_active"])
        for mode in ("hybrid", "oidc"):
            with self.subTest(mode=mode), patch.dict(os.environ, {"AUTH_MODE": mode, "OIDC_ISSUER_URL": self.issuer}):
                await open_automation_access(self.pool, self.account, ACTOR)
                self.assertTrue(await close_automation_access(self.pool, self.account, ACTOR))
                self.assertFalse((await self.state())["is_active"])
