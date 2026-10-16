import unittest

from app.netskope.sse.services.netskope_mapping import map_netskope_group_memberships, map_netskope_groups


class NetskopeGroupMappingTests(unittest.TestCase):
    def test_groups_keep_only_the_approved_fields_and_unknown_counts_stay_unknown(self):
        objects = map_netskope_groups([
            {"id": "g1", "scimId": "s1", "displayName": "Ops", "provisioner": "AD", "userCount": 4,
             "lastModifiedBy": "someone@example.test", "created": 1.0, "collectionId": "c"},
            {"id": "g2", "displayName": "Ops", "provisioner": "SCIM"},
        ])
        self.assertEqual([(item.source_id, item.display_name, item.object_type) for item in objects],
                         [("g1", "Ops", "netskope_group"), ("g2", "Ops", "netskope_group")])
        self.assertEqual(objects[0].attributes, {"provisioner": "AD", "scim_id": "s1", "user_count": 4})
        self.assertEqual(objects[1].attributes, {"provisioner": "SCIM"})

    def test_deleted_groups_are_left_out_so_a_complete_run_retires_them(self):
        self.assertEqual(map_netskope_groups([{"id": "g1", "displayName": "Old", "deleted": True}]), [])

    def test_invalid_groups_fail_the_layer_instead_of_guessing(self):
        for group in ({"displayName": "x"}, {"id": "g1"}, {"id": "g1", "displayName": "x", "userCount": -1},
                      {"id": "g1", "displayName": "x", "userCount": "3"}):
            with self.subTest(group), self.assertRaises(ValueError):
                map_netskope_groups([group])
        with self.assertRaises(ValueError):
            map_netskope_groups([{"id": "g1", "displayName": "a"}, {"id": "g1", "displayName": "b"}])

    def test_memberships_follow_group_ids_and_count_each_pair_once(self):
        users = [
            {"id": "u1", "accounts": [{"parentGroups": ["g1", "g2", "gone"]}, {"parentGroups": ["g1"]}]},
            {"id": "u2", "accounts": [{"deleted": True, "parentGroups": ["g1"]}, {"parentGroups": ["Ops"]}]},
            {"id": "u3"}, {"id": "u4", "accounts": "unexpected"}, {"accounts": [{"parentGroups": ["g1"]}]},
        ]
        relationships, unresolved = map_netskope_group_memberships(users, {"g1", "g2"})
        self.assertEqual([(r.source_id, r.target_id, r.relationship_type, r.source_system) for r in relationships],
                         [("u1", "g1", "member_of", "netskope"), ("u1", "g2", "member_of", "netskope")])
        self.assertEqual(unresolved, 2)  # u1->gone and u2->"Ops" (a display name, never matched)
        self.assertTrue(all(r.target_type == "netskope_group" and r.source_type == "user" for r in relationships))


if __name__ == "__main__":
    unittest.main()
