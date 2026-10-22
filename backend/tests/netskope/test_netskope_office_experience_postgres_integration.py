"""NSK-EXP-OFFICE-001 on real PostgreSQL: office/remote spans come from the presence days the sync
records, only office-goers are measured, a day is replaced and marked atomically, and migration 109
fills the spans from the snapshots. Opt-in; see tests/support/pg_integration_base.py."""

import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from app.netskope.sse.repositories.netskope_mutations import record_device_snapshots
from app.netskope.sse.repositories.netskope_office_experience import (
    RETENTION_DAYS, latest_office_run, measured_office_days, person_office_rows, person_presence_days, office_experience_rows, office_spans_for_day, pending_office_days,
    office_person_identity, office_timeline_companies, office_timeline_days, replace_office_experience_day,
)
from tests.support.netskope_pg_fixtures import (
    insert_netskope_run, reset_netskope, reset_netskope_runs, seed_device, seed_netskope_user,
)
from tests.support.pg_integration_base import PostgresIntegrationTestCase

MIGRATION = Path(os.getenv("MIGRATIONS_DIR", Path(__file__).resolve().parents[3] / "migrations")) / "109_netskope_office_experience.sql"


async def reset_office(pool) -> None:
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM public.netskope_office_experience_days")
        await conn.execute("DELETE FROM public.netskope_office_experience_measured")


class NetskopeOfficeExperiencePostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        await reset_office(self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)
        self.addAsyncCleanup(reset_office, self.pool)
        self.addAsyncCleanup(reset_netskope_runs, self.pool)
        self.day = datetime.now(timezone.utc).date() - timedelta(days=2)
        self.base = datetime.combine(self.day, datetime.min.time(), timezone.utc)

    async def sync(self, *devices):
        """One inventory sync run; each device is (source_id, status, hours after the day's midnight)."""
        await record_device_snapshots(self.pool, await insert_netskope_run(self.pool), [
            {"source_id": source_id, "attributes": {"onprem_status": status, "last_event_timestamp": (self.base + timedelta(hours=hours)).timestamp()}}
            for source_id, status, hours in devices
        ])

    async def test_spans_widen_across_runs_and_only_office_goers_are_measured(self):
        await seed_device(self.pool, "laptop", {"username": "Ana@Acme.test"})
        await seed_device(self.pool, "phone", {"username": "ana@acme.test"})
        await seed_device(self.pool, "home", {"username": "home@acme.test"})
        await seed_device(self.pool, "gone", {"username": "gone@acme.test"}, lifecycle_status="retired")
        # Ana: office 09–17 across two devices and runs, remote 19–21; home@ never went to the office.
        await self.sync(("laptop", "on-prem", 9), ("home", "off-prem", 10), ("gone", "on-prem", 9))
        await self.sync(("laptop", "on-prem", 12), ("phone", "on-prem", 17), ("home", "off-prem", 15))
        await self.sync(("laptop", "off-prem", 19))
        await self.sync(("laptop", "off-prem", 21), ("gone", "on-prem", 12))
        spans = await office_spans_for_day(self.pool, self.day)
        self.assertEqual(
            [(row["email"], row["onprem_status"], row["first_event_at"], row["last_event_at"]) for row in spans],
            [("ana@acme.test", "off-prem", self.base + timedelta(hours=19), self.base + timedelta(hours=21)),
             ("ana@acme.test", "on-prem", self.base + timedelta(hours=9), self.base + timedelta(hours=17))],
        )

    async def test_a_day_is_replaced_and_marked_in_one_step_and_names_come_from_one_exact_user(self):
        await seed_netskope_user(self.pool, "u1", "Ana Pérez", "ana@acme.test", extra={"company": "ACME"})
        run = await insert_netskope_run(self.pool)
        first = [{"email": "ana@acme.test", "office_minutes": 480, "office_score": 22.5, "remote_minutes": 0, "remote_score": None},
                 {"email": "bob@acme.test", "office_minutes": 60, "office_score": None, "remote_minutes": 120, "remote_score": 90}]
        await replace_office_experience_day(self.pool, run, self.day, first, 1)
        await replace_office_experience_day(self.pool, run, self.day, first[:1], 0)
        rows = await office_experience_rows(self.pool, self.day, self.day)
        self.assertEqual([(row["email"], float(row["office_score"]), row["name"], row["company"]) for row in rows],
                         [("ana@acme.test", 22.5, "Ana Pérez", "ACME")])
        [marker] = await measured_office_days(self.pool, self.day, self.day)
        self.assertEqual((marker["people"], marker["failed_calls"]), (1, 0))
        pending = await pending_office_days(self.pool, self.day - timedelta(days=1), self.day + timedelta(days=1))
        self.assertEqual(pending, [self.day - timedelta(days=1), self.day + timedelta(days=1)])

    async def test_person_presence_and_rows_come_from_that_person_only(self):
        await seed_device(self.pool, "laptop", {"username": "Ana@Acme.test"})
        await seed_device(self.pool, "other", {"username": "bob@acme.test"})
        await self.sync(("laptop", "on-prem", 9), ("other", "off-prem", 9))
        await self.sync(("laptop", "off-prem", 20))
        presence = await person_presence_days(self.pool, "ana@acme.test", self.day, self.day)
        self.assertEqual([(row["event_day"], row["office"], row["remote"]) for row in presence], [(self.day, True, True)])
        self.assertEqual(await person_presence_days(self.pool, "nadie@acme.test", self.day, self.day), [])
        run = await insert_netskope_run(self.pool)
        await replace_office_experience_day(self.pool, run, self.day, [
            {"email": "ana@acme.test", "office_minutes": 600, "office_score": 70, "remote_minutes": 0, "remote_score": None},
            {"email": "bob@acme.test", "office_minutes": 60, "office_score": 10, "remote_minutes": 0, "remote_score": None},
        ], 0)
        rows = await person_office_rows(self.pool, "ana@acme.test", self.day, self.day)
        self.assertEqual([(row["office_minutes"], float(row["office_score"])) for row in rows], [(600, 70.0)])

    async def test_timeline_averages_per_person_by_company_and_names_one_exact_user(self):
        """NSK-EXP-OFFICE-002: everyone weighs the same (not by minutes); company comes from one exact active user."""
        await seed_netskope_user(self.pool, "u1", "Ana Pérez", "ana@acme.test", extra={"company": "ACME"})
        await seed_netskope_user(self.pool, "u2", "Bob", "bob@acme.test", extra={"company": "ACME"})
        run = await insert_netskope_run(self.pool)
        await replace_office_experience_day(self.pool, run, self.day, [
            {"email": "ana@acme.test", "office_minutes": 600, "office_score": 90, "remote_minutes": 0, "remote_score": None},
            {"email": "bob@acme.test", "office_minutes": 30, "office_score": 50, "remote_minutes": 120, "remote_score": 80},
            {"email": "zoe@other.test", "office_minutes": 60, "office_score": 20, "remote_minutes": 0, "remote_score": None},
        ], 0)
        [everyone] = await office_timeline_days(self.pool, self.day, self.day, None, "Sin empresa")
        self.assertEqual((everyone["office_avg"], everyone["office_people"], everyone["remote_avg"], everyone["remote_people"]), (160 / 3, 3, 80.0, 1))
        [acme] = await office_timeline_days(self.pool, self.day, self.day, "ACME", "Sin empresa")
        self.assertEqual((acme["office_avg"], acme["office_people"]), (70.0, 2))
        [none] = await office_timeline_days(self.pool, self.day, self.day, "Sin empresa", "Sin empresa")
        self.assertEqual((none["office_avg"], none["office_people"]), (20.0, 1))
        self.assertEqual(await office_timeline_days(self.pool, self.day, self.day, "NADIE", "Sin empresa"), [])
        companies = await office_timeline_companies(self.pool, self.day, self.day, "Sin empresa")
        self.assertEqual([(row["company"], row["people"]) for row in companies], [("ACME", 2), ("Sin empresa", 1)])
        self.assertEqual(await office_person_identity(self.pool, "ana@acme.test"), {"name": "Ana Pérez", "company": "ACME"})
        self.assertIsNone(await office_person_identity(self.pool, "zoe@other.test"))

    async def test_latest_run_is_the_newest_office_task_run(self):
        self.assertIsNone(await latest_office_run(self.pool))
        async with self.pool.connection() as conn:
            for status, minutes_ago in (("completed", 300), ("running", 5)):
                await conn.execute(
                    """INSERT INTO public.cyberark_ingestion_runs (run_id, status, source_system, task_key, started_at, triggered_by)
                       VALUES (gen_random_uuid(), %s, 'netskope', 'netskope_office_experience', now() - make_interval(mins => %s), 'test-suite')""",
                    (status, minutes_ago),
                )
        self.assertEqual((await latest_office_run(self.pool))["status"], "running")

    async def test_expired_days_are_purged_when_a_new_day_is_stored(self):
        run = await insert_netskope_run(self.pool)
        row = [{"email": "ana@acme.test", "office_minutes": 60, "office_score": 80, "remote_minutes": 0, "remote_score": None}]
        await replace_office_experience_day(self.pool, run, self.day - timedelta(days=RETENTION_DAYS + 1), row, 0)
        await replace_office_experience_day(self.pool, run, self.day - timedelta(days=RETENTION_DAYS), row, 0)
        await replace_office_experience_day(self.pool, run, self.day, row, 0)
        days = [marker["event_day"] for marker in await measured_office_days(self.pool, date(2000, 1, 1), self.day)]
        self.assertEqual(days, [self.day - timedelta(days=RETENTION_DAYS), self.day])

    async def test_migration_fills_spans_and_missing_days_from_the_snapshots_and_can_run_again(self):
        # Three syncs of one device: office events at 09:00 and 16:00, then an unclassified one.
        for status, hours in (("on-prem", 9), ("on-prem", 16), ("Unknown", 18)):
            captured = self.base + timedelta(hours=hours)
            async with self.pool.connection() as conn:
                await conn.execute(
                    """INSERT INTO public.netskope_device_snapshots (source_run_id, device_id, captured_at, attributes)
                       VALUES (%s, 'd1', %s, jsonb_build_object('onprem_status', %s::text, 'last_event_timestamp', %s::numeric))""",
                    (await insert_netskope_run(self.pool), captured, status, captured.timestamp()),
                )
        sql = MIGRATION.read_text(encoding="utf-8")
        async with self.pool.connection() as conn:
            await conn.execute(sql)
            await conn.execute(sql)
            cursor = await conn.execute("SELECT device_id, event_day, onprem_status, first_event_at, last_event_at FROM public.netskope_device_presence_days")
            rows = await cursor.fetchall()
        self.assertEqual([(row["device_id"], row["event_day"], row["onprem_status"], row["first_event_at"], row["last_event_at"]) for row in rows],
                         [("d1", self.day, "on-prem", self.base + timedelta(hours=9), self.base + timedelta(hours=16))])
