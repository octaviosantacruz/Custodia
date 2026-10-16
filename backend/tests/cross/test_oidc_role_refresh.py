import asyncio
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import app.auth as auth


class AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


class FakeCursor:
    def __init__(self, fetchone_values=None):
        self.execute_calls = []
        self.executemany_calls = []
        self.fetchone_values = list(fetchone_values if fetchone_values is not None else [None, {"actor_id": "oidc-user"}])

    async def execute(self, query, params):
        self.execute_calls.append((query, params))

    async def executemany(self, query, params):
        self.executemany_calls.append((query, params))

    async def fetchone(self):
        return self.fetchone_values.pop(0)


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor

    async def execute(self, query, params):
        await self.cursor_value.execute(query, params)

    def transaction(self):
        return AsyncContext(None)

    def cursor(self):
        return AsyncContext(self.cursor_value)


class FakePool:
    def __init__(self, connection):
        self.connection_value = connection

    def connection(self):
        return AsyncContext(self.connection_value)


class OidcRoleRefreshTests(unittest.TestCase):
    def test_empty_claims_remove_previous_roles(self):
        cursor = FakeCursor()
        request = SimpleNamespace(
            session={},
            app=SimpleNamespace(state=SimpleNamespace(db=FakePool(FakeConnection(cursor)))),
        )
        provider = SimpleNamespace(authorize_access_token=AsyncMock(return_value={
            "userinfo": {"sub": "oidc-user", "email": "oidc@example.com"},
        }))
        with patch.object(auth, "effective_role_pairs", new=AsyncMock(return_value=([], "environment"))), patch.object(auth, "OIDC_ENABLED", True), patch.object(auth, "OIDC_CONFIGURED", True), patch.object(auth, "OIDC_ISSUER_URL", "https://issuer.example/oauth2/default"), patch.object(auth, "oidc_roles", return_value=[]), patch.object(auth, "record_security_event_for_request", new=AsyncMock()) as event, patch.object(auth.oauth, "idp", provider, create=True):
            asyncio.run(auth.finish_oidc_login(request))
        self.assertEqual(cursor.execute_calls[0][1], ("oidc-user",))
        self.assertIn("access_oidc_users", cursor.execute_calls[1][0])
        self.assertEqual(cursor.execute_calls[1][1], ("oidc-user", "https://issuer.example/oauth2/default", "oidc-user", "oidc@example.com", "oidc@example.com"))
        self.assertEqual(len(cursor.executemany_calls), 1)
        self.assertEqual(cursor.executemany_calls[0][1], [])
        self.assertEqual(event.await_args.kwargs["event_type"], "oidc_role_sync")

    def test_local_actor_collision_rejects_login_before_roles_change(self):
        cursor = FakeCursor([{"exists": 1}])
        request = SimpleNamespace(session={}, app=SimpleNamespace(state=SimpleNamespace(db=FakePool(FakeConnection(cursor)))))
        provider = SimpleNamespace(authorize_access_token=AsyncMock(return_value={"userinfo": {"sub": "local-user", "email": "same@example.com"}}))
        with patch.object(auth, "effective_role_pairs", new=AsyncMock(return_value=([], "environment"))), patch.object(auth, "OIDC_ENABLED", True), patch.object(auth, "OIDC_CONFIGURED", True), patch.object(auth, "OIDC_ISSUER_URL", "https://issuer.example"), patch.object(auth.oauth, "idp", provider, create=True), patch.object(auth, "record_security_event_for_request", new=AsyncMock()) as event:
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(auth.finish_oidc_login(request))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(len(cursor.execute_calls), 1)
        self.assertEqual(cursor.executemany_calls, [])
        self.assertEqual(request.session, {})
        event.assert_not_awaited()

    def test_missing_subject_rejects_login_without_database_write(self):
        request = SimpleNamespace(session={}, app=SimpleNamespace(state=SimpleNamespace(db=object())))
        provider = SimpleNamespace(authorize_access_token=AsyncMock(return_value={"userinfo": {"email": "user@example.com"}}))
        with patch.object(auth, "effective_role_pairs", new=AsyncMock(return_value=([], "environment"))), patch.object(auth, "OIDC_ENABLED", True), patch.object(auth, "OIDC_CONFIGURED", True), patch.object(auth.oauth, "idp", provider, create=True):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(auth.finish_oidc_login(request))
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(request.session, {})

    def test_existing_subject_from_another_issuer_does_not_take_roles(self):
        cursor = FakeCursor([None, None])
        request = SimpleNamespace(session={}, app=SimpleNamespace(state=SimpleNamespace(db=FakePool(FakeConnection(cursor)))))
        provider = SimpleNamespace(authorize_access_token=AsyncMock(return_value={"userinfo": {"sub": "oidc-user"}}))
        with patch.object(auth, "effective_role_pairs", new=AsyncMock(return_value=([], "environment"))), patch.object(auth, "OIDC_ENABLED", True), patch.object(auth, "OIDC_CONFIGURED", True), patch.object(auth, "OIDC_ISSUER_URL", "https://new-issuer.example"), patch.object(auth.oauth, "idp", provider, create=True):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(auth.finish_oidc_login(request))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(len(cursor.execute_calls), 2)
        self.assertEqual(cursor.executemany_calls, [])
        self.assertEqual(request.session, {})


if __name__ == "__main__":
    unittest.main()
