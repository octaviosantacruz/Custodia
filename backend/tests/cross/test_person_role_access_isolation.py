"""The role-name exception (approved 2026-10-05) keeps its strict, read-only shape."""

import pathlib
import unittest

APP = pathlib.Path(__file__).resolve().parents[2] / "app"
MODULE = APP / "cross/repositories/person_role_access.py"
CONTRACTS = pathlib.Path(__file__).resolve().parents[3] / "docs/architecture/integration-contracts.md"


class PersonRoleAccessIsolationTests(unittest.TestCase):
    def setUp(self):
        self.source = MODULE.read_text()
        self.code = self.source.split('"""', 2)[-1]

    def test_links_roles_only_by_exact_name_unique_on_both_sides(self):
        self.assertIn("USING (name)", self.code)
        self.assertIn("identity_total = 1 AND pam_total = 1", self.code)
        for fuzzy in ("ILIKE", "LIKE", "lower(", "similarity", "levenshtein", "~"):
            self.assertNotIn(fuzzy, self.code, f"role names must match exactly, never with {fuzzy!r}")

    def test_sia_grantees_match_only_by_exact_name_and_unique_identity_role(self):
        sia = self.code[self.code.index("_SIA_ACCESS_SQL"):]
        self.assertIn("p.attributes->'granted_users' ? u.name", sia)
        self.assertIn("p.attributes->'granted_roles' ? l.name", sia)
        self.assertIn("WHERE identity_total = 1", sia)
        self.assertIn("WHERE n.total = 1", sia)
        self.assertNotIn("granted_groups", sia)

    def test_only_reads_role_membership_and_role_to_safe_edges(self):
        relationship_literals = {
            line.split("relationship_type")[1].split("'")[1]
            for line in self.code.splitlines()
            if "relationship_type = '" in line
        }
        self.assertEqual(relationship_literals, {"user_has_role", "role_grants_access"})
        for token in ("INSERT ", "UPDATE ", "DELETE ", "coverage", "safe_members", "cyberark_accounts"):
            self.assertNotIn(token, self.code)

    def test_is_used_only_by_the_person_view(self):
        users = sorted(
            path.relative_to(APP).as_posix()
            for path in APP.rglob("*.py")
            if path != MODULE and "person_role_access" in path.read_text()
        )
        self.assertEqual(users, ["cross/repositories/person_chain_queries.py"])

    def test_the_exception_is_documented_with_its_approval(self):
        contracts = CONTRACTS.read_text()
        self.assertIn("person_role_access.py", contracts)
        self.assertIn("2026-10-05", contracts)
        self.assertIn("integration-contracts.md", self.source)
