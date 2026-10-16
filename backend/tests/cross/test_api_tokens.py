import asyncio
import os
import time
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.update({
    "DATABASE_URL": "postgresql://test:test@127.0.0.1:5432/cmdb",
    "SESSION_SECRET": "test-only-session-secret-at-least-32-bytes",
    "INGESTION_INTERVAL_MINUTES": "1440",
    "AUTH_MODE": "local",
    "SESSION_HTTPS_ONLY": "false",
})

import httpx  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import app.auth as auth  # noqa: E402
from app.main import app  # noqa: E402
from app.cross.services.api_tokens import digest_api_token, generate_api_token  # noqa: E402
from app.cross.services.password_hashing import hash_password  # noqa: E402


PASSWORD = "Sample123456789!"
PASSWORD_HASH = hash_password(PASSWORD)


class ApiTokenPrimitiveTests(unittest.TestCase):
    def test_generated_token_has_a_recognizable_prefix_and_high_entropy_payload(self):
        token = generate_api_token()
        self.assertRegex(token, r"^dsh_pat_[A-Za-z0-9_-]{40,}$")
        self.assertNotEqual(token, generate_api_token())

    def test_digest_is_stable_and_never_contains_the_raw_token(self):
        token = "dsh_pat_example-token-value"
        digest = digest_api_token(token)
        self.assertRegex(digest, r"^[0-9a-f]{64}$")
        self.assertEqual(digest, digest_api_token(token))
        self.assertNotIn(token, digest)


class BearerDependencyTests(unittest.TestCase):
    def request(self, *, authorization: str | None = None, method: str = "GET"):
        headers = {} if authorization is None else {"Authorization": authorization}
        return SimpleNamespace(
            headers=headers,
            method=method,
            url=SimpleNamespace(path="/api/summary"),
            session={},
            state=SimpleNamespace(),
            app=SimpleNamespace(state=SimpleNamespace(db=object())),
            client=SimpleNamespace(host="127.0.0.1"),
        )

    def test_valid_bearer_token_can_authenticate_a_read(self):
        request = self.request(authorization="Bearer dsh_pat_valid")
        with patch("app.auth.resolve_api_token", new=AsyncMock(return_value={"actor_id": "reader-1"})), \
             patch("app.auth.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"])):
            actor = asyncio.run(auth.require_read_access(request))
        self.assertEqual(actor, "reader-1")
        self.assertEqual(request.state.actor_id, "reader-1")

    def test_invalid_bearer_token_is_rejected_without_falling_back_to_a_cookie(self):
        request = self.request(authorization="Bearer dsh_pat_invalid")
        request.session = {
            "user": {"actor_id": "cookie-user", "auth_source": "oidc"},
            auth.SESSION_STARTED_AT: time.time(),
            auth.SESSION_LAST_ACTIVITY_AT: time.time(),
        }
        with patch("app.auth.resolve_api_token", new=AsyncMock(return_value=None)), \
             patch("app.auth.record_security_event_for_request", new=AsyncMock()):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(auth.require_read_access(request))
        self.assertEqual(error.exception.status_code, 401)

    def test_bearer_token_is_rejected_on_mutating_methods(self):
        request = self.request(authorization="Bearer dsh_pat_valid", method="POST")
        with patch("app.auth.resolve_api_token", new=AsyncMock(return_value={"actor_id": "reader-1"})), \
             patch("app.auth.record_security_event_for_request", new=AsyncMock()):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(auth.require_read_access(request))
        self.assertEqual(error.exception.status_code, 401)

    def test_x_access_token_is_still_not_a_read_credential(self):
        request = self.request()
        request.headers = {"X-Access-Token": "technical-token"}
        with self.assertRaises(HTTPException) as error:
            asyncio.run(auth.require_read_access(request))
        self.assertEqual(error.exception.status_code, 401)


class ApiTokenHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(app.state, "db", object(), create=True))
        self.permissions = self.stack.enter_context(
            patch("app.auth.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"]))
        )
        self.session_version = self.stack.enter_context(
            patch("app.auth.get_session_version", new=AsyncMock(return_value=1))
        )
        self.stack.enter_context(
            patch(
                "app.cross.services.local_authentication.find_local_user_for_login",
                new=AsyncMock(return_value={
                    "actor_id": "reader-1",
                    "email": "reader-1@example.test",
                    "display_name": "Reader One",
                    "password_hash": PASSWORD_HASH,
                    "must_change_password": False,
                    "session_version": 1,
                    "roles": ["reader"],
                    "role_names": ["Lector"],
                }),
            )
        )
        self.stack.enter_context(
            patch("app.cross.services.local_authentication.verify_password_async", new=AsyncMock(return_value=True))
        )
        self.stack.enter_context(
            patch("app.cross.api.routes.auth_session.enforce_rate_limit", new=AsyncMock(return_value=None))
        )
        self.stack.enter_context(
            patch("app.cross.api.routes.auth_session.clear_rate_limit", new=AsyncMock(return_value=None))
        )
        self.stack.enter_context(
            patch("app.cross.api.routes.auth_session.record_security_event_for_request", new=AsyncMock())
        )
        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)

    async def login(self):
        response = await self.client.post(
            "/api/auth/login",
            json={"email": "reader-1@example.test", "password": PASSWORD},
        )
        self.assertEqual(response.status_code, 200, response.text)

    async def test_session_can_issue_a_token_and_plaintext_is_returned_only_on_creation(self):
        await self.login()
        issued = {
            "token_id": "11111111-1111-1111-1111-111111111111",
            "label": "quarter-report",
            "created_at": "2026-09-14T00:00:00Z",
            "expires_at": "2026-09-14T01:00:00Z",
        }
        with patch("app.cross.services.api_token_management.generate_api_token", return_value="dsh_pat_once"), \
             patch("app.cross.services.api_token_management.create_api_token", new=AsyncMock(return_value=issued)) as create, \
             patch("app.cross.api.routes.auth_api_tokens.record_security_event_for_request", new=AsyncMock()):
            response = await self.client.post(
                "/api/auth/api-tokens",
                json={"label": "quarter-report", "expires_in_minutes": 60},
            )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["token"], "dsh_pat_once")
        self.assertEqual(response.json()["token_type"], "Bearer")
        self.assertNotIn("dsh_pat_once", repr(create.await_args.kwargs))
        self.assertRegex(create.await_args.kwargs["token_digest"], r"^[0-9a-f]{64}$")

        listed_item = {
            **issued,
            "auth_source": "local",
            "revoked_at": None,
            "status": "active",
        }
        with patch("app.cross.services.api_token_management.list_api_tokens", new=AsyncMock(return_value=[listed_item])):
            listed = await self.client.get("/api/auth/api-tokens")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertNotIn("token", listed.json()["rows"][0])

    async def test_bearer_can_read_sensitive_api_but_cannot_issue_or_use_mutations(self):
        self.client.cookies.clear()
        self.permissions.return_value = ["inventory:read", "access:manage"]
        # The typed SummaryResponse contract (AUD-API-002) requires the full
        # shape; this test only exercises the read gate.
        with patch("app.auth.resolve_api_token", new=AsyncMock(return_value={"actor_id": "reader-1"})), \
             patch("app.auth.record_security_event_for_request", new=AsyncMock()), \
             patch("app.cyberark.pam.api.routes.analytics.get_summary", new=AsyncMock(return_value={
                 "safes": 465, "business_safes": 0, "internal_safes": 0, "scope_pending_safes": 0,
                 "scope_candidate_safes": 0, "clean_business_safes": 0, "obsolete_safes": 0,
                 "duplicate_safes": 0, "accounts": 0, "pending_classification": 0, "assigned": 0,
                 "review": 0,
                 "safe_health": {"denominator": 0, "missing_cpm": 0, "no_accounts": 0,
                                 "olac_disabled": 0, "retention_unconfigured": 0,
                                 "manage_safe_concentration": 0},
                 "latest_run": None,
             })):
            read_response = await self.client.get(
                "/api/summary", headers={"Authorization": "Bearer dsh_pat_valid"}
            )
            # The typed UsersResponse contract (AUD-API-002) requires the full
            # page shape; this test only exercises the read gate.
            with patch("app.cross.services.user_management.list_users", new=AsyncMock(
                    return_value={"rows": [], "total": 0, "limit": 50, "offset": 0})):
                sensitive_read_response = await self.client.get(
                    "/api/auth/users", headers={"Authorization": "Bearer dsh_pat_valid"}
                )
            issue_response = await self.client.post(
                "/api/auth/api-tokens",
                headers={"Authorization": "Bearer dsh_pat_valid"},
                json={"label": "nested-token", "expires_in_minutes": 60},
            )
            mutation_response = await self.client.post(
                "/api/dashboard/preferences/preview",
                headers={"Authorization": "Bearer dsh_pat_valid"},
                json={"widgets": []},
            )
            protected_mutation_response = await self.client.patch(
                "/api/safes/123/metadata",
                headers={"Authorization": "Bearer dsh_pat_valid"},
                json={"classification_status": "assigned"},
            )
        self.assertEqual(read_response.status_code, 200, read_response.text)
        self.assertEqual(sensitive_read_response.status_code, 200, sensitive_read_response.text)
        self.assertEqual(issue_response.status_code, 401, issue_response.text)
        self.assertEqual(mutation_response.status_code, 401, mutation_response.text)
        self.assertEqual(protected_mutation_response.status_code, 401, protected_mutation_response.text)

    async def test_session_can_revoke_only_its_own_token(self):
        await self.login()
        with patch("app.cross.services.api_token_management.revoke_api_token", new=AsyncMock(return_value=True)) as revoke, \
             patch("app.cross.api.routes.auth_api_tokens.record_security_event_for_request", new=AsyncMock()):
            response = await self.client.delete(
                "/api/auth/api-tokens/11111111-1111-1111-1111-111111111111"
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"revoked": True})
        self.assertEqual(revoke.await_args.args[1], "reader-1")


if __name__ == "__main__":
    unittest.main()
