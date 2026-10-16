import asyncio
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import UUID

from app.cross.repositories.api_tokens import (
    TooManyActiveApiTokens,
    create_api_token,
    list_api_tokens,
    resolve_api_token,
    revoke_api_token,
)


class AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


class FakeCursor:
    def __init__(self, fetchone_results=None):
        self.execute_calls: list[tuple[str, tuple]] = []
        self._fetchone_results = list(fetchone_results or [])

    async def execute(self, query, params=()):
        self.execute_calls.append((query, params))

    async def fetchone(self):
        return self._fetchone_results.pop(0)


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor

    def transaction(self):
        return AsyncContext(None)

    def cursor(self):
        return AsyncContext(self.cursor_value)


class FakePool:
    def __init__(self, cursor):
        self.connection_value = FakeConnection(cursor)

    def connection(self):
        return AsyncContext(self.connection_value)


class ApiTokenRepositoryTests(unittest.TestCase):
    def test_creation_persists_only_the_digest_and_audits_in_the_transaction(self):
        created_at = datetime.now(UTC)
        expires_at = created_at + timedelta(hours=1)
        token_id = UUID("11111111-1111-1111-1111-111111111111")
        cursor = FakeCursor(fetchone_results=[
            {"count": 0},
            {
                "token_id": token_id,
                "label": "quarter-report",
                "created_at": created_at,
                "expires_at": expires_at,
            },
        ])
        pool = FakePool(cursor)
        with patch("app.cross.repositories.api_tokens.uuid4", return_value=token_id), \
             patch("app.cross.repositories.api_tokens.record_audit", new=AsyncMock()) as audit:
            result = asyncio.run(create_api_token(
                pool,
                actor_id="reader-1",
                auth_source="local",
                session_version=3,
                label="quarter-report",
                token_digest="a" * 64,
                expires_at=expires_at,
            ))
        self.assertEqual(result["token_id"], token_id)
        insert_query, insert_params = cursor.execute_calls[2]
        self.assertIn("INSERT INTO public.access_api_tokens", insert_query)
        self.assertIn("a" * 64, insert_params)
        self.assertNotIn("dsh_pat_", repr(insert_params))
        self.assertIs(audit.await_args.kwargs["connection"], pool.connection_value)
        self.assertNotIn("token", repr(audit.await_args.kwargs["after_data"]).casefold())

    def test_creation_enforces_the_active_token_limit_before_insert(self):
        cursor = FakeCursor(fetchone_results=[{"count": 10}])
        pool = FakePool(cursor)
        with self.assertRaises(TooManyActiveApiTokens):
            asyncio.run(create_api_token(
                pool,
                actor_id="reader-1",
                auth_source="local",
                session_version=1,
                label="overflow",
                token_digest="a" * 64,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            ))
        self.assertEqual(len(cursor.execute_calls), 2)

    def test_resolution_requires_unexpired_unrevoked_token_and_current_actor_state(self):
        with patch("app.cross.repositories.api_tokens.fetch_one", new=AsyncMock(return_value=None)) as fetch:
            result = asyncio.run(resolve_api_token(object(), "a" * 64))
        self.assertIsNone(result)
        query, params = fetch.await_args.args[1], fetch.await_args.args[2]
        self.assertIn("token_hash = %s", query)
        self.assertIn("revoked_at IS NULL", query)
        self.assertIn("expires_at > now()", query)
        self.assertIn("session_version", query)
        self.assertIn("access_user_roles", query)
        self.assertEqual(params, ("a" * 64,))

    def test_listing_never_selects_the_token_hash(self):
        with patch("app.cross.repositories.api_tokens.fetch_all", new=AsyncMock(return_value=[])) as fetch:
            result = asyncio.run(list_api_tokens(object(), "reader-1"))
        self.assertEqual(result, [])
        select_clause = fetch.await_args.args[1].split("FROM", 1)[0]
        self.assertNotIn("token_hash", select_clause)

    def test_revoke_is_scoped_to_the_authenticated_owner(self):
        token_id = UUID("11111111-1111-1111-1111-111111111111")
        cursor = FakeCursor(fetchone_results=[{
            "token_id": token_id,
            "label": "quarter-report",
            "expires_at": datetime.now(UTC) + timedelta(hours=1),
        }])
        pool = FakePool(cursor)
        with patch("app.cross.repositories.api_tokens.record_audit", new=AsyncMock()) as audit:
            result = asyncio.run(revoke_api_token(pool, "reader-1", token_id))
        self.assertTrue(result)
        query, params = cursor.execute_calls[0]
        self.assertIn("actor_id = %s", query)
        self.assertEqual(params, (token_id, "reader-1"))
        self.assertEqual(audit.await_args.kwargs["actor_id"], "reader-1")
        self.assertIs(audit.await_args.kwargs["connection"], pool.connection_value)


if __name__ == "__main__":
    unittest.main()
