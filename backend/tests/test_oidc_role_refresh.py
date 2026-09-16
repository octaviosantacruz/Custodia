import asyncio
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import app.auth as auth


class AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


class FakeCursor:
    def __init__(self):
        self.execute_calls = []
        self.executemany_calls = []

    async def execute(self, query, params):
        self.execute_calls.append((query, params))

    async def executemany(self, query, params):
        self.executemany_calls.append((query, params))


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor

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
        with patch.object(auth, "OIDC_ENABLED", True), patch.object(auth, "OIDC_CONFIGURED", True), patch.object(auth, "oidc_roles", return_value=[]), patch.object(auth, "record_security_event_for_request", new=AsyncMock()) as event, patch.object(auth.oauth, "idp", provider, create=True):
            asyncio.run(auth.finish_oidc_login(request))
        self.assertEqual(cursor.execute_calls[0][1], ("oidc-user",))
        self.assertEqual(len(cursor.executemany_calls), 1)
        self.assertEqual(cursor.executemany_calls[0][1], [])
        self.assertEqual(event.await_args.kwargs["event_type"], "oidc_role_sync")


if __name__ == "__main__":
    unittest.main()
