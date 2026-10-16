"""NSK-GRP-001: group inventory, membership counts and retirement on a real PostgreSQL."""

from uuid import uuid4

from app.cross.cmdb_sync import sync_inventory_snapshot
from app.cross.services.cmdb_models import InventoryObject
from app.netskope.sse.repositories.netskope_groups import list_netskope_group_members, list_netskope_groups
from app.netskope.sse.services.netskope_mapping import (
    GROUP_MEMBERSHIP, GROUP_OBJECT_TYPE, map_netskope_group_memberships, map_netskope_groups,
)
from tests.support.pg_integration_base import PostgresIntegrationTestCase

PREFIX = "grp-test-"


class NetskopeGroupsPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.addAsyncCleanup(self.cleanup)
        await self.cleanup()

    async def cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("""DELETE FROM public.cyberark_inventory_relationships WHERE source_object_id IN (
                SELECT object_id FROM public.cyberark_inventory_objects WHERE source_id LIKE %s)
                OR target_object_id IN (SELECT object_id FROM public.cyberark_inventory_objects WHERE source_id LIKE %s)""",
                               (PREFIX + "%", PREFIX + "%"))
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE source_id LIKE %s", (PREFIX + "%",))
            await conn.commit()

    def snapshot(self, groups, memberships):
        """``groups``: [(id, name, user_count|None, provisioner)]; ``memberships``: {user: [group ids]}."""
        payload = [{"id": PREFIX + gid, "displayName": name, "provisioner": prov,
                    **({"userCount": count} if count is not None else {})} for gid, name, count, prov in groups]
        users = [{"id": PREFIX + user, "accounts": [{"parentGroups": [PREFIX + gid for gid in gids]}]}
                 for user, gids in memberships.items()]
        objects = [InventoryObject("user", PREFIX + user, user, "netskope", attributes={"email": f"{user}@example.test"})
                   for user in memberships]
        group_objects = map_netskope_groups(payload)
        relationships, _ = map_netskope_group_memberships(users, {item.source_id for item in group_objects})
        return objects + group_objects, relationships

    async def run_snapshot(self, objects, relationships, *, groups_read_ok=True):
        return await sync_inventory_snapshot(
            self.pool, objects, relationships, source_run_id=str(uuid4()), source_system="netskope",
            reconcile_object_types=frozenset({GROUP_OBJECT_TYPE} if groups_read_ok else set()),
            reconcile_relationship_types=frozenset({GROUP_MEMBERSHIP} if groups_read_ok else set()),
        )

    async def listing(self, **overrides):
        values = {"search": PREFIX, "provisioner": "", "limit": 50, "offset": 0, **overrides}
        return await list_netskope_groups(self.pool, values["search"], values["provisioner"], values["limit"], values["offset"])

    async def test_lists_groups_with_observed_and_reported_counts_and_unknown_is_not_zero(self):
        objects, relationships = self.snapshot(
            [("a", "Alpha", 5, "AD"), ("b", "Beta", None, "SCIM"), ("c", "Gamma", 0, "AD")],
            {"u1": ["a", "b"], "u2": ["a"]},
        )
        await self.run_snapshot(objects, relationships)
        rows = {row["name"]: row for row in (await self.listing())["rows"]}
        self.assertEqual((rows["Alpha"]["observed_members"], rows["Alpha"]["reported_members"]), (2, 5))
        self.assertEqual((rows["Beta"]["observed_members"], rows["Beta"]["reported_members"]), (1, None))
        self.assertEqual((rows["Gamma"]["observed_members"], rows["Gamma"]["reported_members"]), (0, 0))
        self.assertEqual({row["provisioner"] for row in (await self.listing(provisioner="SCIM"))["rows"]}, {"SCIM"})

    async def test_pagination_and_search_are_stable(self):
        objects, relationships = self.snapshot([(f"g{i}", f"Group {i}", None, "AD") for i in range(5)], {"u1": ["g0"]})
        await self.run_snapshot(objects, relationships)
        first, second = await self.listing(limit=2), await self.listing(limit=2, offset=2)
        self.assertEqual((first["total"], len(first["rows"]), len(second["rows"])), (5, 2, 2))
        self.assertFalse({row["id"] for row in first["rows"]} & {row["id"] for row in second["rows"]})
        self.assertEqual([row["name"] for row in (await self.listing(search="Group 3"))["rows"]], ["Group 3"])

    async def test_a_complete_run_retires_missing_groups_and_dropped_memberships(self):
        objects, relationships = self.snapshot([("a", "Alpha", 2, "AD"), ("b", "Beta", 1, "AD")], {"u1": ["a", "b"], "u2": ["a"]})
        await self.run_snapshot(objects, relationships)
        objects, relationships = self.snapshot([("a", "Alpha", 1, "AD")], {"u1": ["a"], "u2": []})
        await self.run_snapshot(objects, relationships)
        listing = await self.listing()
        self.assertEqual([(row["name"], row["observed_members"]) for row in listing["rows"]], [("Alpha", 1)])
        self.assertIsNone(await list_netskope_group_members(self.pool, PREFIX + "b", 50, 0))
        members = await list_netskope_group_members(self.pool, PREFIX + "a", 50, 0)
        self.assertEqual([row["name"] for row in members["rows"]], ["u1"])

    async def test_a_run_that_did_not_read_groups_retires_nothing(self):
        objects, relationships = self.snapshot([("a", "Alpha", 1, "AD")], {"u1": ["a"]})
        await self.run_snapshot(objects, relationships)
        users_only = [item for item in objects if item.object_type == "user"]
        await self.run_snapshot(users_only, [], groups_read_ok=False)
        listing = await self.listing()
        self.assertEqual([(row["name"], row["observed_members"]) for row in listing["rows"]], [("Alpha", 1)])

    async def test_members_are_paginated_and_other_sources_are_not_mixed_in(self):
        objects, relationships = self.snapshot([("a", "Alpha", None, "AD")], {f"user{i}": ["a"] for i in range(3)})
        await self.run_snapshot(objects, relationships)
        page = await list_netskope_group_members(self.pool, PREFIX + "a", 2, 0)
        rest = await list_netskope_group_members(self.pool, PREFIX + "a", 2, 2)
        self.assertEqual((page["total"], len(page["rows"]), len(rest["rows"])), (3, 2, 1))
        self.assertEqual(page["rows"][0]["email"], "user0@example.test")
        self.assertIsNone(await list_netskope_group_members(self.pool, PREFIX + "unknown", 50, 0))
