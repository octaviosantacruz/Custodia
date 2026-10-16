"""IF-002 / IF-006: proves pg_advisory_xact_lock -- the primitive
lock_admin_invariant() uses to serialize update_user/delete_user/
update_role/update_composite_role against each other -- actually
serializes two concurrent transactions on a real PostgreSQL instance.
No mock can demonstrate this: a fake cursor has no notion of a second,
independent connection blocking on the same lock key.

Opt-in only: requires DSHUB_TEST_DATABASE_URL to be set explicitly to a
disposable/test PostgreSQL instance. This deliberately never reads
.env.local or falls back to DATABASE_URL -- an earlier version of this
test did, and it silently reused whatever real database that file
pointed at (in this repo, a real RDS instance), attempting a live
network connection to it during `npm run verify`/CI on any machine where
that hostname isn't reachable. DNS resolution against an unreachable
private hostname can block well past any connection-level timeout,
which is exactly what happened: the gate hung instead of skipping
cleanly. This test now makes zero network attempts, and reads zero
files, unless the opt-in variable is present. Never writes or deletes
any row: both transactions only take the lock and sleep, so it's safe
to run against a shared test database.
"""

import asyncio
import time
import unittest

from app.cross.repositories.admin_invariant import lock_admin_invariant
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class AdminInvariantLockConcurrencyPostgresTests(PostgresIntegrationTestCase):
    async def test_second_transaction_waits_for_the_first_to_release_the_lock(self):
        timeline: list[tuple[str, str, float]] = []

        async def first_transaction():
            async with self.pool.connection() as conn:
                async with conn.transaction():
                    async with conn.cursor() as cursor:
                        await lock_admin_invariant(cursor)
                        timeline.append(("first", "acquired", time.monotonic()))
                        await asyncio.sleep(0.3)
                        timeline.append(("first", "released", time.monotonic()))

        async def second_transaction():
            await asyncio.sleep(0.05)  # let the first one acquire first
            async with self.pool.connection() as conn:
                async with conn.transaction():
                    async with conn.cursor() as cursor:
                        timeline.append(("second", "requesting", time.monotonic()))
                        await lock_admin_invariant(cursor)
                        timeline.append(("second", "acquired", time.monotonic()))

        await asyncio.gather(first_transaction(), second_transaction())

        first_released_at = next(t for who, event, t in timeline if who == "first" and event == "released")
        second_acquired_at = next(t for who, event, t in timeline if who == "second" and event == "acquired")

        # The real proof this is a genuine lock and not two independent,
        # concurrently-granted no-ops: the second connection's acquisition
        # never happens before the first one actually released.
        self.assertGreaterEqual(second_acquired_at, first_released_at)


if __name__ == "__main__":
    unittest.main()
