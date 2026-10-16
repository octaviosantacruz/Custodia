"""AUD-PERF-001: upsert_objects/upsert_relationships moved from one
execute() per row to executemany(returning=True). A fake cursor can't
prove the RETURNING/nextset() pairing actually stays aligned with input
order against real PostgreSQL, so this exercises it against a real
connection. Opt-in only; see tests/support/pg_integration_base.py."""

from app.cross.services.cmdb_models import InventoryObject, InventoryRelationship
from app.cross.repositories.cmdb_persistence import upsert_objects, upsert_relationships
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class CmdbPersistenceBatchingPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self._cleanup()

    async def asyncTearDown(self):
        await self._cleanup()

    async def _cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute(
                """
                DELETE FROM public.cyberark_inventory_relationships r
                USING public.cyberark_inventory_objects o
                WHERE o.object_id IN (r.source_object_id, r.target_object_id)
                  AND o.source_id LIKE 'perf-test-%'
                """
            )
            await conn.execute(
                "DELETE FROM public.cyberark_inventory_objects WHERE source_id LIKE 'perf-test-%'"
            )
            await conn.commit()

    async def test_upsert_objects_returns_ids_aligned_with_input_order(self):
        objects = [
            InventoryObject(object_type="user", source_id=f"perf-test-user-{i}", display_name=f"User {i}")
            for i in range(5)
        ]
        async with self.pool.connection() as conn:
            async with conn.transaction():
                async with conn.cursor() as cursor:
                    object_ids = await upsert_objects(cursor, objects, source_run_id=None)

        self.assertEqual(len(object_ids), 5)
        for item in objects:
            key = (item.source_system, item.object_type, item.source_id)
            self.assertIn(key, object_ids)
        # Every id resolved to a distinct row -- a misaligned nextset() would
        # instead collapse rows onto the same or a shifted id.
        self.assertEqual(len(set(object_ids.values())), 5)

    async def test_upsert_objects_on_conflict_preserves_existing_id_and_updates_fields(self):
        original = [InventoryObject(object_type="user", source_id="perf-test-user-conflict", display_name="Before")]
        async with self.pool.connection() as conn:
            async with conn.transaction():
                async with conn.cursor() as cursor:
                    first_ids = await upsert_objects(cursor, original, source_run_id=None)

        updated = [InventoryObject(object_type="user", source_id="perf-test-user-conflict", display_name="After")]
        async with self.pool.connection() as conn:
            async with conn.transaction():
                async with conn.cursor() as cursor:
                    second_ids = await upsert_objects(cursor, updated, source_run_id=None)

        key = ("cyberark", "user", "perf-test-user-conflict")
        self.assertEqual(first_ids[key], second_ids[key])

        async with self.pool.connection() as conn:
            row_cursor = await conn.execute(
                "SELECT display_name FROM public.cyberark_inventory_objects WHERE object_id = %s",
                (second_ids[key],),
            )
            row = await row_cursor.fetchone()
        self.assertEqual(row["display_name"], "After")

    async def test_upsert_relationships_resolves_batch_of_missing_endpoints(self):
        objects = [
            InventoryObject(object_type="user", source_id="perf-test-user-rel", display_name="User"),
            InventoryObject(object_type="role", source_id="perf-test-role-rel", display_name="Role"),
        ]
        async with self.pool.connection() as conn:
            async with conn.transaction():
                async with conn.cursor() as cursor:
                    # Persist objects first, then resolve them as "missing"
                    # from an empty object_ids map -- exercises the batched
                    # endpoint lookup instead of the happy path where ids are
                    # already known from the same snapshot.
                    await upsert_objects(cursor, objects, source_run_id=None)
                    relationships = [
                        InventoryRelationship("user", "perf-test-user-rel", "role", "perf-test-role-rel", "user_has_role"),
                    ]
                    await upsert_relationships(cursor, relationships, object_ids={}, source_run_id=None)

        async with self.pool.connection() as conn:
            row_cursor = await conn.execute(
                """
                SELECT r.relationship_type FROM public.cyberark_inventory_relationships r
                JOIN public.cyberark_inventory_objects s ON s.object_id = r.source_object_id
                WHERE s.source_id = 'perf-test-user-rel'
                """
            )
            rows = await row_cursor.fetchall()
        self.assertEqual([row["relationship_type"] for row in rows], ["user_has_role"])

    async def test_upsert_relationships_raises_when_an_endpoint_never_resolves(self):
        async with self.pool.connection() as conn:
            async with conn.transaction():
                async with conn.cursor() as cursor:
                    relationships = [
                        InventoryRelationship("user", "perf-test-missing-user", "role", "perf-test-missing-role", "user_has_role"),
                    ]
                    with self.assertRaises(ValueError):
                        await upsert_relationships(cursor, relationships, object_ids={}, source_run_id=None)


if __name__ == "__main__":
    import unittest
    unittest.main()
