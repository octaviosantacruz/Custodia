import unittest

from app.services.access_mapping import SOURCE_SYSTEM, map_access_objects


class MapAccessObjectsTests(unittest.TestCase):
    def test_maps_confirmed_fields(self):
        assets = [{
            "assetId": "a1",
            "accessMethod": "RDP",
            "assetCategory": "server",
            "assetType": "windows",
            "platformType": "Windows",
            "platformSubtype": "Domain",
            "protocol": "rdp",
            "workflowStatus": "active",
            "isFavorite": True,
            "connectionComponents": ["PSM-RDP"],
            "customProperties": {"port": 3389, "logon_domain": "corp.example"},
            "fileCategories": {"LogonDomain": "corp.example"},
            "platformId": 509,
            "address": "10.0.0.5",
            "username": "svc-account",
        }]
        objects = map_access_objects(assets)
        self.assertEqual(len(objects), 1)
        obj = objects[0]
        self.assertEqual(obj.object_type, "access_asset")
        self.assertEqual(obj.source_system, SOURCE_SYSTEM)
        self.assertEqual(obj.source_id, "a1")
        self.assertEqual(obj.attributes["access_method"], "RDP")
        self.assertEqual(obj.attributes["connection_components"], ["PSM-RDP"])
        self.assertEqual(obj.attributes["port"], 3389)
        self.assertEqual(obj.attributes["platform_id"], "509")

    def test_excludes_host_and_credential_adjacent_fields(self):
        assets = [{
            "assetId": "a1",
            "address": "10.0.0.5",
            "username": "svc-account",
            "customProperties": {"port": 22, "logon_domain": "corp.example"},
            "fileCategories": {"LogonDomain": "corp.example"},
        }]
        obj = map_access_objects(assets)[0]
        serialized_keys = set(obj.attributes.keys())
        self.assertNotIn("address", serialized_keys)
        self.assertNotIn("username", serialized_keys)
        self.assertNotIn("logon_domain", serialized_keys)
        self.assertNotIn("file_categories", serialized_keys)
        self.assertNotIn("customProperties", serialized_keys)
        # Never leak the excluded raw values into any kept attribute either.
        self.assertNotIn("10.0.0.5", str(obj.attributes.values()))
        self.assertNotIn("svc-account", str(obj.attributes.values()))
        self.assertNotIn("corp.example", str(obj.attributes.values()))

    def test_requires_asset_id(self):
        with self.assertRaises(ValueError):
            map_access_objects([{"assetType": "windows"}])

    def test_handles_missing_platform_id_and_custom_properties(self):
        obj = map_access_objects([{"assetId": "a1"}])[0]
        self.assertEqual(obj.attributes["platform_id"], "")
        self.assertIsNone(obj.attributes["port"])
        self.assertEqual(obj.attributes["connection_components"], [])

    def test_is_favorite_defaults_to_false_for_non_boolean(self):
        obj = map_access_objects([{"assetId": "a1", "isFavorite": "yes"}])[0]
        self.assertFalse(obj.attributes["is_favorite"])


if __name__ == "__main__":
    unittest.main()
