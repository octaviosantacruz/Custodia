"""Execute CONN-001 matching and device aggregation SQL on opt-in test Postgres."""

import asyncio
import time
import unittest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from psycopg.types.json import Jsonb

from app.cross.services.person_client_coverage import (
    build_person_client_coverage,
    get_person_client_coverage,
    get_person_client_coverage_detail,
)
from app.cross.repositories.person_client_coverage import (
    get_person_client_coverage_snapshot,
)
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class PersonClientCoveragePostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tag = uuid4().hex
        self.identity_ids: list[str] = []
        self.netskope_ids: list[str] = []
        self.device_ids: list[str] = []
        self.run_ids: list[str] = []
        self.addAsyncCleanup(self._cleanup_fixture)
        await self._seed()

    async def _insert_run(self, source_system: str, source_file: str, status: str = "completed"):
        run_id = uuid4()
        self.run_ids.append(str(run_id))
        completed = datetime.now(timezone.utc)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.cyberark_ingestion_runs
                   (run_id, source_system, source_file, status, started_at, completed_at)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (run_id, source_system, source_file, status, completed - timedelta(minutes=1), completed),
            )
        return run_id

    async def _insert_object(self, source_system: str, object_type: str, source_id: str, attributes: dict):
        if source_system == "identity_administration":
            self.identity_ids.append(source_id)
        elif object_type == "device":
            self.device_ids.append(source_id)
        else:
            self.netskope_ids.append(source_id)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.cyberark_inventory_objects
                   (source_system, object_type, source_id, display_name, lifecycle_status, attributes)
                   VALUES (%s, %s, %s, %s, 'active', %s)""",
                (source_system, object_type, source_id, source_id, Jsonb(attributes)),
            )

    async def _seed_identity(self, suffix: str, email: str, *, active=True, service=False):
        await self._insert_object("identity_administration", "user", f"ia-{self.tag}-{suffix}", {
            "email": email, "active": active, "service_user": service,
        })

    async def _seed_netskope(self, suffix: str, email: str, *, source_id: str | None = None):
        await self._insert_object("netskope", "user", source_id or f"ns-{self.tag}-{suffix}", {"email": email})

    async def _seed_device(
        self, suffix: str, username: str, *, recent: bool,
        boundary: str | None = None, timestamp: str = "number", user_key: str | None = None,
    ):
        if boundary == "inside_7d":
            observed_at = int(time.time() - 7 * 24 * 60 * 60 + 120)
        elif boundary == "outside_7d":
            observed_at = int(time.time() - 7 * 24 * 60 * 60 - 120)
        else:
            observed_at = int(time.time()) if recent else int(time.time()) - 8 * 24 * 60 * 60
        attributes = {"username": username, "user_key": user_key or f"ignored-{self.tag}-{suffix}"}
        if timestamp == "number":
            attributes["last_event_timestamp"] = observed_at
        elif timestamp == "nonnumeric":
            attributes["last_event_timestamp"] = "not-a-number"
        await self._insert_object("netskope", "device", f"device-{self.tag}-{suffix}", attributes)

    async def _seed(self):
        await self._insert_run("identity_administration", "identity-administration-scim")
        await self._insert_run("netskope", "netskope-api")
        self.emails = {
            name: f"{name}-{self.tag}@example.test"
            for name in (
                "covered", "partial", "gap", "unmatched", "ambiguous", "dupidentity",
                "ambiguousdevice", "missingtime", "boundaryinside", "boundaryoutside",
            )
        }
        await self._seed_identity("covered", self.emails["covered"].upper())
        await self._seed_netskope("covered", self.emails["covered"], source_id=f"ns-{self.tag}-covered")
        await self._seed_device("covered-1", f"ns-{self.tag}-covered", recent=True)
        await self._seed_device("covered-2", self.emails["covered"], recent=True)

        await self._seed_identity("partial", self.emails["partial"])
        await self._seed_netskope("partial", self.emails["partial"])
        await self._seed_device("partial-recent", self.emails["partial"], recent=True)
        await self._seed_device("partial-stale", self.emails["partial"], recent=False)

        await self._seed_identity("gap", self.emails["gap"])
        await self._seed_netskope("gap", self.emails["gap"])
        await self._seed_device(
            "user-key-only", f"unmatched-{self.tag}", recent=True, user_key=self.emails["gap"],
        )

        await self._seed_identity("unmatched", self.emails["unmatched"])

        await self._seed_identity("ambiguous", self.emails["ambiguous"])
        await self._seed_netskope("ambiguous-1", self.emails["ambiguous"])
        await self._seed_netskope("ambiguous-2", self.emails["ambiguous"])

        await self._seed_identity("dupidentity-1", self.emails["dupidentity"])
        await self._seed_identity("dupidentity-2", self.emails["dupidentity"])
        await self._seed_netskope("dupidentity", self.emails["dupidentity"])
        await self._seed_device("dupidentity", self.emails["dupidentity"], recent=True)

        await self._seed_identity("ambiguousdevice", self.emails["ambiguousdevice"])
        shared_email_key = f"shared-{self.tag}@example.test"
        await self._seed_netskope("ambiguousdevice", self.emails["ambiguousdevice"], source_id=shared_email_key)
        await self._seed_netskope("ambiguousdevice-other", shared_email_key, source_id=f"ns-{self.tag}-other")
        await self._seed_device("ambiguous-user", shared_email_key, recent=True)

        await self._seed_identity("missingtime", self.emails["missingtime"])
        await self._seed_netskope("missingtime", self.emails["missingtime"])
        await self._seed_device("missing-timestamp", self.emails["missingtime"], recent=False, timestamp="missing")
        await self._seed_device("nonnumeric-timestamp", self.emails["missingtime"], recent=False, timestamp="nonnumeric")

        await self._seed_identity("boundaryinside", self.emails["boundaryinside"])
        await self._seed_netskope("boundaryinside", self.emails["boundaryinside"])
        await self._seed_device("inside-7d-edge", self.emails["boundaryinside"], recent=False, boundary="inside_7d")

        await self._seed_identity("boundaryoutside", self.emails["boundaryoutside"])
        await self._seed_netskope("boundaryoutside", self.emails["boundaryoutside"])
        await self._seed_device("outside-7d-edge", self.emails["boundaryoutside"], recent=False, boundary="outside_7d")

        await self._seed_identity("disabled", f"disabled-{self.tag}@example.test", active=False)
        await self._seed_identity("service", f"service-{self.tag}@example.test", service=True)
        await self._seed_identity("technical", f"service@cyberark.cloud.{self.tag}")

    async def _cleanup_fixture(self):
        async with self.pool.connection() as conn:
            await conn.execute(
                "DELETE FROM public.cyberark_inventory_objects WHERE source_id = ANY(%s)",
                (self.identity_ids + self.netskope_ids + self.device_ids,),
            )
            await conn.execute(
                "DELETE FROM public.cyberark_ingestion_runs WHERE run_id = ANY(%s::uuid[])",
                (self.run_ids,),
            )

    async def test_real_sql_classifies_exact_unique_links_and_excludes_ineligible_identity(self):
        snapshot = await get_person_client_coverage_snapshot(self.pool)
        all_rows = snapshot["rows"]
        fixture_rows = [row for row in all_rows if row["email"].endswith(f"-{self.tag}@example.test")]
        summary, _ = build_person_client_coverage(fixture_rows, snapshot["runs"])
        counts = summary["counts"]
        self.assertEqual(counts["denominator"], 11)
        self.assertEqual((counts["covered"], counts["partial"], counts["gap"], counts["unknown"]), (2, 1, 3, 5))
        self.assertEqual((counts["devices_recent"], counts["devices_total"]), (4, 8))
        self.assertEqual(summary["sources"]["identity"]["source_file"], "identity-administration-scim")
        self.assertEqual(summary["sources"]["netskope"]["source_file"], "netskope-api")

        covered = await get_person_client_coverage_detail(self.pool, email=self.emails["covered"])
        partial = await get_person_client_coverage_detail(self.pool, email=self.emails["partial"])
        gap = await get_person_client_coverage_detail(self.pool, email=self.emails["gap"])
        missing = await get_person_client_coverage_detail(self.pool, email=self.emails["unmatched"])
        ambiguous = await get_person_client_coverage_detail(self.pool, email=self.emails["ambiguous"])
        dup_identity = await get_person_client_coverage_detail(self.pool, email=self.emails["dupidentity"])
        ambiguous_device = await get_person_client_coverage_detail(self.pool, email=self.emails["ambiguousdevice"])
        missing_time = await get_person_client_coverage_detail(self.pool, email=self.emails["missingtime"])
        boundary_inside = await get_person_client_coverage_detail(self.pool, email=self.emails["boundaryinside"])
        boundary_outside = await get_person_client_coverage_detail(self.pool, email=self.emails["boundaryoutside"])
        excluded = await get_person_client_coverage_detail(self.pool, email=f"disabled-{self.tag}@example.test")

        self.assertEqual([covered["status"], partial["status"], gap["status"]], ["covered", "partial", "gap"])
        self.assertEqual((covered["devices_recent"], covered["devices_total"]), (2, 2))
        self.assertEqual((partial["devices_recent"], partial["devices_not_recent"]), (1, 1))
        self.assertEqual((gap["devices_recent"], gap["devices_total"]), (0, 0), "user_key alone must not attribute a device")
        self.assertEqual(missing["status"], "unknown", "Identity without Netskope must stay in the denominator as unknown")
        self.assertEqual(ambiguous["status"], "unknown")
        self.assertEqual(dup_identity["identity_records"], 2)
        self.assertEqual(dup_identity["status"], "unknown", "duplicate Identity emails must not merge into covered")
        self.assertEqual(ambiguous_device["status"], "unknown")
        self.assertEqual(ambiguous_device["devices_ambiguous"], 1)
        self.assertEqual(missing_time["status"], "gap")
        self.assertEqual((missing_time["devices_recent"], missing_time["devices_not_recent"]), (0, 2))
        self.assertEqual(boundary_inside["status"], "covered")
        self.assertEqual(boundary_outside["status"], "gap")
        self.assertEqual(excluded["status"], "not_applicable")

    async def test_coverage_at_inventory_scale_keeps_unique_people_and_device_counts(self):
        """Small fixtures miss the repeated per-person device aggregation."""
        prefix = f"coverage-perf-{self.tag}-"
        count = 8000
        identity_count = 64
        async with self.pool.connection() as conn:
            for source in ("identity_administration", "netskope"):
                population = identity_count if source == "identity_administration" else count
                ids = [f"{prefix}{source}-{n}" for n in range(1, population + 1)]
                (self.identity_ids if source == "identity_administration" else self.netskope_ids).extend(ids)
                await conn.execute("""
                    INSERT INTO public.cyberark_inventory_objects
                        (source_system, object_type, source_id, display_name, lifecycle_status, attributes)
                    SELECT %s, 'user', %s || n, 'Performance person', 'active',
                           jsonb_build_object('email', %s || n || '@example.test', 'active', true)
                    FROM generate_series(1, %s) AS n
                """, (source, f"{prefix}{source}-", prefix, population))
            self.device_ids.extend(f"{prefix}device-{n}" for n in range(1, count + 1))
            await conn.execute("""
                INSERT INTO public.cyberark_inventory_objects
                    (source_system, object_type, source_id, display_name, lifecycle_status, attributes)
                SELECT 'netskope', 'device', %s || n, 'Performance device', 'active',
                       jsonb_build_object('username', %s || n || '@example.test',
                                          'last_event_timestamp', extract(epoch FROM now())::bigint)
                FROM generate_series(1, %s) AS n
            """, (f"{prefix}device-", prefix, count))
            await conn.execute("ANALYZE public.cyberark_inventory_objects")

        snapshot = await asyncio.wait_for(get_person_client_coverage_snapshot(self.pool), timeout=4.0)
        rows = [row for row in snapshot["rows"] if row["email"].startswith(prefix)]
        self.assertEqual(len(rows), identity_count)
        self.assertTrue(all(row["identity_records"] == row["netskope_users"] == 1 for row in rows))
        self.assertTrue(all(row["devices_recent"] == 1 and row["devices_not_recent"] == 0 for row in rows))

    async def test_database_run_timestamps_obey_the_exact_24_hour_freshness_boundary(self):
        snapshot = await get_person_client_coverage_snapshot(self.pool)
        fixture_rows = [row for row in snapshot["rows"] if row["email"].endswith(f"-{self.tag}@example.test")]
        identity_completed = snapshot["runs"]["identity_administration"]["completed_at"]
        exact_boundary = identity_completed + timedelta(hours=24)
        summary, people = build_person_client_coverage(fixture_rows, snapshot["runs"], now=exact_boundary)
        self.assertEqual(summary["sources"]["identity"]["freshness"], "fresh")
        self.assertTrue(any(person["status"] != "unknown" for person in people))

        summary, people = build_person_client_coverage(
            fixture_rows, snapshot["runs"], now=exact_boundary + timedelta(seconds=1),
        )
        self.assertEqual(summary["sources"]["identity"]["freshness"], "stale")
        self.assertTrue(all(person["status"] == "unknown" for person in people))

    async def test_a_new_partial_run_overrides_an_older_fresh_complete_run(self):
        await self._insert_run("netskope", "netskope-api", status="partial")
        summary = await get_person_client_coverage(self.pool)
        self.assertEqual(summary["sources"]["netskope"]["freshness"], "incomplete")
        self.assertEqual(summary["counts"]["unknown"], summary["counts"]["denominator"])
        self.assertIsNone(summary["counts"]["coverage_percent"])


if __name__ == "__main__":
    unittest.main()
