"""Integration coverage for the first-admin flows against real PostgreSQL.

Registration (`/api/auth/register`), token bootstrap (`/api/auth/bootstrap`),
`/api/auth/setup-status`, local login and `/api/auth/status` used to be tested
only with mocked repositories. This runs them through the real ASGI app, the
real rate limiter, hashing, advisory lock and security-event log, so the
`auth.py` / `account_security` boundary can be refactored safely.

Opt-in (CUSTODIA_TEST_DATABASE_URL, a disposable database). The first-admin flows
only exist while ``access_users`` is empty, so the module skips when other
users are present and removes everything it creates.
"""

import asyncio
import os
import unittest
import uuid
from unittest.mock import patch

os.environ.update({
    "DATABASE_URL": "postgresql://test:test@127.0.0.1:5432/cmdb",
    "SESSION_SECRET": "test-only-session-secret-at-least-32-bytes",
    "INGESTION_INTERVAL_MINUTES": "1440",
    "AUTH_MODE": "local",
    "SESSION_HTTPS_ONLY": "false",
})

import httpx  # noqa: E402

from app.main import app  # noqa: E402
from app.cross.repositories.security_events import _safe_actor_id  # noqa: E402
from app.cross.services.audit_trail import (  # noqa: E402
    EVENT_BOOTSTRAP_ADMIN_CREATED,
    EVENT_SELF_REGISTER_CREATED,
    EVENT_TECHNICAL_TOKEN_REJECTED,
)
from app.cross.services.rate_limit_enforcement import BOOTSTRAP_RATE_LIMIT_MAX_ATTEMPTS  # noqa: E402
from tests.support.pg_integration_base import PostgresIntegrationTestCase  # noqa: E402

PASSWORD = "Abcdef1!ghijk-Long-Enough"
BOOTSTRAP_TOKEN = "integration-bootstrap-token-0123456789"


class FirstAdminPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.pool.connection() as conn:
            row = await (await conn.execute("SELECT count(*) AS count FROM public.access_users")).fetchone()
            # Bucket keys are hashed, so rate-limit rows are cleaned by creation time.
            self.started_at = (await (await conn.execute("SELECT clock_timestamp() AS now")).fetchone())["now"]
        if row["count"]:
            self.skipTest("access_users no está vacía: los flujos de primer administrador requieren tabla vacía")
        self.email = f"itest-{uuid.uuid4().hex[:8]}@example.test"
        self.addAsyncCleanup(self._cleanup)
        for target, value in (
            ("app.cross.api.routes.auth_bootstrap.LOCAL_AUTH_ENABLED", True),
            ("app.cross.api.routes.auth_bootstrap.SELF_REGISTER_SETUP_ENABLED", True),
            ("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True),
            ("app.cross.api.routes.auth_session.SELF_REGISTER_SETUP_ENABLED", True),
        ):
            patcher = patch(target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(app.state, "db", self.pool, create=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        env = patch.dict(os.environ, {"AUTH_BOOTSTRAP_TOKEN": BOOTSTRAP_TOKEN})
        env.start()
        self.addCleanup(env.stop)
        # https base URL so the session cookie is sent whatever SESSION_HTTPS_ONLY resolved to.
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://testserver")
        self.addAsyncCleanup(self.client.aclose)

    async def _cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.access_user_roles WHERE actor_id LIKE 'itest-%'")
            await conn.execute("DELETE FROM public.access_users WHERE actor_id LIKE 'itest-%'")
            await conn.execute("DELETE FROM public.access_security_events WHERE occurred_at >= %s", (self.started_at,))
            await conn.execute("DELETE FROM public.rate_limit_attempts WHERE window_started_at >= %s", (self.started_at,))
            await conn.commit()

    async def _users(self):
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT u.actor_id, u.password_hash, u.is_active, r.role_code, r.granted_by "
                "FROM public.access_users u LEFT JOIN public.access_user_roles r USING (actor_id) WHERE u.actor_id LIKE 'itest-%'"
            )
            return await cursor.fetchall()

    async def _events(self, event_type):
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT actor_id, result, mechanism FROM public.access_security_events "
                "WHERE event_type = %s AND occurred_at >= %s ORDER BY event_id",
                (event_type, self.started_at),
            )
            return await cursor.fetchall()

    async def _assert_no_plain_email_in_security_events(self):
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT count(*) AS count FROM public.access_security_events "
                "WHERE occurred_at >= %s AND (actor_id LIKE '%%@%%' OR metadata::text LIKE '%%@%%')",
                (self.started_at,),
            )
            self.assertEqual((await cursor.fetchone())["count"], 0)

    def _payload(self, **extra):
        return {"email": self.email, "password": PASSWORD, "display_name": "Integration Admin", **extra}

    async def test_register_creates_the_only_admin_and_closes_the_window(self):
        before = await self.client.get("/api/auth/setup-status")
        self.assertEqual(before.json(), {"available": True})

        response = await self.client.post("/api/auth/register", json=self._payload())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"created": True, "authenticated": False, "actor_id": self.email})
        self.assertNotIn("set-cookie", {key.lower() for key in response.headers})

        rows = await self._users()
        self.assertEqual([(r["actor_id"], r["role_code"], r["granted_by"]) for r in rows], [(self.email, "admin", "self-registration")])
        self.assertTrue(rows[0]["password_hash"].startswith("$argon2id$"))
        self.assertNotIn(PASSWORD, rows[0]["password_hash"])
        events = await self._events(EVENT_SELF_REGISTER_CREATED)
        self.assertEqual([(e["result"], e["mechanism"]) for e in events], [("success", "bootstrap")])
        # The audit trail stores a keyed digest of the actor, never the email itself.
        self.assertEqual(events[0]["actor_id"], _safe_actor_id(self.email))
        await self._assert_no_plain_email_in_security_events()

        after = await self.client.get("/api/auth/setup-status")
        self.assertEqual(after.json(), {"available": False})
        again = await self.client.post("/api/auth/register", json=self._payload(email=f"itest-other-{uuid.uuid4().hex[:6]}@example.test"))
        self.assertEqual(again.status_code, 409)
        self.assertEqual(len(await self._users()), 1)

    async def test_concurrent_registrations_create_exactly_one_admin(self):
        emails = [f"itest-race-{index}-{uuid.uuid4().hex[:6]}@example.test" for index in range(4)]
        responses = await asyncio.gather(*(
            self.client.post("/api/auth/register", json=self._payload(email=email)) for email in emails
        ))
        self.assertEqual(sorted(r.status_code for r in responses), [200, 409, 409, 409])
        self.assertEqual(len({row["actor_id"] for row in await self._users()}), 1)

    async def test_register_is_404_when_the_window_is_disabled_and_writes_nothing(self):
        with patch("app.cross.api.routes.auth_bootstrap.SELF_REGISTER_SETUP_ENABLED", False):
            response = await self.client.post("/api/auth/register", json=self._payload())
        self.assertEqual(response.status_code, 404)
        self.assertEqual(await self._users(), [])

    async def test_bootstrap_requires_the_real_token_and_logs_the_rejection(self):
        wrong = await self.client.post("/api/auth/bootstrap", json=self._payload(), headers={"X-Bootstrap-Token": "nope"})
        missing = await self.client.post("/api/auth/bootstrap", json=self._payload())
        self.assertEqual((wrong.status_code, missing.status_code), (403, 403))
        self.assertEqual(await self._users(), [])
        self.assertGreaterEqual(len(await self._events(EVENT_TECHNICAL_TOKEN_REJECTED)), 2)

    async def test_bootstrap_creates_the_admin_once(self):
        headers = {"X-Bootstrap-Token": BOOTSTRAP_TOKEN}
        created = await self.client.post("/api/auth/bootstrap", json=self._payload(), headers=headers)
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(created.json(), {"created": True, "actor_id": self.email})
        rows = await self._users()
        self.assertEqual([(r["role_code"], r["granted_by"]) for r in rows], [("admin", "bootstrap")])
        events = await self._events(EVENT_BOOTSTRAP_ADMIN_CREATED)
        self.assertEqual([e["result"] for e in events], ["success"])
        self.assertEqual(events[0]["actor_id"], _safe_actor_id(self.email))

        again = await self.client.post("/api/auth/bootstrap", json=self._payload(), headers=headers)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(len(await self._users()), 1)

    async def test_bootstrap_attempts_are_rate_limited_per_ip(self):
        statuses = []
        for _ in range(BOOTSTRAP_RATE_LIMIT_MAX_ATTEMPTS + 1):
            response = await self.client.post("/api/auth/bootstrap", json=self._payload(), headers={"X-Bootstrap-Token": "wrong"})
            statuses.append(response.status_code)
        self.assertEqual(statuses[:BOOTSTRAP_RATE_LIMIT_MAX_ATTEMPTS], [403] * BOOTSTRAP_RATE_LIMIT_MAX_ATTEMPTS)
        self.assertEqual(statuses[-1], 429)
        self.assertIn("retry-after", {key.lower() for key in response.headers})

    async def test_login_and_status_reflect_the_created_admin(self):
        anonymous = await self.client.get("/api/auth/status")
        self.assertFalse(anonymous.json()["authenticated"])

        await self.client.post("/api/auth/bootstrap", json=self._payload(), headers={"X-Bootstrap-Token": BOOTSTRAP_TOKEN})
        bad = await self.client.post("/api/auth/login", json={"email": self.email, "password": "wrong-password-123"})
        self.assertEqual(bad.status_code, 401)
        ok = await self.client.post("/api/auth/login", json={"email": self.email, "password": PASSWORD})
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertNotIn("password_hash", ok.text)

        status = (await self.client.get("/api/auth/status")).json()
        self.assertTrue(status["authenticated"])
        self.assertEqual(status["user"]["actor_id"], self.email)
        self.assertIn("admin", status["user"]["roles"])
        self.assertIn("access:manage", status["permissions"])
        self.assertFalse(status["setup_available"])


if __name__ == "__main__":
    unittest.main()
