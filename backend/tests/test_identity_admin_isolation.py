"""Guards the source_system isolation rule for Identity Administration."""
import pathlib
import unittest

REPOS = pathlib.Path(__file__).resolve().parents[1] / "app" / "repositories"
QUERIES = REPOS / "identity_admin_queries.py"
BRIDGE = REPOS / "identity_pam_bridge.py"
PAM_CHAIN = REPOS / "pam_chain_queries.py"
CMDB_ROUTE = pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "routes" / "cmdb.py"

PAM_ONLY_TOKENS = (
    "role_grants_access",
    "safe_uses_platform",
    "platform_uses_psm",
    "safe_members",
    "cyberark_accounts",
    "cyberark_safes",
)


class IdentityAdminIsolationTests(unittest.TestCase):
    def setUp(self):
        self.source = QUERIES.read_text()

    def test_source_system_constant_is_identity_administration(self):
        self.assertIn('SOURCE_SYSTEM = "identity_administration"', self.source)

    def test_no_pam_chain_tables_or_relationships(self):
        for token in PAM_ONLY_TOKENS:
            self.assertNotIn(token, self.source, f"Identity Administration query must not reference {token}")

    def test_does_not_query_the_pam_source_system(self):
        self.assertNotIn("source_system = 'cyberark'", self.source)
        self.assertNotIn('source_system = "cyberark"', self.source)
        self.assertNotIn("EPVUser", self.source)
        self.assertNotIn("Privilege Cloud", self.source)
        relationship_literals = {
            line.split("relationship_type")[1].split("'")[1]
            for line in self.source.splitlines()
            if "relationship_type = '" in line
        }
        self.assertEqual(relationship_literals, {"user_has_role"})


class IdentityPamBridgeTests(unittest.TestCase):
    """The sanctioned bridge remains deterministic and read-only."""

    def setUp(self):
        self.source = BRIDGE.read_text()
        self.code = self.source.split('"""', 2)[-1]
        self.pam_chain_source = PAM_CHAIN.read_text()

    def test_matches_only_by_exact_source_id_equality(self):
        self.assertIn("source_id = %s", self.code)
        self.assertNotIn("ILIKE", self.code.upper())
        for heuristic in ("display_name =", "display_name %s", "email", "user_name", "LIKE %"):
            self.assertNotIn(heuristic, self.code, f"bridge must not match by {heuristic!r}")

    def test_only_traverses_the_pam_chain_relationships(self):
        relationship_literals = {
            line.split("relationship_type")[1].split("'")[1]
            for line in self.pam_chain_source.splitlines()
            if "relationship_type = '" in line
        }
        self.assertEqual(relationship_literals, {"user_has_role", "role_grants_access", "safe_uses_platform", "platform_uses_psm"})

    def test_pam_side_is_the_cyberark_source_system(self):
        self.assertIn('PAM_SOURCE_SYSTEM = "cyberark"', self.pam_chain_source)
        self.assertIn("PAM_SOURCE_SYSTEM", self.source)
        self.assertNotIn("'sia'", self.source)
        self.assertNotIn("safe_members", self.source)
        self.assertNotIn("'sia'", self.pam_chain_source)
        self.assertNotIn("safe_members", self.pam_chain_source)

    def test_bridge_is_documented_as_the_sanctioned_exception(self):
        self.assertIn("integration-contracts.md", self.source)

    def test_standard_seat_annotation_matches_only_exact_source_id(self):
        self.assertIn("u.source_id = ANY(%s)", self.code)
        self.assertIn("list_standard_seat_source_ids", self.source)
        self.assertIn("annotate_identity_standard_seats", self.source)

    def test_route_reuses_the_identity_users_source_id_not_a_name(self):
        route = CMDB_ROUTE.read_text()
        self.assertIn("/api/cmdb/identity-users/{object_id}/pam-chain", route)
        self.assertIn('get_identity_user_pam_chain(request.app.state.db, user["source_id"])', route)
        self.assertIn("annotate_identity_standard_seats", route)
        self.assertIn("list_standard_seat_source_ids", route)


if __name__ == "__main__":
    unittest.main()
