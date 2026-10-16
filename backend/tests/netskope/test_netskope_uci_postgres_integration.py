"""NSK-UBA-002: replacement semantics and exact-email join on a real PostgreSQL."""

from datetime import datetime, timezone
from uuid import uuid4

from app.cross.cmdb_sync import sync_inventory_snapshot
from app.cross.services.cmdb_models import InventoryObject
from app.netskope.sse.repositories.netskope_uci import list_netskope_user_uci, record_uci_company_snapshot, replace_netskope_user_uci, uci_by_company
from tests.support.pg_integration_base import PostgresIntegrationTestCase

PREFIX = "uci-test-"
NOW = datetime(2026, 10, 4, tzinfo=timezone.utc)


def row(email, rating, score, previous=None):
    return {"email_key": email, "rating": rating, "score": score, "previous_score": previous, "scored_at": NOW}


class NetskopeUciPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.addAsyncCleanup(self.cleanup)
        await self.cleanup()

    async def cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.netskope_user_uci")
            await conn.execute("DELETE FROM public.netskope_uci_company_history WHERE company LIKE 'UCI-%'")
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE source_id LIKE %s", (PREFIX + "%",))
            await conn.commit()

    async def listing(self, rating="", search="", order="score", limit=50, offset=0):
        return await list_netskope_user_uci(self.pool, rating, search, order, limit, offset)

    async def test_replace_drops_users_that_are_no_longer_listed(self):
        await replace_netskope_user_uci(self.pool, uuid4(), [row("a@x.test", "Poor", 100), row("b@x.test", "Moderate", 500, 600)])
        await replace_netskope_user_uci(self.pool, uuid4(), [row("b@x.test", "Moderate", 450, 500)])
        result = await self.listing()
        self.assertEqual([(r["email"], r["score"], r["previous_score"]) for r in result["rows"]], [("b@x.test", 450, 500)])
        self.assertEqual(result["by_rating"], {"Poor": 0, "Moderate": 1})

    async def test_empty_replacement_clears_everything_and_keeps_capture_unknown(self):
        await replace_netskope_user_uci(self.pool, uuid4(), [row("a@x.test", "Poor", 100)])
        await replace_netskope_user_uci(self.pool, uuid4(), [])
        result = await self.listing()
        self.assertEqual((result["rows"], result["total"], result["captured_at"]), ([], 0, None))

    async def test_orders_filters_and_paginates(self):
        await replace_netskope_user_uci(self.pool, uuid4(), [
            row("c@x.test", "Moderate", 500), row("a@x.test", "Poor", 300), row("b@x.test", "Poor", 100),
        ])
        self.assertEqual([r["email"] for r in (await self.listing())["rows"]], ["b@x.test", "a@x.test", "c@x.test"])
        self.assertEqual([r["email"] for r in (await self.listing(rating="Poor", order="name"))["rows"]], ["a@x.test", "b@x.test"])
        page = await self.listing(limit=1, offset=1)
        self.assertEqual((page["total"], [r["email"] for r in page["rows"]]), (3, ["a@x.test"]))
        self.assertEqual([r["email"] for r in (await self.listing(search="C@X"))["rows"]], ["c@x.test"])

    async def test_name_comes_only_from_a_single_active_user_with_that_exact_email(self):
        users = [
            InventoryObject("user", PREFIX + "1", "Ana Uno", "netskope", attributes={"email": "Ana@x.test"}),
            InventoryObject("user", PREFIX + "2", "Dup Uno", "netskope", attributes={"email": "dup@x.test"}),
            InventoryObject("user", PREFIX + "3", "Dup Dos", "netskope", attributes={"email": "dup@x.test"}),
        ]
        await sync_inventory_snapshot(
            self.pool, users, [], source_run_id=str(uuid4()), source_system="netskope",
            reconcile_object_types=frozenset(),
        )
        await replace_netskope_user_uci(self.pool, uuid4(), [
            row("ana@x.test", "Poor", 100), row("dup@x.test", "Poor", 200), row("none@x.test", "Poor", 300),
        ])
        by_email = {r["email"]: r for r in (await self.listing())["rows"]}
        self.assertEqual((by_email["ana@x.test"]["name"], by_email["ana@x.test"]["user_id"]), ("Ana Uno", PREFIX + "1"))
        self.assertEqual((by_email["dup@x.test"]["name"], by_email["dup@x.test"]["user_id"]), (None, None))
        self.assertEqual((by_email["none@x.test"]["name"], by_email["none@x.test"]["user_id"]), (None, None))

    async def test_company_share_counts_only_users_with_an_email_and_ranks_by_risk(self):
        def user(n, name, email, company):
            attributes = {"company": company}
            if email:
                attributes["email"] = email
            return InventoryObject("user", PREFIX + n, name, "netskope", attributes=attributes)
        await sync_inventory_snapshot(self.pool, [
            user("c1", "A", "a@x.test", "UCI-ALFA"), user("c2", "B", "b@x.test", "UCI-ALFA"),
            user("c3", "C", "c@x.test", "UCI-BETA"), user("c4", "D", "d@x.test", "UCI-BETA"), user("c5", "E", "e@x.test", "UCI-BETA"),
            user("c6", "F", None, "UCI-BETA"),
        ], [], source_run_id=str(uuid4()), source_system="netskope", reconcile_object_types=frozenset())
        await replace_netskope_user_uci(self.pool, uuid4(), [row("a@x.test", "Poor", 100), row("b@x.test", "Moderate", 500), row("c@x.test", "Poor", 200)])
        companies = {c["company"]: c for c in (await uci_by_company(self.pool))["companies"]}
        # Alfa: 2 of 2 at risk; Beta: 1 of 3 (the user without an email is not in the denominator).
        self.assertEqual((companies["UCI-ALFA"]["users"], companies["UCI-ALFA"]["poor"], companies["UCI-ALFA"]["moderate"]), (2, 1, 1))
        self.assertEqual((companies["UCI-BETA"]["users"], companies["UCI-BETA"]["poor"], companies["UCI-BETA"]["moderate"]), (3, 1, 0))
        order = [c["company"] for c in (await uci_by_company(self.pool))["companies"] if c["company"].startswith("UCI-")]
        self.assertEqual(order, ["UCI-ALFA", "UCI-BETA"])

    async def test_weekly_snapshot_keeps_counts_only_and_feeds_the_previous_week(self):
        await sync_inventory_snapshot(self.pool, [
            InventoryObject("user", PREFIX + "h1", "A", "netskope", attributes={"company": "UCI-HIST", "email": "h1@x.test"}),
            InventoryObject("user", PREFIX + "h2", "B", "netskope", attributes={"company": "UCI-HIST", "email": "h2@x.test"}),
        ], [], source_run_id=str(uuid4()), source_system="netskope", reconcile_object_types=frozenset())
        await replace_netskope_user_uci(self.pool, uuid4(), [row("h1@x.test", "Poor", 100)])
        await record_uci_company_snapshot(self.pool)
        await record_uci_company_snapshot(self.pool)  # the same week upserts, never duplicates
        async with self.pool.connection() as conn:
            cursor = await conn.execute("SELECT count(*)::int AS n, max(users) AS users, max(poor) AS poor FROM public.netskope_uci_company_history WHERE company = 'UCI-HIST'")
            found = await cursor.fetchone()
            self.assertEqual((found["n"], found["users"], found["poor"]), (1, 2, 1))
            cursor = await conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'netskope_uci_company_history' ORDER BY column_name")
            self.assertEqual([r["column_name"] for r in await cursor.fetchall()], ["captured_at", "company", "moderate", "poor", "users", "week_start"])
        current = {c["company"]: c for c in (await uci_by_company(self.pool))["companies"]}
        self.assertIsNone(current["UCI-HIST"]["previous"])  # only the current week exists so far
        # Move the snapshot to last week and worsen the live data: the comparison reads the earlier counts.
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE public.netskope_uci_company_history SET week_start = week_start - 7 WHERE company = 'UCI-HIST'")
            await conn.commit()
        await replace_netskope_user_uci(self.pool, uuid4(), [row("h1@x.test", "Poor", 100), row("h2@x.test", "Moderate", 400)])
        result = await uci_by_company(self.pool)
        company = {c["company"]: c for c in result["companies"]}["UCI-HIST"]
        self.assertEqual(company["previous"], {"users": 2, "poor": 1, "moderate": 0})
        self.assertEqual((company["poor"], company["moderate"]), (1, 1))
        self.assertIsNotNone(result["previous_week"])

    async def test_the_strict_permission_is_seeded(self):
        async with self.pool.connection() as conn:
            cursor = await conn.execute("SELECT lifecycle_status FROM public.access_permissions WHERE permission_code = 'netskope:uba_read'")
            self.assertEqual((await cursor.fetchone())["lifecycle_status"], "active")
