"""Verified login claims, persistence and directory output on disposable PostgreSQL."""
import json
import os
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import AsyncMock, patch

import app.auth as auth
from app.db import fetch_all, fetch_one
from app.cross.services.oidc_groups import list_observed_oidc_groups
from app.cross.services.user_management import find_people
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class OidcGroupsPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.actor = f"observed-{uuid4()}"
        self.legacy = f"legacy-{uuid4()}"
        self.other = f"other-{uuid4()}"
        self.issuer = f"https://issuer.example/{uuid4()}"
        self.extra_actors = []
        self.env = patch.dict(os.environ, {
            "OIDC_ISSUER_URL": self.issuer, "OIDC_GROUP_CLAIM": "team_groups",
            "OIDC_ROLE_MAP_JSON": json.dumps({"team-a": "reader", "team-b": "reader"}),
            "OIDC_DEFAULT_ROLE": "reader",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addAsyncCleanup(self.clean_rows)
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO access_oidc_users (actor_id, issuer, subject, display_name) VALUES (%s, %s, %s, %s)",
                (self.legacy, self.issuer, self.legacy, "Legacy reader"),
            )
            await conn.execute("INSERT INTO access_user_roles (actor_id, role_code, granted_by) VALUES (%s, 'reader', 'oidc')", (self.legacy,))
            await conn.execute(
                """INSERT INTO access_oidc_users (actor_id, issuer, subject, display_name, observed_groups, groups_observed_at)
                   VALUES (%s, %s, %s, 'Other issuer', ARRAY['team-a'], now())""",
                (self.other, self.issuer + "/other", self.other),
            )

    async def clean_rows(self):
        async with self.pool.connection() as conn:
            for table in ("access_user_roles", "access_audit_log", "access_oidc_users"):
                await conn.execute(f"DELETE FROM {table} WHERE actor_id = ANY(%s)", ([self.actor, self.legacy, self.other, *self.extra_actors],))

    async def login(self, claims):
        request = SimpleNamespace(session={}, app=SimpleNamespace(state=SimpleNamespace(db=self.pool)))
        provider = SimpleNamespace(authorize_access_token=AsyncMock(return_value={"userinfo": {
            "sub": self.actor, "email": "observed@example.test", "name": "Observed member", **claims,
        }}))
        with patch.object(auth, "OIDC_ENABLED", True), patch.object(auth, "OIDC_CONFIGURED", True), \
             patch.object(auth, "OIDC_ISSUER_URL", self.issuer), patch.object(auth.oauth, "idp", provider, create=True), \
             patch.object(auth, "record_security_event_for_request", new=AsyncMock()):
            await auth.finish_oidc_login(request)
        return request

    async def test_last_login_replaces_exact_mapped_members_without_inferring_from_roles(self):
        await self.login({"team_groups": ["team-a", "team-a", "not-mapped"], "groups": ["team-b"]})
        result = await list_observed_oidc_groups(self.pool)
        self.assertEqual(result["observed_identities"], 1)
        self.assertEqual(result["unobserved_identities"], 1)
        first, second = result["rows"]
        self.assertEqual(first["member_count"], 1)
        self.assertEqual([m["actor_id"] for m in first["members"]], [self.actor])
        self.assertIsNotNone(first["members"][0]["groups_observed_at"])
        self.assertEqual(second["members"], [])
        self.assertEqual(first["role_codes"], second["role_codes"])

        await self.login({"team_groups": "team-b"})
        result = await list_observed_oidc_groups(self.pool)
        self.assertEqual(result["rows"][0]["member_count"], 0)
        self.assertEqual([m["actor_id"] for m in result["rows"][1]["members"]], [self.actor])

        await self.login({"team_groups": []})
        result = await list_observed_oidc_groups(self.pool)
        self.assertEqual(result["observed_identities"], 1)
        self.assertEqual([r["member_count"] for r in result["rows"]], [0, 0])
        roles = await fetch_all(self.pool, "SELECT role_code FROM access_user_roles WHERE actor_id = %s", (self.actor,))
        self.assertEqual([r["role_code"] for r in roles], ["reader"])

        for claims in ({}, {"team_groups": {"invalid": "team-a"}}):
            await self.login(claims)
            result = await list_observed_oidc_groups(self.pool)
            self.assertEqual(result["observed_identities"], 0)
            self.assertEqual(result["unobserved_identities"], 2)
            self.assertEqual([r["members"] for r in result["rows"]], [[], []])
        audit = await fetch_all(self.pool, "SELECT after_data FROM access_audit_log WHERE actor_id = %s ORDER BY audit_id", (self.actor,))
        self.assertEqual([r["after_data"]["mapped_group_count"] for r in audit], [1, 1, 0, None, None])
        self.assertEqual(set(audit[0]["after_data"]), {"groups_observed", "mapped_group_count"})

    async def test_people_chip_projects_stored_login_groups_and_ignores_other_issuers(self):
        await self.login({"team_groups": ["team-a", "not-mapped"]})
        result = await find_people(self.pool, "observed@example.test", "", "", 1, 0, include_oidc_groups=True)
        self.assertEqual(len(result["rows"]), 1)
        identity = result["rows"][0]["identities"][0]
        self.assertEqual(identity["observed_groups"], ["team-a"])
        self.assertIsNotNone(identity["groups_observed_at"])
        result = await find_people(self.pool, "Other issuer", "", "", 1, 0, include_oidc_groups=True)
        identity = result["rows"][0]["identities"][0]
        self.assertIsNone(identity["observed_groups"])
        self.assertIsNone(identity["groups_observed_at"])

    async def test_member_limit_preserves_total_and_observation_dates(self):
        self.extra_actors = [f"{self.actor}-{index}" for index in range(101)]
        async with self.pool.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.executemany(
                    """INSERT INTO access_oidc_users (actor_id, issuer, subject, display_name, observed_groups, groups_observed_at)
                       VALUES (%s, %s, %s, %s, ARRAY['team-a'], now())""",
                    [(actor, self.issuer, actor, f"Member {index:03}") for index, actor in enumerate(self.extra_actors)],
                )
        result = await list_observed_oidc_groups(self.pool)
        group = result["rows"][0]
        self.assertEqual(group["member_count"], 101)
        self.assertEqual(len(group["members"]), 100)
        self.assertEqual(len({member["actor_id"] for member in group["members"]}), 100)
        self.assertEqual(group["members"][0]["display_name"], "Member 000")
        self.assertEqual(group["members"][-1]["display_name"], "Member 099")
        self.assertTrue(all(member["groups_observed_at"] is not None for member in group["members"]))

    async def test_failed_audit_rolls_back_membership_and_role_refresh(self):
        await self.login({"team_groups": ["team-a"]})
        before = await fetch_one(self.pool, "SELECT observed_groups, groups_observed_at, last_login_at FROM access_oidc_users WHERE actor_id = %s", (self.actor,))
        with patch.dict(os.environ, {"OIDC_DEFAULT_ROLE": "operator"}), patch("app.cross.repositories.auth_queries.record_audit", new=AsyncMock(side_effect=RuntimeError("audit unavailable"))):
            with self.assertRaisesRegex(RuntimeError, "audit unavailable"):
                await self.login({"team_groups": []})
        after = await fetch_one(self.pool, "SELECT observed_groups, groups_observed_at, last_login_at FROM access_oidc_users WHERE actor_id = %s", (self.actor,))
        self.assertEqual(after, before)
        roles = await fetch_all(self.pool, "SELECT role_code FROM access_user_roles WHERE actor_id = %s", (self.actor,))
        self.assertEqual([r["role_code"] for r in roles], ["reader"])
        audit = await fetch_all(self.pool, "SELECT audit_id FROM access_audit_log WHERE actor_id = %s", (self.actor,))
        self.assertEqual(len(audit), 1)
