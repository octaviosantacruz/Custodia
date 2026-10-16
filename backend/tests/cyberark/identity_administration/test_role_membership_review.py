import unittest

from app.cyberark.identity_administration.services.identity_admin_mapping import map_identity_admin_objects
from app.cyberark.identity_administration.services.role_membership_review import review_role_memberships, review_role_memberships_detailed


class RoleMembershipReviewTests(unittest.TestCase):
    def test_distinguishes_direct_matches_from_inherited_users_without_inventing_permissions(self):
        groups = [
            {"id": "parent", "displayName": "Parent", "members": [{"value": "child", "type": "Group"}]},
            {"id": "child", "displayName": "Child", "members": [{"value": "user", "type": "User", "display": "User without profile"}]},
            {"id": "copy", "displayName": "Copy", "members": [{"value": "user", "type": "User"}]},
            {"id": "empty", "displayName": "Empty", "members": []},
            {"id": "empty2", "displayName": "Empty 2", "members": []},
            {"id": "partial", "displayName": "Partial"},
            {"id": "missing", "displayName": "Missing role", "members": [{"value": "absent", "type": "Group"}]},
        ]
        objects, edges = map_identity_admin_objects([], groups)
        result = review_role_memberships(objects, edges)
        self.assertEqual(result["same_direct_members"], [{"roles": ["Child", "Copy"], "direct_members": 1}])
        self.assertEqual(result["same_user_references"], [{"roles": ["Child", "Copy", "Parent"], "referenced_accounts": 1}])
        self.assertEqual(result["roles_with_incomplete_user_paths"], ["Missing role", "Partial"])
        self.assertEqual(result["permissions_status"], "not_collected")

    def test_cycles_terminate_and_distinct_account_ids_do_not_match_by_email_or_name(self):
        groups = [
            {"id": "a", "displayName": "A", "members": [{"value": "b", "type": "Group"}, {"value": "first", "type": "User"}]},
            {"id": "b", "displayName": "B", "members": [{"value": "a", "type": "Group"}]},
            {"id": "c", "displayName": "C", "members": [{"value": "second", "type": "User"}]},
        ]
        objects, edges = map_identity_admin_objects([], groups)
        result = review_role_memberships(objects, edges)
        self.assertEqual(result["same_direct_members"], [])
        self.assertEqual(result["same_user_references"], [{"roles": ["A", "B"], "referenced_accounts": 1}])
        detailed = review_role_memberships_detailed(objects, edges)
        self.assertEqual([role["name"] for role in detailed["same_user_references"][0]["roles"]], ["A", "B"])
        self.assertTrue(all(len({step["id"] for step in role["traversal"]}) == len(role["traversal"]) for role in detailed["same_user_references"][0]["roles"]))

    def test_detailed_matches_have_role_ids_deterministic_traversal_and_counts_only(self):
        groups = [
            {"id": "root-z", "displayName": "Z Root", "members": [{"value": "leaf-z", "type": "Group"}]},
            {"id": "root-a", "displayName": "A Root", "members": [{"value": "leaf-a", "type": "Group"}]},
            {"id": "leaf-z", "displayName": "Z Leaf", "members": [{"value": "account-z", "type": "User"}]},
            {"id": "leaf-a", "displayName": "A Leaf", "members": [{"value": "account-a", "type": "User"}]},
        ]
        objects, edges = map_identity_admin_objects([], groups)
        first = review_role_memberships_detailed(objects, edges)
        second = review_role_memberships_detailed(list(reversed(objects)), list(reversed(edges)))
        self.assertEqual(first, second)
        group = first["same_user_references"][0]
        # root-a and leaf-a reach the same account set ({account-a}), so they
        # form the single match; root-z reaches a different account and does not.
        self.assertEqual([role["id"] for role in group["roles"]], ["leaf-a", "root-a"])
        self.assertEqual([step["id"] for step in group["roles"][1]["traversal"]], ["root-a", "leaf-a"])
        self.assertEqual(group["referenced_accounts"], 1)
        serialized = repr(first)
        self.assertNotIn("account-a", serialized)
        self.assertNotIn("account-z", serialized)

    def test_empty_memberships_do_not_form_a_match(self):
        objects, edges = map_identity_admin_objects([], [
            {"id": "empty-1", "displayName": "Empty 1", "members": []},
            {"id": "empty-2", "displayName": "Empty 2", "members": []},
        ])
        result = review_role_memberships_detailed(objects, edges)
        self.assertEqual(result["same_direct_members"], [])
        self.assertEqual(result["same_user_references"], [])
