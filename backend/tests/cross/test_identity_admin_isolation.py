"""Guards the source_system isolation rule for Identity Administration."""
import pathlib
import re
import unittest

REPOS = pathlib.Path(__file__).resolve().parents[2] / "app"
QUERIES = REPOS / "cyberark/identity_administration/repositories/identity_admin_queries.py"
BRIDGE = REPOS / "cross/repositories/identity_pam_bridge.py"
PAM_CHAIN = REPOS / "cyberark/pam/repositories/pam_chain_queries.py"
CMDB_ROUTE = pathlib.Path(__file__).resolve().parents[2] / "app" / "cyberark/identity_administration/api/routes/cmdb_identity.py"
APP_ROOT = pathlib.Path(__file__).resolve().parents[2] / "app"

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
        self.assertEqual(relationship_literals, {"user_has_role", "identity_member_of"})


class IdentityPamBridgeTests(unittest.TestCase):
    """The sanctioned bridge remains deterministic and read-only."""

    def setUp(self):
        self.source = BRIDGE.read_text()
        self.code = self.source.split('"""', 2)[-1]
        self.pam_chain_source = PAM_CHAIN.read_text()

    def test_chain_traversal_matches_only_by_exact_source_id_equality(self):
        chain_code = self.code[self.code.index("async def get_identity_user_pam_chain"):]
        self.assertIn("resolve_identity_pam_user", chain_code)
        self.assertNotIn("ILIKE", self.code.upper())
        self.assertNotIn("LIKE %", self.code)
        for heuristic in ("display_name =", "display_name %s", "user_name"):
            self.assertNotIn(heuristic, chain_code, f"chain bridge must not match by {heuristic!r}")
        resolver_code = self.code[
            self.code.index("async def resolve_identity_pam_user"):
            self.code.index("async def get_identity_user_pam_chain")
        ]
        self.assertIn("source_id = %s", resolver_code)
        self.assertIn("person_email_sql", resolver_code)

    def test_bridge_email_matching_uses_the_shared_helper(self):
        """The sanctioned email rule (2026-09-25) must never be reimplemented:
        any email comparison in the bridge goes through the shared helper."""
        self.assertIn("person_email_matching", self.source)
        if "->>'email'" in self.code:
            self.assertIn("person_email_sql", self.source)

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

    def test_standard_seat_annotation_matches_only_exact_unique_email(self):
        self.assertIn('person_email_sql("u.display_name")', self.code)
        self.assertIn("= ANY(%s)", self.code)
        self.assertIn("HAVING count(*) = 1", self.code)
        self.assertIn("normalize_person_email", self.code)
        self.assertIn("list_standard_seat_emails", self.source)
        self.assertIn("annotate_identity_standard_seats", self.source)

    def test_route_reuses_the_identity_users_source_id_not_a_name(self):
        route = CMDB_ROUTE.read_text()
        self.assertIn("/api/cmdb/identity-users/{object_id}/pam-chain", route)
        self.assertIn("get_identity_user_pam_chain(", route)
        self.assertIn('user["source_id"]', route)
        self.assertIn('(user.get("attributes") or {}).get("email")', route)
        self.assertIn("annotate_identity_standard_seats", route)
        self.assertIn("list_standard_seat_emails", route)


class IdentityChainIsolationTests(unittest.TestCase):
    def test_chain_modules_never_write_or_feed_coverage(self):
        for name in ("cyberark/pam/repositories/pam_chain_expand.py", "cross/repositories/identity_pam_bridge.py"):
            source = (REPOS / name).read_text()
            code = source.split('"""', 2)[-1].upper()
            for token in ("INSERT ", "UPDATE ", "DELETE ", "UPSERT", "COVERAGE"):
                self.assertNotIn(token, code, f"{name} must stay read-only and outside coverage")


class PersonEmailMatchingIsolationTests(unittest.TestCase):
    """The sanctioned email rule has exactly one implementation.

    Scans the application for raw email comparisons and for user comparisons
    inside chain/person/bridge modules. Existing intra-source uses are
    allowlisted with a reason; any new occurrence must go through
    ``services/person_email_matching.py``.
    """

    HELPER_REL = "cross/services/person_email_matching.py"
    EMAIL_OPERATOR = re.compile(r"(?:=|<>|!=|ILIKE|LIKE|\?|ANY\s*\()", re.IGNORECASE)
    HELPER_CALL = re.compile(r"person_email_sql\([^)]*\)")
    RAW_USER_COMPARISON = re.compile(
        r"\b(source_id|display_name)\s*(?:=|<>|!=|ILIKE|LIKE)\b", re.IGNORECASE
    )
    CHAIN_MODULE_TOKENS = ("chain", "person", "bridge")
    ALLOWED_EMAIL_COMPARISON_MODULES = {
        "netskope/sse/repositories/netskope_inventory.py": "correlación observed_user intra-Netskope, previa a la excepción",
        "netskope/sse/repositories/netskope_shared.py": "expresión de correo compartida intra-Netskope, previa a la excepción",
        "cyberark/identity_administration/repositories/identity_admin_queries.py": "filtros de lectura intra-Identity, previos a la excepción",
        "cross/repositories/search.py": "búsqueda global intra-fuente, previa a la excepción",
        "netskope/sse/repositories/netskope_chain_expand.py": (
            "correlación exacta intra-Netskope entre username y email observado; no es un vínculo "
            "de persona entre fuentes y queda aislada del helper PAM"
        ),
        "cross/repositories/person_client_coverage.py": (
            "excepción CONN-001/v1: match entre fuentes sólo con person_email_sql y regla 1 a 1"
        ),
    }
    ALLOWED_CHAIN_USER_COMPARISON_MODULES = {
        "cyberark/pam/repositories/pam_chain_queries.py": "traversal PAM intra-fuente por object_id/source_id",
        "cross/repositories/identity_pam_bridge.py": "puente sancionado: UUID por source_id exacto",
        "cyberark/pam/repositories/pam_chain_expand.py": (
            "expansión PAM: une plataformas por source_id contra el platform_id de Access "
            "(excepción sancionada), sin match de personas"
        ),
        "netskope/sse/repositories/netskope_chain_expand.py": (
            "cadena Netskope: correlación observada intra-fuente, no puente de personas entre fuentes"
        ),
        "cross/repositories/person_chain_queries.py": (
            "vista por persona: búsqueda difusa por nombre en el buscador; el vínculo exacto "
            "de cada herramienta va por person_email_sql y la regla 1 a 1"
        ),
        "cross/repositories/person_client_coverage.py": (
            "excepción CONN-001/v1: población Identity y match exacto 1-a-1 con Netskope, sólo lectura"
        ),
    }

    def test_email_comparisons_only_live_in_the_shared_helper(self):
        offenders: list[str] = []
        for path in sorted(APP_ROOT.rglob("*.py")):
            relative = path.relative_to(APP_ROOT).as_posix()
            if relative == self.HELPER_REL or relative in self.ALLOWED_EMAIL_COMPARISON_MODULES:
                continue
            for number, line in enumerate(path.read_text().splitlines(), start=1):
                without_helper_call = self.HELPER_CALL.sub("", line)
                if "->>'email'" in without_helper_call and self.EMAIL_OPERATOR.search(without_helper_call):
                    offenders.append(f"{relative}:{number}")
        self.assertEqual(
            offenders, [],
            "email comparisons must import services/person_email_matching.py: " + ", ".join(offenders),
        )

    def test_chain_and_person_modules_compare_users_through_the_helper(self):
        offenders: list[str] = []
        for path in sorted(APP_ROOT.rglob("*.py")):
            relative = path.relative_to(APP_ROOT).as_posix()
            if relative in self.ALLOWED_CHAIN_USER_COMPARISON_MODULES:
                continue
            if not any(token in path.name for token in self.CHAIN_MODULE_TOKENS):
                continue
            for number, line in enumerate(path.read_text().splitlines(), start=1):
                if self.RAW_USER_COMPARISON.search(line):
                    offenders.append(f"{relative}:{number}")
        self.assertEqual(
            offenders, [],
            "chain/person modules must compare users through the shared helper: " + ", ".join(offenders),
        )

    def test_sia_person_link_repository_is_included_in_both_email_audits(self):
        relative = "cross/repositories/sia_person_links.py"
        self.assertTrue((APP_ROOT / relative).is_file())
        self.assertNotIn(relative, self.ALLOWED_EMAIL_COMPARISON_MODULES)
        self.assertNotIn(relative, self.ALLOWED_CHAIN_USER_COMPARISON_MODULES)


if __name__ == "__main__":
    unittest.main()
