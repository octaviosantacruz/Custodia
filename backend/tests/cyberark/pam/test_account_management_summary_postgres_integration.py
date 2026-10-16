from datetime import datetime, timedelta, timezone
from uuid import uuid4

from psycopg.types.json import Jsonb

from app.cyberark.pam.repositories.account_queries import get_account_management_summary
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class AccountManagementSummaryPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.run_id = uuid4()
        self.safe_numbers: list[int] = []
        self.account_ids: list[str] = []
        self.addAsyncCleanup(self._cleanup_fixture)
        await self._seed_fixture()

    async def _insert_safe(self, key: str, lifecycle_status: str = "active", inventory_scope: str = "business") -> int:
        safe_number = 1_000_000_000 + int(uuid4().hex[:7], 16)
        self.safe_numbers.append(safe_number)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.safes
                   (safe_number, safe_name, safe_url_id, source_run_id, lifecycle_status)
                   VALUES (%s, %s, %s, %s, %s)""",
                (safe_number, f"CPM summary {key}", f"cpm-summary-{self.run_id}-{key}", self.run_id, lifecycle_status),
            )
            await conn.execute(
                """INSERT INTO public.cyberark_safe_metadata
                   (safe_number, inventory_scope, account_type_classification)
                   VALUES (%s, %s, %s)""",
                (safe_number, inventory_scope, "internal" if inventory_scope == "internal" else None),
            )
        return safe_number

    async def _insert_account(self, safe_number: int, key: str, attributes: dict, lifecycle_status: str = "active"):
        account_id = f"cpm-summary-{self.run_id}-{key}"
        self.account_ids.append(account_id)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.cyberark_accounts
                   (safe_number, account_id, account_name, lifecycle_status, attributes)
                   VALUES (%s, %s, %s, %s, %s)""",
                (safe_number, account_id, account_id, lifecycle_status, Jsonb(attributes)),
            )

    async def _seed_fixture(self):
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.cyberark_ingestion_runs
                   (run_id, source_system, source_file, status, started_at, completed_at)
                   VALUES (%s, 'cyberark', %s, 'completed', now(), now())""",
                (self.run_id, f"cpm-summary-{self.run_id}"),
            )
        active_safe = await self._insert_safe("active")
        retired_safe = await self._insert_safe("retired", lifecycle_status="retired")
        internal_safe = await self._insert_safe("internal", inventory_scope="internal")
        now = datetime.now(timezone.utc)
        samples = [
            ("30d", {"automatic_management_enabled": True, "management_status": "success", "secret_modified_at": (now - timedelta(days=10)).isoformat()}),
            ("90d", {"automatic_management_enabled": False, "management_status": "failure", "secret_modified_at": (now - timedelta(days=60)).isoformat()}),
            ("365d", {"automatic_management_enabled": None, "management_status": "in_process", "secret_modified_at": (now - timedelta(days=200)).isoformat()}),
            ("older", {"management_status": "future-state", "secret_modified_at": (now - timedelta(days=400)).isoformat()}),
            ("missing", {"automatic_management_enabled": True}),
            ("invalid", {"automatic_management_enabled": False, "management_status": "success", "secret_modified_at": "not-a-timestamp"}),
        ]
        for key, attributes in samples:
            await self._insert_account(active_safe, key, attributes)
        await self._insert_account(active_safe, "retired-account", {"secret_modified_at": (now - timedelta(days=2)).isoformat()}, "retired")
        await self._insert_account(retired_safe, "retired-safe-account", {"secret_modified_at": (now - timedelta(days=2)).isoformat()})
        await self._insert_account(internal_safe, "internal-account", {"automatic_management_enabled": True, "secret_modified_at": (now - timedelta(days=2)).isoformat()})

    async def _cleanup_fixture(self):
        async with self.pool.connection() as conn:
            if self.account_ids:
                await conn.execute("DELETE FROM public.cyberark_accounts WHERE account_id = ANY(%s)", (self.account_ids,))
            if self.safe_numbers:
                await conn.execute("DELETE FROM public.cyberark_safe_metadata WHERE safe_number = ANY(%s)", (self.safe_numbers,))
                await conn.execute("DELETE FROM public.safes WHERE safe_number = ANY(%s)", (self.safe_numbers,))
            await conn.execute("DELETE FROM public.cyberark_ingestion_runs WHERE run_id = %s", (self.run_id,))

    async def test_summary_uses_active_scope_and_exclusive_age_buckets(self):
        result = (await get_account_management_summary(self.pool, include_internal=False))[0]

        self.assertEqual(result["accounts_active"], 6)
        self.assertEqual(result["automatic_enabled"], 2)
        self.assertEqual(result["automatic_disabled"], 2)
        self.assertEqual(result["management_unknown"], 2)
        self.assertEqual(result["status_success"], 2)
        self.assertEqual(result["status_failure"], 1)
        self.assertEqual(result["status_in_process"], 1)
        self.assertEqual(result["status_unknown"], 2)
        age_buckets = (
            result["changed_30d"], result["changed_90d"], result["changed_365d"],
            result["changed_older"], result["changed_unknown"],
        )
        self.assertEqual(age_buckets, (1, 1, 1, 1, 2))
        self.assertEqual(sum(age_buckets), result["accounts_active"])

        including_internal = (await get_account_management_summary(self.pool, include_internal=True))[0]
        self.assertEqual(including_internal["accounts_active"], 7)
