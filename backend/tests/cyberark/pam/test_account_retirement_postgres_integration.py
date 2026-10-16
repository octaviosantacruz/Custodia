from uuid import uuid4

from app.cyberark.pam.repositories.account_queries import get_safe_accounts
from app.cyberark.pam.services.pam_accounts import sync_accounts
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class AccountRetirementPostgresTests(PostgresIntegrationTestCase):
    """SAFE-RETENTION-002: a retired account records when, and a Safe being decommissioned moves to
    ``retention_hold``; no other Safe's human classification is touched by the sync."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.run_id = uuid4()
        base = 1_100_000_000 + int(uuid4().hex[:6], 16) * 10
        # decommission in progress / ordinary Safe / already resolved decommission / decommission without deleted account
        self.decom, self.ordinary, self.resolved, self.untouched = base, base + 1, base + 2, base + 3
        self.safes = [self.decom, self.ordinary, self.resolved, self.untouched]
        self.names = {number: f"ret-{self.run_id.hex[:8]}-{index}" for index, number in enumerate(self.safes)}
        self.addAsyncCleanup(self._cleanup)
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO public.cyberark_ingestion_runs (run_id, source_system, source_file, status, started_at, completed_at) VALUES (%s, 'cyberark', %s, 'completed', now(), now())",
                (self.run_id, f"retirement-{self.run_id}"),
            )
            for number in self.safes:
                await conn.execute(
                    "INSERT INTO public.safes (safe_number, safe_name, safe_url_id, source_run_id, lifecycle_status) VALUES (%s, %s, %s, %s, 'active')",
                    (number, self.names[number], self.names[number], self.run_id),
                )
            for number, action, status in (
                (self.decom, 'Dar de baja', 'in_progress'), (self.ordinary, 'Revisar', 'in_progress'),
                (self.resolved, 'Dar de baja', 'resolved'), (self.untouched, 'Dar de baja', 'pending'),
            ):
                await conn.execute(
                    "INSERT INTO public.cyberark_safe_metadata (safe_number, workflow_status, next_action) VALUES (%s, %s, %s)",
                    (number, status, action),
                )

    async def _cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.cyberark_accounts WHERE safe_number = ANY(%s)", (self.safes,))
            await conn.execute("DELETE FROM public.cyberark_safe_metadata WHERE safe_number = ANY(%s)", (self.safes,))
            await conn.execute("DELETE FROM public.access_audit_log WHERE entity_type = 'safe_metadata' AND entity_id = ANY(%s)", ([str(n) for n in self.safes],))
            await conn.execute("DELETE FROM public.safes WHERE safe_number = ANY(%s)", (self.safes,))
            await conn.execute("DELETE FROM public.cyberark_ingestion_runs WHERE run_id = %s", (self.run_id,))

    def _account(self, number, account_id):
        return {"id": f"{account_id}-{self.run_id.hex[:8]}", "safeName": self.names[number], "name": account_id, "userName": "svc"}

    async def _sync(self, accounts, run_id=None):
        # every account row of the fixture's Safes is "active" from the previous run until this one lists it
        return await sync_accounts(self.pool, accounts, {name: str(number) for number, name in self.names.items()}, {}, run_id or uuid4())

    async def _status(self, number):
        async with self.pool.connection() as conn:
            cursor = await conn.execute("SELECT workflow_status, next_action FROM public.cyberark_safe_metadata WHERE safe_number = %s", (number,))
            return await cursor.fetchone()

    async def test_deleted_account_sets_retired_at_and_holds_only_the_open_decommission(self):
        first = [self._account(n, "a1") for n in (self.decom, self.ordinary, self.resolved)] + [self._account(self.untouched, "keep")]
        await self._sync(first)
        # the next complete run no longer lists the first three accounts, only the untouched Safe's account
        result = await self._sync([self._account(self.untouched, "keep")])
        self.assertEqual(result["retired_accounts"], 3)

        self.assertEqual((await self._status(self.decom))["workflow_status"], "retention_hold")
        self.assertEqual((await self._status(self.decom))["next_action"], "Dar de baja")
        self.assertEqual((await self._status(self.ordinary))["workflow_status"], "in_progress")
        self.assertEqual((await self._status(self.resolved))["workflow_status"], "resolved")
        self.assertEqual((await self._status(self.untouched))["workflow_status"], "pending")

        retired = await get_safe_accounts(self.pool, self.decom, "", 50, 0, "retired")
        self.assertEqual(retired["total"], 1)
        self.assertIsNotNone(retired["rows"][0]["retired_detected_at"])

        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT actor_id, before_data, after_data FROM public.access_audit_log WHERE entity_type = 'safe_metadata' AND entity_id = %s",
                (str(self.decom),),
            )
            audit = await cursor.fetchall()
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit[0]["actor_id"], "system:sync")
        self.assertEqual(audit[0]["before_data"], {"workflow_status": "in_progress"})
        self.assertEqual(audit[0]["after_data"]["workflow_status"], "retention_hold")

    async def test_retired_at_is_set_once_and_cleared_when_the_account_returns(self):
        account = self._account(self.decom, "a1")
        await self._sync([account])
        await self._sync([self._account(self.untouched, "keep")])
        async with self.pool.connection() as conn:
            cursor = await conn.execute("SELECT retired_at FROM public.cyberark_accounts WHERE safe_number = %s", (self.decom,))
            first = (await cursor.fetchone())["retired_at"]
        self.assertIsNotNone(first)
        # reclassifying the retired account must not move the detection date
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE public.cyberark_accounts SET inventory_account_type = 'nominal', updated_at = now() + interval '1 hour' WHERE safe_number = %s", (self.decom,))
            cursor = await conn.execute("SELECT retired_at FROM public.cyberark_accounts WHERE safe_number = %s", (self.decom,))
            self.assertEqual((await cursor.fetchone())["retired_at"], first)
        await self._sync([account])
        async with self.pool.connection() as conn:
            cursor = await conn.execute("SELECT lifecycle_status, retired_at FROM public.cyberark_accounts WHERE safe_number = %s", (self.decom,))
            row = await cursor.fetchone()
        self.assertEqual((row["lifecycle_status"], row["retired_at"]), ("active", None))
