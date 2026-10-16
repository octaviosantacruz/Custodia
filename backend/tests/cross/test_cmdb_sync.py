import unittest

from app.cross.cmdb_sync import (
    InventoryObject,
    InventoryRelationship,
    deduplicate_snapshot,
    normalize_object,
    normalize_relationship,
)


class CmdbSyncValidationTests(unittest.TestCase):
    def test_normalizes_type_and_uses_source_id_when_name_is_empty(self):
        item = normalize_object(
            InventoryObject(object_type=" SAFE ", source_id=" safe-1 ", display_name=" ")
        )
        self.assertEqual(item.object_type, "safe")
        self.assertEqual(item.source_id, "safe-1")
        self.assertEqual(item.display_name, "safe-1")

    def test_rejects_unknown_object_type(self):
        with self.assertRaises(ValueError):
            normalize_object(InventoryObject(object_type="account", source_id="1", display_name="A"))

    def test_normalizes_relationship_endpoints(self):
        item = normalize_relationship(
            InventoryRelationship("USER", "u1", "ROLE", "r1", "member_of")
        )
        self.assertEqual(item.source_type, "user")
        self.assertEqual(item.target_type, "role")

    def test_deduplicates_identical_observations(self):
        user = InventoryObject(object_type="user", source_id="u1", display_name="User")
        relationship = InventoryRelationship("user", "u1", "role", "r1", "user_has_role")
        objects, relationships = deduplicate_snapshot([user, user], [relationship, relationship])
        self.assertEqual(objects, [user])
        self.assertEqual(relationships, [relationship])

    def test_rejects_conflicting_duplicate_observation(self):
        with self.assertRaises(ValueError):
            deduplicate_snapshot(
                [
                    InventoryObject(object_type="user", source_id="u1", display_name="User A"),
                    InventoryObject(object_type="user", source_id="u1", display_name="User B"),
                ],
                [],
            )

    def test_rejects_relationship_without_type(self):
        with self.assertRaises(ValueError):
            normalize_relationship(InventoryRelationship("user", "u1", "role", "r1", ""))


if __name__ == "__main__":
    unittest.main()
