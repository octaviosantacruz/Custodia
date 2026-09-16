import asyncio
import os
import time
import unittest
from collections import defaultdict
from unittest.mock import AsyncMock, patch

os.environ.update({
    'DATABASE_URL': 'postgresql://test:test@127.0.0.1:5432/cmdb',
    'SESSION_SECRET': 'test-only-secret-for-rate-limiting-tests',
    'INGESTION_INTERVAL_MINUTES': '1440',
    'AUTH_MODE': 'local',
    'SESSION_HTTPS_ONLY': 'false',
})

import httpx  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from app.services.rate_limit_enforcement import enforce_rate_limit  # noqa: E402
from app.main import app  # noqa: E402
from app.repositories.rate_limiting import reserve_attempt  # noqa: E402
from app.services.password_hashing import hash_password  # noqa: E402


class SharedRateLimitRepositoryTests(unittest.TestCase):
    def test_reservation_is_a_single_atomic_upsert(self):
        with patch(
            "app.repositories.rate_limiting.fetch_one",
            new=AsyncMock(return_value={"attempt_count": 3}),
        ) as fetch_one:
            count = asyncio.run(reserve_attempt(object(), "ip:127.0.0.1", 60))

        self.assertEqual(count, 3)
        query = fetch_one.await_args.args[1]
        self.assertIn("INSERT INTO public.rate_limit_attempts", query)
        self.assertIn("ON CONFLICT (bucket_key) DO UPDATE", query)
        self.assertIn("RETURNING attempt_count", query)

    def test_reservation_never_sends_the_raw_bucket_key_to_sql(self):
        """IF-001: only a keyed HMAC digest of the caller-supplied
        bucket_key (e.g. an attacker-chosen email string) ever reaches
        SQL/storage."""
        with patch(
            "app.repositories.rate_limiting.fetch_one",
            new=AsyncMock(return_value={"attempt_count": 1}),
        ) as fetch_one:
            asyncio.run(reserve_attempt(object(), "email:attacker@example.test", 60))

        params = fetch_one.await_args.args[2]
        self.assertNotEqual(params["bucket_key"], "email:attacker@example.test")
        self.assertNotIn("attacker@example.test", params["bucket_key"])
        self.assertEqual(len(params["bucket_key"]), 64)

    def test_hashing_is_deterministic_and_distinguishes_different_keys(self):
        from app.repositories.rate_limiting import _hash_bucket_key

        self.assertEqual(_hash_bucket_key("ip:1.2.3.4"), _hash_bucket_key("ip:1.2.3.4"))
        self.assertNotEqual(_hash_bucket_key("ip:1.2.3.4"), _hash_bucket_key("ip:1.2.3.5"))
        self.assertNotEqual(_hash_bucket_key("ip:1.2.3.4"), _hash_bucket_key("email:1.2.3.4"))

    def test_purge_expired_attempts_deletes_by_age_and_returns_the_count(self):
        executed = {}

        class FakeCursor:
            rowcount = 7

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def execute(self, query, params):
                executed["query"] = query
                executed["params"] = params

        class FakeConnection:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            def cursor(self):
                return FakeCursor()

        class FakePool:
            def connection(self):
                return FakeConnection()

        from app.repositories.rate_limiting import purge_expired_attempts
        deleted = asyncio.run(purge_expired_attempts(FakePool(), 86400))

        self.assertEqual(deleted, 7)
        self.assertIn("DELETE FROM public.rate_limit_attempts", executed["query"])
        self.assertIn("window_started_at", executed["query"])
        self.assertEqual(executed["params"], (86400,))

    def test_enforcement_reserves_before_rejecting_the_over_limit_attempt(self):
        with patch("app.services.rate_limit_enforcement.reserve_attempt", new=AsyncMock(side_effect=[10, 11])) as reserve:
            with self.assertRaises(HTTPException) as error:
                asyncio.run(enforce_rate_limit(object(), ["ip:test", "email:test"], max_attempts=10, window_seconds=60))

        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(error.exception.headers, {"Retry-After": "60"})
        self.assertEqual(reserve.await_count, 2)

    def test_rate_limit_uses_actual_remaining_window(self):
        async def reserve_with_remaining(pool, bucket_key, window_seconds):
            from app.repositories.rate_limiting import RateLimitReservation
            return RateLimitReservation(11, 7)

        with patch("app.services.rate_limit_enforcement.reserve_attempt", new=reserve_with_remaining):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(enforce_rate_limit(object(), ["ip:test"], max_attempts=10, window_seconds=60))
        self.assertEqual(error.exception.headers, {"Retry-After": "7"})

    def test_bucket_keys_are_reserved_concurrently_not_sequentially(self):
        # Each key's reservation is deliberately slow (0.1s); if
        # enforce_rate_limit awaited them one after another, three keys
        # would take ~0.3s. Reserved concurrently, it should take ~0.1s.
        async def slow_reserve(pool, bucket_key, window_seconds):
            await asyncio.sleep(0.1)
            return 1

        with patch("app.services.rate_limit_enforcement.reserve_attempt", new=slow_reserve):
            start = time.monotonic()
            asyncio.run(enforce_rate_limit(object(), ["a", "b", "c"], max_attempts=10, window_seconds=60))
            elapsed = time.monotonic() - start

        self.assertLess(elapsed, 0.2, f"took {elapsed:.3f}s -- looks sequential, not concurrent")

    def test_clear_attempts_deletes_the_bucket_row(self):
        executed = {}

        class FakeCursor:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def execute(self, query, params):
                executed["query"] = query
                executed["params"] = params

        class FakeConnection:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            def cursor(self):
                return FakeCursor()

        class FakePool:
            def connection(self):
                return FakeConnection()

        from app.repositories.rate_limiting import clear_attempts
        asyncio.run(clear_attempts(FakePool(), "ip:127.0.0.1"))

        self.assertIn("DELETE FROM public.rate_limit_attempts", executed["query"])
        # IF-001: the raw bucket_key is never sent to SQL -- only a keyed
        # HMAC digest of it, so a raw IP/email never lands in the table.
        self.assertNotEqual(executed["params"], ("ip:127.0.0.1",))
        self.assertEqual(len(executed["params"]), 1)
        self.assertEqual(len(executed["params"][0]), 64)  # sha256 hex digest


class ConcurrentLoginRateLimitHttpTests(unittest.IsolatedAsyncioTestCase):
    """PENTEST-006: a real ASGI HTTP test with genuinely concurrent
    requests, proving the atomic reserve-before-verify ordering holds even
    when many login attempts for the same bucket race each other -- not
    just when a test calls the dependency function sequentially.

    reserve_attempt is replaced with an in-memory stand-in guarded by a
    single asyncio.Lock (the same guarantee a real Postgres UPSERT gives:
    only one increment is ever "in flight" for a given bucket_key at a
    time), so this exercises the real route/middleware stack concurrently
    without needing a live database connection.
    """

    async def asyncSetUp(self):
        self.attempts = defaultdict(int)
        self.lock = asyncio.Lock()
        self.verify_calls = 0

        async def fake_reserve_attempt(pool, bucket_key, window_seconds):
            async with self.lock:
                self.attempts[bucket_key] += 1
                return self.attempts[bucket_key]

        async def fake_verify_password_async(password, encoded_hash):
            self.verify_calls += 1
            return False  # every attempt is a wrong password

        self.db_state_patch = patch.object(app.state, "db", object(), create=True)
        self.reserve_patch = patch("app.services.rate_limit_enforcement.reserve_attempt", new=fake_reserve_attempt)
        self.clear_patch = patch("app.api.routes.auth_session.clear_rate_limit", new=AsyncMock())
        self.verify_patch = patch("app.api.routes.auth_session.verify_password_async", new=fake_verify_password_async)
        self.find_user_patch = patch(
            "app.api.routes.auth_session.find_local_user_for_login",
            new=AsyncMock(return_value={
                "actor_id": "actor-1", "email": "actor@example.test", "display_name": "Actor",
                "password_hash": hash_password("Sample123456789!"), "must_change_password": False,
                "session_version": 1, "roles": ["reader"], "role_names": ["Lector"],
            }),
        )
        self.db_state_patch.start()
        self.reserve_patch.start()
        self.clear_patch.start()
        self.verify_patch.start()
        self.find_user_patch.start()
        self.addCleanup(self.db_state_patch.stop)
        self.addCleanup(self.reserve_patch.stop)
        self.addCleanup(self.clear_patch.stop)
        self.addCleanup(self.verify_patch.stop)
        self.addCleanup(self.find_user_patch.stop)

        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)

    async def test_a_concurrent_burst_never_lets_more_than_the_limit_through(self):
        max_attempts = 10
        burst_size = 20  # deliberately larger than the limit

        async def attempt():
            return await self.client.post(
                "/api/auth/login", json={"email": "actor@example.test", "password": "wrong-password"},
            )

        responses = await asyncio.gather(*(attempt() for _ in range(burst_size)))
        statuses = [response.status_code for response in responses]

        # Every request is a wrong password, so an allowed attempt is a 401
        # (credential check happened) and a blocked one is a 429 (rejected
        # before the credential was ever checked).
        allowed = statuses.count(401)
        blocked = statuses.count(429)
        self.assertEqual(allowed + blocked, burst_size)
        self.assertEqual(allowed, max_attempts)
        self.assertEqual(blocked, burst_size - max_attempts)
        # verify_password_async must never run for a request that was
        # rejected by the rate limiter -- this is the actual TOCTOU fix:
        # reserving happens strictly before the expensive/observable work.
        self.assertEqual(self.verify_calls, allowed)


if __name__ == "__main__":
    unittest.main()
