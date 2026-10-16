"""PENTEST-001: end-to-end HTTP proof that the self-register first-admin
window is closed by default.

test_auth_sql_regression.py already covers this at the dependency-function
level (calling register_first_user/auth_setup_status directly). This module
proves the same thing through the real ASGI app -- no session, no mocked
dependency function -- matching how the original pentest finding was
confirmed (a real HTTP POST /api/auth/register with no token succeeded).
"""

import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ.update({
    'DATABASE_URL': 'postgresql://test:test@127.0.0.1:5432/cmdb',
    'SESSION_SECRET': 'test-only-session-secret-at-least-32-bytes',
    'INGESTION_INTERVAL_MINUTES': '1440',
    'AUTH_MODE': 'local',
    'SESSION_HTTPS_ONLY': 'false',
})

import httpx  # noqa: E402

from app.main import app  # noqa: E402


class SelfRegisterSetupClosedByDefaultTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.rate_limit = patch("app.cross.api.routes.auth_bootstrap.enforce_rate_limit", new=AsyncMock())
        self.clear_rate_limit = patch("app.cross.api.routes.auth_bootstrap.clear_rate_limit", new=AsyncMock())
        self.rate_limit.start()
        self.clear_rate_limit.start()
        self.addCleanup(self.rate_limit.stop)
        self.addCleanup(self.clear_rate_limit.stop)
        # enforce_rate_limit/clear_rate_limit are mocked above, but the
        # route still evaluates `request.app.state.db` as a plain argument
        # expression before calling them -- that attribute access happens
        # regardless of mocking, so it needs to actually exist.
        self.db_state = patch.object(app.state, "db", object(), create=True)
        self.db_state.start()
        self.addCleanup(self.db_state.stop)
        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)

    async def test_register_is_404_with_no_token_and_no_env_var_set(self):
        """The exact scenario the pentest finding confirmed with a real HTTP
        request: no ALLOW_SELF_REGISTER_SETUP set (the packaged default),
        no bootstrap token, no session -- used to succeed with 200."""
        with patch("app.cross.services.initial_admin.create_first_local_admin", new=AsyncMock(return_value=None)) as create:
            response = await self.client.post(
                "/api/auth/register",
                json={"email": "attacker@example.test", "password": "Abcdef1!", "display_name": "Attacker"},
            )
        self.assertEqual(response.status_code, 404)
        create.assert_not_awaited()

    async def test_setup_status_never_reports_available_by_default(self):
        with patch("app.cross.api.routes.auth_session.count_local_users", new=AsyncMock(return_value=0)) as count:
            response = await self.client.get("/api/auth/setup-status")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"available": False})
        count.assert_not_awaited()

    async def test_bootstrap_token_path_still_requires_the_real_token(self):
        """The unattended path stays open and still requires
        AUTH_BOOTSTRAP_TOKEN regardless of ALLOW_SELF_REGISTER_SETUP."""
        response = await self.client.post(
            "/api/auth/bootstrap",
            json={"email": "admin@example.test", "password": "Abcdef1!", "display_name": "Admin"},
        )
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
