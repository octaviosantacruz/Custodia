"""AUD-PERF-001: ingest_entry's member upsert moved from one execute() per
member to a single executemany(returning=True) call. A fake cursor can't
prove the RETURNING/nextset() pairing stays aligned with `members` order
against real PostgreSQL, so this exercises it end to end. Opt-in only; see
tests/support/pg_integration_base.py."""

from uuid import UUID, uuid4

from app.cross.repositories.sync_queue import enqueue_sync_run
from app.cyberark.pam.services.ingestion_persistence import ingest_entry
from tests.support.pg_integration_base import PostgresIntegrationTestCase

TEST_SAFE_NUMBER = 900_000_001


def _entry(member_count: int) -> dict:
    return {
        "safeName": "PERF-TEST-SAFE",
        "safeData": {
            "safeNumber": TEST_SAFE_NUMBER, "safeName": "PERF-TEST-SAFE", "safeUrlId": "PERF-TEST-SAFE",
            "location": "\\", "creator": {"id": "u", "name": "User"}, "olacEnabled": False,
            "numberOfVersionsRetention": 5, "numberOfDaysRetention": 7, "autoPurgeEnabled": False,
            "creationTime": 1_700_000_000, "lastModificationTime": 1_700_000_001,
            "description": None, "managingCPM": None, "isExpiredMember": False,
        },
        "members": [
            {
                "safeNumber": TEST_SAFE_NUMBER, "memberId": f"perf-test-member-{i}", "memberName": f"Member {i}",
                "memberType": "User", "membershipExpirationDate": None,
                "isExpiredMembershipEnable": False, "isPredefinedUser": False,
                "isReadOnly": False, "permissions": {"read": True},
            }
            for i in range(member_count)
        ],
    }


class IngestionPersistenceBatchingPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self._cleanup()

    async def asyncTearDown(self):
        await self._cleanup()

    async def _cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.safe_members WHERE safe_number = %s", (TEST_SAFE_NUMBER,))
            await conn.execute(
                "DELETE FROM public.cyberark_inventory_objects WHERE object_type = 'safe' AND source_id = %s",
                (str(TEST_SAFE_NUMBER),),
            )
            await conn.execute("DELETE FROM public.cyberark_safe_metadata WHERE safe_number = %s", (TEST_SAFE_NUMBER,))
            await conn.execute("DELETE FROM public.safes WHERE safe_number = %s", (TEST_SAFE_NUMBER,))
            await conn.execute(
                """
                DELETE FROM public.raw_safe_members_dump
                WHERE source_run_id IN (SELECT run_id FROM public.cyberark_ingestion_runs WHERE triggered_by = 'perf-test')
                """
            )
            await conn.execute("DELETE FROM public.cyberark_ingestion_runs WHERE triggered_by = 'perf-test'")
            await conn.commit()

    async def _enqueued_run_id(self) -> UUID:
        run_id = uuid4()
        await enqueue_sync_run(
            self.pool, run_id, source_system="cyberark", source_file="perf-test.csv",
            triggered_by="perf-test", options={},
        )
        return run_id

    async def test_first_run_inserts_every_member_with_correct_counts(self):
        run_id = await self._enqueued_run_id()
        result = await ingest_entry(self.pool, run_id, _entry(6), index=0)

        self.assertEqual(result["members_inserted"], 6)
        self.assertEqual(result["members_updated"], 0)
        self.assertEqual(result["member_count"], 6)

        async with self.pool.connection() as conn:
            row_cursor = await conn.execute(
                "SELECT member_id, member_name FROM public.safe_members WHERE safe_number = %s ORDER BY member_id",
                (TEST_SAFE_NUMBER,),
            )
            rows = await row_cursor.fetchall()
        self.assertEqual(len(rows), 6)
        # Every member's name matches its own id -- a misaligned nextset()
        # during the batched insert would still leave all 6 rows present,
        # but the inserted/updated counts (checked above) would be wrong.
        for row in rows:
            index = row["member_id"].rsplit("-", 1)[-1]
            self.assertEqual(row["member_name"], f"Member {index}")

    async def test_second_run_updates_existing_members_without_reinserting(self):
        first_run_id = await self._enqueued_run_id()
        await ingest_entry(self.pool, first_run_id, _entry(4), index=0)

        second_entry = _entry(4)
        for member in second_entry["members"]:
            member["memberName"] = member["memberName"] + " updated"
        second_run_id = await self._enqueued_run_id()
        result = await ingest_entry(self.pool, second_run_id, second_entry, index=0)

        self.assertEqual(result["members_inserted"], 0)
        self.assertEqual(result["members_updated"], 4)

        async with self.pool.connection() as conn:
            row_cursor = await conn.execute(
                "SELECT member_name FROM public.safe_members WHERE safe_number = %s AND member_id = 'perf-test-member-0'",
                (TEST_SAFE_NUMBER,),
            )
            row = await row_cursor.fetchone()
        self.assertEqual(row["member_name"], "Member 0 updated")


if __name__ == "__main__":
    import unittest
    unittest.main()
