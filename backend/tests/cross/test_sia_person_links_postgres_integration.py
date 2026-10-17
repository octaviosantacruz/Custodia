"""REL-001 matching against real PostgreSQL; opt-in via CUSTODIA_TEST_DATABASE_URL."""

import unittest
from uuid import uuid4

from psycopg.types.json import Jsonb

from app.cross.repositories.sia_person_links import resolve_sia_policy_grantees
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class SiaPersonLinksPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tag = uuid4().hex
        self.source_ids: list[str] = []
        self.object_ids: list[int] = []
        self.addAsyncCleanup(self._cleanup)
        await self._seed()

    async def _cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute(
                "DELETE FROM public.cyberark_inventory_objects WHERE source_id = ANY(%s)",
                (self.source_ids,),
            )

    def _email(self, label: str) -> str:
        return f"{label}-{self.tag}@example.test"

    async def _insert(
        self,
        source_system: str,
        email: str,
        *,
        object_type: str = "user",
        lifecycle: str = "active",
        identity_id: str | None = None,
        user_type: str = "EPVUser",
        service_user: bool = False,
        pam_source_id: str | None = None,
        component_user: bool = False,
    ) -> int:
        source_id = identity_id or email
        self.source_ids.append(source_id)
        attrs = {"email": email, "service_user": service_user}
        if source_system == "cyberark":
            source_id = pam_source_id or (f"{email}#{uuid4().hex[:6]}" if object_type != "user" else email)
            self.source_ids[-1] = source_id
            attrs = {"user_type": user_type, "component_user": str(component_user).lower()}
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                """INSERT INTO public.cyberark_inventory_objects
                   (source_system, object_type, source_id, display_name, lifecycle_status, attributes)
                   VALUES (%s, %s, %s, %s, %s, %s) RETURNING object_id""",
                (source_system, object_type, source_id, f"Person {self.tag}", lifecycle, Jsonb(attrs)),
            )
            object_id = (await cursor.fetchone())["object_id"]
            self.object_ids.append(object_id)
            return object_id

    async def _seed(self):
        for label in ("both", "ambiguous_identity", "ambiguous_pam", "missing", "technical", "nonhuman", "component", "retired", "service", "wrong_source", "wrong_object"):
            email = self._email(label)
            if label == "both":
                await self._insert("identity_administration", email, identity_id=f"identity-{self.tag}-both")
                await self._insert("cyberark", email)
            elif label == "ambiguous_identity":
                await self._insert("identity_administration", email, identity_id=f"identity-{self.tag}-i1")
                await self._insert("identity_administration", email, identity_id=f"identity-{self.tag}-i2")
                await self._insert("cyberark", email)
            elif label == "ambiguous_pam":
                await self._insert("identity_administration", email, identity_id=f"identity-{self.tag}-p")
                await self._insert("cyberark", email)
                await self._insert("cyberark", email, pam_source_id=f" {email.upper()} ")
            elif label == "technical":
                technical_email = f"service-{self.tag}@cyberark.cloud.tenant"
                await self._insert("identity_administration", technical_email, identity_id=f"identity-{self.tag}-technical")
                await self._insert("cyberark", technical_email)
            elif label == "nonhuman":
                await self._insert("cyberark", email, user_type="CPMUser")
            elif label == "component":
                await self._insert("cyberark", email, component_user=True)
            elif label == "retired":
                await self._insert("identity_administration", email, identity_id=f"identity-{self.tag}-retired", lifecycle="retired")
            elif label == "service":
                await self._insert("identity_administration", email, identity_id=f"identity-{self.tag}-service", service_user=True)
            elif label == "wrong_source":
                await self._insert("netskope", email, identity_id=f"netskope-{self.tag}-wrong-source")
            elif label == "wrong_object":
                await self._insert("identity_administration", email, object_type="role", identity_id=f"identity-{self.tag}-wrong-object")

    async def test_sia_grantees_resolve_eligible_unique_counts_and_isolate_sources(self):
        values = [
            self._email("both"), f"  {self._email('BOTH').upper()}  ",
            self._email("ambiguous_identity"), self._email("ambiguous_pam"),
            self._email("missing"), f"service-{self.tag}@cyberark.cloud.tenant",
            self._email("nonhuman"), self._email("component"), self._email("retired"),
            self._email("service"), self._email("wrong_source"), self._email("wrong_object"),
            "not a mail",
        ]
        result = await resolve_sia_policy_grantees(
            self.pool,
            [{"attributes": {"granted_users": values}}],
            readable_sides={"identity", "pam"},
        )
        links = {row["value"].strip().lower(): row for row in result[0]["grantee_links"]}

        self.assertEqual(len(links), len(values) - 1, "normalized duplicate address is returned once")
        self.assertEqual(links[self._email("both")]["identity"]["status"], "matched")
        self.assertEqual(links[self._email("both")]["pam"]["status"], "matched")
        self.assertEqual(links[self._email("ambiguous_identity")]["identity"]["status"], "ambiguous")
        self.assertEqual(links[self._email("ambiguous_identity")]["pam"]["status"], "matched")
        self.assertEqual(links[self._email("ambiguous_pam")]["identity"]["status"], "matched")
        self.assertEqual(links[self._email("ambiguous_pam")]["pam"]["status"], "ambiguous")
        for label in ("missing", "nonhuman", "component", "retired", "service", "wrong_source", "wrong_object"):
            with self.subTest(label=label):
                self.assertEqual(links[self._email(label)]["identity"]["status"], "unmatched")
                self.assertEqual(links[self._email(label)]["pam"]["status"], "unmatched")
        technical = next(value for value in links.values() if "cyberark.cloud" in value["value"])
        self.assertEqual(technical["identity"]["status"], "unmatched")
        self.assertEqual(technical["pam"]["status"], "unmatched")
        self.assertEqual(links["not a mail"]["identity"]["status"], "unmatched")
        self.assertEqual(links["not a mail"]["pam"]["status"], "unmatched")

        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT count(*)::int AS total FROM public.cyberark_inventory_relationships WHERE source_object_id = ANY(%s) OR target_object_id = ANY(%s)",
                (self.object_ids, self.object_ids),
            )
            self.assertEqual((await cursor.fetchone())["total"], 0)


if __name__ == "__main__":
    unittest.main()
