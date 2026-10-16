"""IF-006: proves reserve_attempt() is genuinely atomic under real
concurrent load -- a fake cursor executed one call at a time can't
demonstrate that N truly-simultaneous callers against the same bucket_key
each get a distinct, correctly-incrementing attempt_count out of a single
row in Postgres, with no lost updates. Opt-in only; see
tests/support/pg_integration_base.py."""

import asyncio
import uuid

from app.cross.repositories.rate_limiting import reserve_attempt
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class RateLimitReservationConcurrencyPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.rate_limit_attempts")

    async def asyncTearDown(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.rate_limit_attempts")

    async def test_concurrent_reservations_against_the_same_bucket_never_lose_an_update(self):
        # A single-threaded fake can never prove this: the whole risk is a
        # read-then-write race between two genuinely simultaneous
        # transactions on the same row. 20 truly concurrent reservations
        # against one bucket_key must produce exactly the counts 1..20,
        # with no duplicate and no gap -- any lost update would show up as
        # a duplicate count or a count above 20.
        bucket_key = f"ip:{uuid.uuid4()}"
        results = await asyncio.gather(*(
            reserve_attempt(self.pool, bucket_key, window_seconds=60) for _ in range(20)
        ))
        self.assertEqual(sorted(results), list(range(1, 21)))

    async def test_concurrent_reservations_against_different_buckets_do_not_interfere(self):
        bucket_keys = [f"ip:{uuid.uuid4()}" for _ in range(10)]
        results = await asyncio.gather(*(
            reserve_attempt(self.pool, key, window_seconds=60) for key in bucket_keys
        ))
        # Each bucket is brand new, so every single one must start at 1 --
        # a bug that accidentally shared state across bucket_keys (e.g. a
        # hashing collision or a missing WHERE clause) would show up as a
        # count greater than 1 here.
        self.assertEqual(results, [1] * 10)


if __name__ == "__main__":
    import unittest
    unittest.main()
