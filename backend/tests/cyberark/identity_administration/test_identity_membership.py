import unittest
from app.cyberark.identity_administration.services.identity_membership import membership_graph


class IdentityMembershipTests(unittest.TestCase):
    def test_reachable_nodes_preserve_cycles_and_exclude_unrelated_or_missing_objects(self):
        nodes = [{"object_id": i, "source_id": str(i), "display_name": name,
                  "object_type": kind, "attributes": {"membership_status": "complete"}}
                 for i, name, kind in [(1, "Administration Role", "role"), (2, "System Administrator", "role"),
                                       (3, "sg_cyberark_admin", "role"), (4, "User", "user"), (5, "Unrelated", "role")]]
        edges = [{"parent_id": p, "member_id": m} for p, m in [(1, 2), (2, 3), (3, 4), (2, 1), (1, 999)]]
        result = membership_graph(1, nodes, edges)
        self.assertEqual([node["object_id"] for node in result["nodes"]], [1, 2, 3, 4])
        self.assertEqual(result["nodes"][2]["kind"], "okta_group")
        self.assertEqual(len(result["edges"]), 4)
        self.assertFalse(result["truncated"])
        limited = membership_graph(1, nodes, edges, limit=2)
        self.assertTrue(limited["truncated"])
        self.assertEqual(len(limited["nodes"]), 2)
        self.assertIsNone(membership_graph(4, nodes, edges))
        self.assertIsNone(membership_graph(999, nodes, edges))
