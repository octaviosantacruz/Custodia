import json
from uuid import uuid4

from app.cyberark.identity_administration.repositories.identity_admin_queries import list_identity_roles
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class IdentityRoleSortPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.token = uuid4().hex[:12]
        self.addAsyncCleanup(self._cleanup)
        # (display name, direct member count or None when never reported, last modification)
        fixtures = [
            (f"Alpha {self.token}", 5, "2026-03-01T00:00:00Z"),
            (f"Zulu {self.token}", None, ""),
            (f"sg_cyberark_Mid {self.token}", 12, "2026-09-01T00:00:00Z"),
            (f"sg_cyberark_Aaa {self.token}", 0, "2026-06-01T00:00:00Z"),
        ]
        async with self.pool.connection() as conn:
            for index, (name, members, modified) in enumerate(fixtures):
                attributes = {"last_modified": modified}
                if members is not None:
                    attributes["direct_member_count"] = members
                await conn.execute(
                    """INSERT INTO public.cyberark_inventory_objects
                       (source_id, object_type, display_name, source_system, attributes)
                       VALUES (%s, 'role', %s, 'identity_administration', %s::jsonb)""",
                    (f"sorttest-{self.token}-{index}", name, json.dumps(attributes)),
                )

    async def _cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE source_id LIKE %s", (f"sorttest-{self.token}-%",))

    async def _names(self, **kwargs):
        listing = await list_identity_roles(self.pool, self.token, 50, 0, **kwargs)
        return [row["display_name"].split(" ")[0] for row in listing["rows"]]

    async def test_orders_by_name_by_type_and_by_direct_members_in_both_directions(self):
        self.assertEqual(await self._names(), ["Alpha", "sg_cyberark_Aaa", "sg_cyberark_Mid", "Zulu"])
        self.assertEqual(await self._names(sort="name", direction="desc"), ["Zulu", "sg_cyberark_Mid", "sg_cyberark_Aaa", "Alpha"])
        # Unreported counts always sort last, whichever the direction.
        self.assertEqual(await self._names(sort="members", direction="desc"), ["sg_cyberark_Mid", "Alpha", "sg_cyberark_Aaa", "Zulu"])
        self.assertEqual(await self._names(sort="members", direction="asc"), ["sg_cyberark_Aaa", "Alpha", "sg_cyberark_Mid", "Zulu"])

    async def test_orders_by_last_modification_with_missing_dates_last(self):
        self.assertEqual(await self._names(sort="modified", direction="desc"), ["sg_cyberark_Mid", "sg_cyberark_Aaa", "Alpha", "Zulu"])
        self.assertEqual(await self._names(sort="modified", direction="asc"), ["Alpha", "sg_cyberark_Aaa", "sg_cyberark_Mid", "Zulu"])

    async def test_kind_filter_and_sorting_compose(self):
        self.assertEqual(await self._names(kind="okta_group", sort="members", direction="desc"), ["sg_cyberark_Mid", "sg_cyberark_Aaa"])
        self.assertEqual(await self._names(kind="role", sort="members", direction="desc"), ["Alpha", "Zulu"])

    async def test_object_ids_restrict_the_listing_and_compose_with_other_filters(self):
        everyone = await list_identity_roles(self.pool, self.token, 50, 0)
        ids = {row["display_name"].split(" ")[0]: row["object_id"] for row in everyone["rows"]}
        picked = [ids["Alpha"], ids["sg_cyberark_Mid"]]
        self.assertEqual(await self._names(object_ids=picked), ["Alpha", "sg_cyberark_Mid"])
        self.assertEqual(await self._names(object_ids=picked, kind="okta_group"), ["sg_cyberark_Mid"])
        self.assertEqual(await self._names(object_ids=[]), [])
