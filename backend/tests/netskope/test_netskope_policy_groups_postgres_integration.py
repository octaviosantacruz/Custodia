"""NSK-POLICY-002: policy groups on a real PostgreSQL -- object type accepted, ordered listing and retirement rules."""

from uuid import uuid4

from app.cross.cmdb_sync import sync_inventory_snapshot
from app.netskope.sse.repositories.netskope_groups import list_netskope_policy_groups
from app.netskope.sse.services.netskope_mapping import POLICY_GROUP_OBJECT_TYPE, map_netskope_policy_groups
from tests.support.pg_integration_base import PostgresIntegrationTestCase

PREFIX = "pgrp-test-"


class NetskopePolicyGroupsPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.addAsyncCleanup(self.cleanup)
        await self.cleanup()

    async def cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE source_id LIKE %s", (PREFIX + "%",))
            await conn.commit()

    def groups(self, *ids):
        return map_netskope_policy_groups([{"group_id": PREFIX + gid, "group_name": f"Group {gid}", "group_type": "default",
                                            "can_be_edited_deleted": gid != "1"} for gid in ids])

    async def run_snapshot(self, objects, *, reconcile=True):
        return await sync_inventory_snapshot(
            self.pool, objects, [], source_run_id=str(uuid4()), source_system="netskope",
            reconcile_object_types=frozenset({POLICY_GROUP_OBJECT_TYPE} if reconcile else set()),
        )

    async def listed(self):
        return [row for row in (await list_netskope_policy_groups(self.pool))["rows"] if row["id"].startswith(PREFIX)]

    async def test_the_database_accepts_the_type_and_lists_only_safe_fields(self):
        await self.run_snapshot(self.groups("2", "10", "1"))
        rows = await self.listed()
        self.assertEqual({row["name"] for row in rows}, {"Group 1", "Group 2", "Group 10"})
        self.assertEqual(set(rows[0]), {"id", "name", "group_type", "can_be_edited_deleted", "first_seen_at", "last_seen_at"})
        by_name = {row["name"]: row for row in rows}
        self.assertIs(by_name["Group 1"]["can_be_edited_deleted"], False)
        self.assertIs(by_name["Group 2"]["can_be_edited_deleted"], True)

    async def test_a_complete_read_retires_an_absent_group_but_a_failed_one_retires_nothing(self):
        await self.run_snapshot(self.groups("1", "2"))
        await self.run_snapshot(self.groups("1"), reconcile=False)
        self.assertEqual(len(await self.listed()), 2)
        await self.run_snapshot(self.groups("1"))
        self.assertEqual({row["id"] for row in await self.listed()}, {PREFIX + "1"})
