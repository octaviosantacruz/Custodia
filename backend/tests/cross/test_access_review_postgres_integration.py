"""ACCESS-REVIEW-001 against real PostgreSQL: one row per role assignment with the signals of an access review."""

from uuid import uuid4

from app.cross.repositories.user_admin import list_access_review
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class AccessReviewPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tag = uuid4().hex[:8]
        self.domain = f"@review-{self.tag}.test"
        self.actors: list[str] = []
        self.addAsyncCleanup(self._cleanup)
        await self._seed()

    def actor(self, name: str) -> str:
        actor_id = f"{name}{self.domain}"
        self.actors.append(actor_id)
        return actor_id

    async def local(self, name: str, active: bool = True) -> str:
        actor_id = self.actor(name)
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO public.access_users (actor_id, email, display_name, password_hash, is_active) VALUES (%s, %s, %s, 'x', %s)",
                (actor_id, actor_id, f"Local {name}", active),
            )
        return actor_id

    async def oidc(self, name: str, last_login_days: int) -> str:
        actor_id = self.actor(name)
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO public.access_oidc_users (actor_id, issuer, subject, email, display_name, last_login_at) "
                "VALUES (%s, 'https://issuer.test', %s, %s, %s, now() - make_interval(days => %s))",
                (actor_id, actor_id, actor_id, f"Okta {name}", last_login_days),
            )
        return actor_id

    async def grant(self, actor_id: str, role: str, source: str, days_ago: int, granted_by: str = "tester"):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO public.access_user_roles (actor_id, role_code, assignment_source, granted_by, granted_at) "
                "VALUES (%s, %s, %s, %s, now() - make_interval(days => %s))",
                (actor_id, role, source, granted_by, days_ago),
            )

    async def _seed(self):
        granter = await self.local("granter")
        old_manual = await self.local("oldmanual")
        await self.grant(old_manual, "reader", "manual", 120, granted_by=granter)
        recent = await self.local("recent")
        await self.grant(recent, "operator", "manual", 10)
        inactive = await self.local("inactive", active=False)
        await self.grant(inactive, "reader", "manual", 5)
        stale = await self.oidc("stale", last_login_days=200)
        await self.grant(stale, "reader", "oidc", 200, granted_by="oidc")
        fresh_manual = await self.oidc("freshmanual", last_login_days=1)
        await self.grant(fresh_manual, "operator", "manual", 100)

    async def _cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.access_user_roles WHERE actor_id = ANY(%s)", (self.actors,))
            await conn.execute("DELETE FROM public.access_users WHERE actor_id = ANY(%s)", (self.actors,))
            await conn.execute("DELETE FROM public.access_oidc_users WHERE actor_id = ANY(%s)", (self.actors,))

    async def review(self, **kwargs):
        return await list_access_review(self.pool, search=self.domain, **kwargs)

    def by_name(self, result) -> dict:
        return {row["actor_id"].split("@")[0]: row for row in result["rows"]}

    async def test_each_assignment_carries_its_review_flags(self):
        found = self.by_name(await self.review())
        self.assertEqual(found["oldmanual"]["flags"], ["manual_old"])
        self.assertEqual(found["recent"]["flags"], [])
        self.assertEqual(found["inactive"]["flags"], ["inactive_account"])
        self.assertEqual(found["stale"]["flags"], ["stale_login"])
        self.assertEqual(found["freshmanual"]["flags"], ["manual_old"], "a recent login does not hide an old manual grant")

    async def test_dates_are_only_given_where_they_mean_something(self):
        found = self.by_name(await self.review())
        self.assertIsNotNone(found["oldmanual"]["granted_at"])
        self.assertEqual(found["oldmanual"]["granted_by"], "Local granter", "the grantor resolves to a name when it is in the directory")
        self.assertEqual(found["recent"]["granted_by"], "tester", "an unknown grantor keeps its actor id")
        self.assertIsNone(found["oldmanual"]["last_login_at"], "a local account records no login and none is invented")
        self.assertIsNotNone(found["stale"]["last_login_at"])
        self.assertEqual((found["stale"]["source"], found["stale"]["granted_at"], found["stale"]["granted_by"]), ("oidc", None, None),
                         "an Okta role is rewritten at every login, so its grant date is not shown")

    async def test_a_local_account_never_counts_as_stale_login(self):
        found = self.by_name(await self.review(days=1))
        self.assertNotIn("stale_login", found["oldmanual"]["flags"])
        self.assertNotIn("stale_login", found["recent"]["flags"])

    async def test_the_summary_counts_the_whole_review_and_flag_filters_narrow_the_rows(self):
        result = await self.review()
        self.assertEqual(result["summary"], {"assignments": 5, "attention": 4, "inactive_account": 1, "manual_old": 2, "stale_login": 1})
        self.assertEqual(len(result["rows"]), 5)
        for flag, expected in (("attention", 4), ("manual_old", 2), ("inactive_account", 1), ("stale_login", 1)):
            filtered = await self.review(flag=flag)
            self.assertEqual((filtered["total"], len(filtered["rows"])), (expected, expected), flag)
            self.assertEqual(filtered["summary"]["assignments"], 5, "the summary ignores the flag filter")

    async def test_the_threshold_moves_what_counts_as_old(self):
        wide = await self.review(days=400)
        self.assertEqual((wide["summary"]["manual_old"], wide["summary"]["stale_login"]), (0, 0))
        tight = await self.review(days=7)
        self.assertEqual(tight["summary"]["manual_old"], 3, "the 10-day-old manual grant is now old too")

    async def test_flagged_rows_come_first_and_pages_keep_the_total(self):
        result = await self.review(limit=2)
        self.assertEqual((len(result["rows"]), result["total"]), (2, 5))
        self.assertTrue(all(row["flags"] for row in result["rows"]))
        last = await self.review(limit=2, offset=4)
        self.assertEqual(len(last["rows"]), 1)
        self.assertEqual(last["rows"][0]["flags"], [], "the unflagged assignment closes the list")

    async def test_an_unknown_flag_is_rejected(self):
        with self.assertRaises(ValueError):
            await self.review(flag="everything")
