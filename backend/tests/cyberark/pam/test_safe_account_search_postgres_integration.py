from uuid import uuid4

from app.cyberark.pam.repositories.safe_queries import export_safes, list_safes
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class SafeAccountSearchPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.run_id = uuid4()
        self.safe_numbers: list[int] = []
        self.account_ids: list[str] = []
        self.addAsyncCleanup(self._cleanup_fixture)
        await self._seed_fixture()

    async def _seed_fixture(self):
        self.safe_numbers = [1_000_000_000 + int(uuid4().hex[:7], 16) for _ in range(2)]
        active_safe, retired_match_safe = self.safe_numbers
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.cyberark_ingestion_runs
                   (run_id, source_system, source_file, status, started_at, completed_at)
                   VALUES (%s, 'cyberark', %s, 'completed', now(), now())""",
                (self.run_id, f"safe-account-search-{self.run_id}"),
            )
            await conn.execute(
                """INSERT INTO public.safes
                   (safe_number, safe_name, safe_url_id, source_run_id, lifecycle_status)
                   VALUES (%s, %s, %s, %s, 'active'), (%s, %s, %s, %s, 'active')""",
                (active_safe, f"safe-search-{self.run_id}", f"search-{self.run_id}", self.run_id,
                 retired_match_safe, f"safe-retired-match-{self.run_id}", f"retired-{self.run_id}", self.run_id),
            )
            accounts = [
                (active_safe, f"active-{self.run_id}-name", f"needle-name-{self.run_id}", "ordinary-user", "ordinary-address", "active"),
                (active_safe, f"active-{self.run_id}-user", "ordinary-account", f"needle-user-{self.run_id}", "ordinary-address", "active"),
                (active_safe, f"active-{self.run_id}-address", "ordinary-account", "ordinary-user", f"needle-address-{self.run_id}", "active"),
                (active_safe, f"active-{self.run_id}-platform", "ordinary-account", "ordinary-user", "ordinary-address", "active"),
                (retired_match_safe, f"retired-{self.run_id}", f"needle-retired-{self.run_id}", "ordinary-user", "ordinary-address", "retired"),
            ]
            platforms = [None, None, None, f"needle-platform-{self.run_id}", None]
            self.account_ids = [row[1] for row in accounts]
            cursor = conn.cursor()
            await cursor.executemany(
                """INSERT INTO public.cyberark_accounts
                   (safe_number, account_id, account_name, user_name, address, lifecycle_status, platform_name)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                [(*row, platform) for row, platform in zip(accounts, platforms, strict=True)],
            )

    async def _cleanup_fixture(self):
        async with self.pool.connection() as conn:
            if self.account_ids:
                await conn.execute("DELETE FROM public.cyberark_accounts WHERE account_id = ANY(%s)", (self.account_ids,))
            if self.safe_numbers:
                await conn.execute("DELETE FROM public.safes WHERE safe_number = ANY(%s)", (self.safe_numbers,))
            await conn.execute("DELETE FROM public.cyberark_ingestion_runs WHERE run_id = %s", (self.run_id,))

    async def _list(self, query: str, include_accounts: bool):
        return await list_safes(
            self.pool, query, 50, 0, "", "", "", "", "", "", include_accounts=include_accounts,
        )

    async def test_active_account_name_username_address_and_platform_match_list_total_and_export(self):
        active_safe = self.safe_numbers[0]
        for field in ("name", "user", "address", "platform"):
            query = f"needle-{field}-{self.run_id}"
            listed = await self._list(query, include_accounts=True)
            exported = await export_safes(
                self.pool, query, "", "", "", "", "", "", include_accounts=True,
            )
            self.assertEqual([row["safe_number"] for row in listed["rows"]], [active_safe])
            self.assertEqual(listed["total"], 1)
            self.assertEqual([row["safe_number"] for row in exported], [active_safe])

    async def test_retired_account_does_not_match_and_default_false_preserves_safe_only_search(self):
        retired_query = f"needle-retired-{self.run_id}"
        self.assertEqual((await self._list(retired_query, include_accounts=True))["total"], 0)

        active_account_query = f"needle-name-{self.run_id}"
        self.assertEqual((await self._list(active_account_query, include_accounts=False))["total"], 0)

        safe_name_query = f"safe-search-{self.run_id}"
        default_result = await self._list(safe_name_query, include_accounts=False)
        enabled_result = await self._list(safe_name_query, include_accounts=True)
        self.assertEqual(default_result["total"], enabled_result["total"])
        self.assertEqual([row["safe_number"] for row in default_result["rows"]], [row["safe_number"] for row in enabled_result["rows"]])

    async def test_classification_counts_cover_the_whole_result_not_the_page(self):
        query = str(self.run_id)
        full = await list_safes(self.pool, query, 50, 0, "", "", "", "", "", "")
        one_row = await list_safes(self.pool, query, 1, 0, "", "", "", "", "", "")
        past_end = await list_safes(self.pool, query, 1, 5, "", "", "", "", "", "")
        self.assertEqual(full["total"], 2)
        self.assertEqual(len(one_row["rows"]), 1)
        self.assertEqual(one_row["classification_counts"], full["classification_counts"])
        self.assertEqual(sum(full["classification_counts"].values()), full["total"])
        self.assertEqual(set(full["classification_counts"]), {"assigned", "review", "pending"})
        for row in one_row["rows"]:
            self.assertNotIn("assigned_count", row)
            self.assertNotIn("pending_count", row)
        self.assertEqual(past_end["rows"], [])

    async def test_classification_counts_ignore_the_classification_filter(self):
        query = str(self.run_id)
        unfiltered = await list_safes(self.pool, query, 50, 0, "", "", "", "", "", "")
        for status in ("pending", "assigned", "review"):
            filtered = await list_safes(self.pool, query, 50, 0, "", status, "", "", "", "")
            self.assertEqual(filtered["classification_counts"], unfiltered["classification_counts"])
            self.assertEqual(filtered["total"], unfiltered["classification_counts"][status])
