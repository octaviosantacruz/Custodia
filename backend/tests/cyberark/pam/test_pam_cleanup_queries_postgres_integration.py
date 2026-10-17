"""PAM-GRP-001 query behavior against opt-in disposable PostgreSQL.

The shared base only accepts CUSTODIA_TEST_DATABASE_URL; it never falls back to
DATABASE_URL or reads repository secret files.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from psycopg.types.json import Jsonb

from app.cyberark.pam.repositories.pam_cleanup_queries import get_pam_cleanup_signals
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class PamCleanupQueriesPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tag = uuid4().hex[:10]
        self.object_ids: dict[str, int] = {}
        self.safe_numbers: list[int] = []
        self.account_ids: list[str] = []
        self.run_id = None
        self.addAsyncCleanup(self._cleanup_fixture)
        await self._seed_fixture()

    async def _insert_object(self, key: str, object_type: str, display_name: str, *, active=True, source_id=None) -> int:
        source_id = source_id or f"cleanup-{self.tag}-{key}"
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                """INSERT INTO public.cyberark_inventory_objects
                   (source_system, object_type, source_id, display_name, lifecycle_status, attributes)
                   VALUES ('cyberark', %s, %s, %s, %s, %s) RETURNING object_id""",
                (object_type, source_id, display_name, "active" if active else "retired", Jsonb({})),
            )
            row = await cursor.fetchone()
        self.object_ids[key] = row["object_id"]
        return row["object_id"]

    async def _insert_relation(self, source_key: str, target_key: str, relation_type: str, *, active=True):
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.cyberark_inventory_relationships
                   (source_object_id, target_object_id, relationship_type, lifecycle_status)
                   VALUES (%s, %s, %s, %s)""",
                (self.object_ids[source_key], self.object_ids[target_key], relation_type,
                 "active" if active else "retired"),
            )

    async def _insert_safe(self, key: str, display_name: str, scope: str, account_type: str | None = None) -> int:
        safe_number = 1_000_000_000 + int(self.tag[:7], 16) + len(self.safe_numbers)
        self.safe_numbers.append(safe_number)
        safe_url_id = f"cleanup-{self.tag}-{key}"
        async with self.pool.connection() as conn:
            if self.run_id is None:
                self.run_id = uuid4()
                await conn.execute(
                    """INSERT INTO public.cyberark_ingestion_runs
                       (run_id, source_system, source_file, status, started_at, completed_at)
                       VALUES (%s, 'cyberark', %s, 'completed', now(), now())""",
                    (self.run_id, f"cleanup-{self.tag}"),
                )
            await conn.execute(
                "INSERT INTO public.safes (safe_number, safe_name, safe_url_id, source_run_id) VALUES (%s, %s, %s, %s)",
                (safe_number, display_name, safe_url_id, self.run_id),
            )
            await conn.execute(
                """INSERT INTO public.cyberark_safe_metadata
                   (safe_number, inventory_scope, account_type_classification, classification_status)
                   VALUES (%s, %s, %s, %s)""",
                (safe_number, scope, account_type, "assigned" if scope != "pending" else "pending"),
            )
        await self._insert_object(key, "safe", display_name, source_id=str(safe_number))
        return safe_number

    async def _insert_account(self, safe_number: int, key: str, platform_id: str, lifecycle_status: str):
        account_id = f"cleanup-{self.tag}-{key}"
        self.account_ids.append(account_id)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.cyberark_accounts
                   (safe_number, account_id, account_name, platform_id, lifecycle_status)
                   VALUES (%s, %s, %s, %s, %s)""",
                (safe_number, account_id, account_id, platform_id, lifecycle_status),
            )

    async def _seed_fixture(self):
        await self._insert_object("user-identical", "user", f"user-identical-{self.tag}")
        await self._insert_object("user-nonidentical", "user", f"user-nonidentical-{self.tag}")
        await self._insert_object("user-redundant", "user", f"user-redundant-{self.tag}")

        await self._insert_object("empty", "role", f"empty-{self.tag}")
        await self._insert_object("factory-psm-master", "role", "PSMMaster", source_id=f"cleanup-{self.tag}-factory-1")
        await self._insert_object("factory-terminators", "role", "PSMLiveSessionTerminators", source_id=f"cleanup-{self.tag}-factory-2")
        await self._insert_object("retired-edge-only", "role", f"retired-edge-only-{self.tag}")
        await self._insert_relation("user-nonidentical", "retired-edge-only", "user_has_role", active=False)

        await self._insert_object("identical-a", "role", f"identical-a-{self.tag}")
        await self._insert_object("identical-b", "role", f"identical-b-{self.tag}")
        await self._insert_relation("user-identical", "identical-a", "user_has_role")
        await self._insert_relation("user-identical", "identical-b", "user_has_role")
        await self._insert_object("nonidentical", "role", f"nonidentical-{self.tag}")
        await self._insert_relation("user-nonidentical", "nonidentical", "user_has_role")

        await self._insert_object("redundant", "role", f"redundant-{self.tag}")
        await self._insert_object("access-peer", "role", f"access-peer-{self.tag}")
        await self._insert_relation("user-redundant", "redundant", "user_has_role")
        await self._insert_relation("user-redundant", "access-peer", "user_has_role")

        internal_number = await self._insert_safe("internal-safe", f"internal-safe-{self.tag}", "internal", "internal")
        pending_number = await self._insert_safe("pending-safe", f"pending-safe-{self.tag}", "pending")
        accessed_number = await self._insert_safe("accessed-safe", f"accessed-safe-{self.tag}", "business", "nominal")
        await self._insert_relation("access-peer", "accessed-safe", "role_grants_access")
        self.assertTrue(internal_number and pending_number and accessed_number)

        self.platform_account_source = f"cleanup-{self.tag}-platform-account"
        self.platform_empty_source = f"cleanup-{self.tag}-platform-empty"
        self.platform_retired_account_source = f"cleanup-{self.tag}-platform-retired-account"
        await self._insert_object("platform-account", "platform", f"platform-account-{self.tag}", source_id=self.platform_account_source)
        await self._insert_object("platform-empty", "platform", f"platform-empty-{self.tag}", source_id=self.platform_empty_source)
        await self._insert_object("platform-retired-account", "platform", f"platform-retired-account-{self.tag}", source_id=self.platform_retired_account_source)
        await self._insert_object("psm-linked", "psm", f"psm-linked-{self.tag}")
        await self._insert_object("psm-orphan", "psm", f"psm-orphan-{self.tag}")
        await self._insert_relation("platform-account", "psm-linked", "platform_uses_psm")

        await self._insert_account(accessed_number, "active-account", self.platform_account_source, "active")
        await self._insert_account(accessed_number, "retired-account", self.platform_retired_account_source, "retired")

    async def _cleanup_fixture(self):
        async with self.pool.connection() as conn:
            object_ids = list(self.object_ids.values())
            await conn.execute(
                """DELETE FROM public.cyberark_inventory_relationships
                   WHERE source_object_id = ANY(%s) OR target_object_id = ANY(%s)""",
                (object_ids, object_ids),
            )
            if self.account_ids:
                await conn.execute(
                    "DELETE FROM public.cyberark_accounts WHERE account_id = ANY(%s)",
                    (self.account_ids,),
                )
            if self.safe_numbers:
                await conn.execute(
                    "DELETE FROM public.cyberark_safe_metadata WHERE safe_number = ANY(%s)",
                    (self.safe_numbers,),
                )
                await conn.execute(
                    "DELETE FROM public.safes WHERE safe_number = ANY(%s)",
                    (self.safe_numbers,),
                )
            if object_ids:
                await conn.execute(
                    "DELETE FROM public.cyberark_inventory_objects WHERE object_id = ANY(%s)",
                    (object_ids,),
                )
            if self.run_id is not None:
                await conn.execute(
                    "DELETE FROM public.cyberark_ingestion_runs WHERE run_id = %s",
                    (self.run_id,),
                )

    async def test_cleanup_signals_use_active_memberships_and_keep_distinct_cases(self):
        signals = await get_pam_cleanup_signals(self.pool)
        self.assertEqual(set(signals), {
            "empty_groups", "identical_member_groups", "redundant_groups_with_access_peer",
            "orphan_psm", "platforms_without_accounts", "safes_without_active_users",
        })
        self.assertEqual(len({signal["computed_at"] for signal in signals.values()}), 1)

        empty_ids = {item["object_id"] for item in signals["empty_groups"]["items"]}
        self.assertTrue({self.object_ids[key] for key in (
            "empty", "factory-psm-master", "factory-terminators", "retired-edge-only",
        )}.issubset(empty_ids))
        identical = {item["object_id"]: item for item in signals["identical_member_groups"]["items"]}
        self.assertTrue({self.object_ids["identical-a"], self.object_ids["identical-b"],
                         self.object_ids["redundant"], self.object_ids["access-peer"]}.issubset(identical))
        self.assertNotIn(self.object_ids["empty"], identical, "empty member sets must not match one another")
        self.assertNotIn(self.object_ids["nonidentical"], identical)

        redundant = {item["object_id"]: item for item in signals["redundant_groups_with_access_peer"]["items"]}
        redundant_item = redundant[self.object_ids["redundant"]]
        self.assertEqual([peer["object_id"] for peer in redundant_item["peer_groups"]], [self.object_ids["access-peer"]])
        self.assertEqual(redundant_item["safe_count"], 0)

        psm_ids = {item["object_id"] for item in signals["orphan_psm"]["items"]}
        self.assertIn(self.object_ids["psm-orphan"], psm_ids)
        self.assertNotIn(self.object_ids["psm-linked"], psm_ids)

        platform_ids = {item["object_id"] for item in signals["platforms_without_accounts"]["items"]}
        self.assertIn(self.object_ids["platform-empty"], platform_ids)
        self.assertIn(self.object_ids["platform-retired-account"], platform_ids)
        self.assertNotIn(self.object_ids["platform-account"], platform_ids)

        safe_items = {item["object_id"]: item for item in signals["safes_without_active_users"]["items"]}
        internal = safe_items[self.object_ids["internal-safe"]]
        pending = safe_items[self.object_ids["pending-safe"]]
        self.assertEqual(internal["inventory_scope"], "internal")
        self.assertEqual(internal["account_type_classification"], "internal")
        self.assertEqual(pending["inventory_scope"], "pending")
        self.assertEqual(pending["classification_status"], "pending")
        self.assertNotIn(self.object_ids["accessed-safe"], safe_items)

        factory_items = {item["object_id"]: item for item in signals["empty_groups"]["items"]}
        self.assertEqual(factory_items[self.object_ids["factory-psm-master"]]["factory_label"],
                         "Grupo de fábrica CyberArk · PSM")
        self.assertTrue(factory_items[self.object_ids["factory-psm-master"]]["is_factory"])
        self.assertIn("no se sugiere su baja automática", factory_items[self.object_ids["factory-psm-master"]]["reason"])
        self.assertEqual(factory_items[self.object_ids["factory-terminators"]]["factory_label"],
                         "Grupo de fábrica CyberArk · terminadores de sesión")


class PamCleanupRunEvidencePostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.run_ids = []
        self.base_time = datetime(2030, 1, 1, tzinfo=timezone.utc)
        self.addAsyncCleanup(self._remove_runs)

    async def _remove_runs(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.cyberark_ingestion_runs WHERE run_id = ANY(%s)", (self.run_ids,))

    async def _run(self, offset, *, source="cyberark", job="cyberark-api", status="completed",
                   pam_synced=True, options=None):
        run_id = uuid4()
        self.run_ids.append(run_id)
        at = self.base_time + timedelta(hours=offset)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.cyberark_ingestion_runs
                   (run_id, source_system, source_file, status, enqueued_at, started_at, completed_at,
                    pam_synced, run_options)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (run_id, source, job, status, at, at,
                 at if status in {"completed", "partial", "failed"} else None,
                 pam_synced, Jsonb(options or {})),
            )
        return str(run_id)

    async def test_run_families_exclude_unrelated_jobs_and_keep_catalog_separate_from_relationships(self):
        pam = await self._run(1)
        psm = await self._run(2, job="cyberark-psm-api", pam_synced=False, options={"psm_only": True})
        await self._run(3, source="sia", job="sia-api")
        await self._run(4, job="unrelated-import")
        await self._run(5, options={"psm_only": True})
        result = await get_pam_cleanup_signals(self.pool)
        for key, signal in result.items():
            self.assertEqual(signal["inventory_runs"][0]["latest_attempt"]["run_id"], pam)
            self.assertEqual(len(signal["inventory_runs"]), 2 if key == "orphan_psm" else 1)
        catalog = result["orphan_psm"]["inventory_runs"][1]
        self.assertEqual(catalog["latest_attempt"]["run_id"], psm)
        self.assertEqual(catalog["last_completed_inventory"]["run_id"], psm)

    async def test_later_incomplete_attempts_do_not_hide_past_inventory_completion(self):
        completed = await self._run(1)
        for offset, status in enumerate(["failed", "partial", "running", "queued", "completed"], start=2):
            with self.subTest(status=status):
                latest = await self._run(offset, status=status, pam_synced=False, options={"max_safes": 1})
                result = await get_pam_cleanup_signals(self.pool)
                evidence = result["empty_groups"]["inventory_runs"][0]
                self.assertEqual(evidence["latest_attempt"]["run_id"], latest)
                self.assertEqual(evidence["latest_attempt"]["status"], status)
                self.assertFalse(evidence["latest_attempt"]["inventory_refreshed"])
                self.assertEqual(evidence["last_completed_inventory"]["run_id"], completed)

    async def test_empty_inventory_and_missing_history_do_not_create_completion_evidence(self):
        result = await get_pam_cleanup_signals(self.pool)
        # This disposable database has no production runs; other cleanup fixtures
        # use unrelated job names and cannot establish ingestion evidence.
        for signal in result.values():
            self.assertEqual(signal["count"], 0)
            self.assertEqual(signal["denominator"], 0)
            for evidence in signal["inventory_runs"]:
                self.assertIsNone(evidence["latest_attempt"])
                self.assertIsNone(evidence["last_completed_inventory"])
        failed = await self._run(1, status="failed", pam_synced=True)
        result = await get_pam_cleanup_signals(self.pool)
        evidence = result["empty_groups"]["inventory_runs"][0]
        self.assertEqual(evidence["latest_attempt"]["run_id"], failed)
        self.assertFalse(evidence["latest_attempt"]["inventory_refreshed"])
        self.assertIsNone(evidence["last_completed_inventory"])


if __name__ == "__main__":
    import unittest

    unittest.main()
