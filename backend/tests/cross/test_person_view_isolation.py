"""CHAIN-010: the person view links only through the sanctioned email helper,
never persists an edge and never feeds coverage or KPIs."""

import pathlib
import unittest

APP_ROOT = pathlib.Path(__file__).resolve().parents[2] / "app"
PERSON_REPO = APP_ROOT / "cross/repositories/person_chain_queries.py"
PERSON_COVERAGE_REPO = APP_ROOT / "cross/repositories/person_client_coverage.py"
PERSON_COVERAGE_SERVICE = APP_ROOT / "cross/services/person_client_coverage.py"
PERSON_ROUTE = APP_ROOT / "cross/api/routes/chains_person.py"


class PersonViewIsolationTests(unittest.TestCase):
    def setUp(self):
        self.source = PERSON_REPO.read_text()
        self.route = PERSON_ROUTE.read_text()

    def test_resolution_goes_through_the_sanctioned_helper(self):
        self.assertIn("services.person_email_matching", self.source)
        self.assertIn("person_email_sql", self.source)
        self.assertIn("pam_human_user_sql", self.source)
        self.assertIn("resolve_unique", self.source)
        self.assertIn("is_excluded_person_email_domain", self.source)

    def test_never_persists_an_edge_or_writes_anything(self):
        for statement in ("INSERT", "UPDATE ", "DELETE", "UPSERT", "ALTER ", "CREATE "):
            self.assertNotIn(statement, self.source.upper(), f"person view must stay read-only: {statement}")

    def test_never_feeds_coverage_or_kpis(self):
        for token in ("coverage", "kpi", "dashboard", "widget", "analytics"):
            self.assertNotIn(token, self.source.lower())
        # The old search/detail contract stays disconnected; only the isolated
        # CONN-001 endpoint uses the dedicated read-only metric service.
        legacy_routes = self.route[
            self.route.index("async def person_search"):
            self.route.index('@router.get(\n    "/api/chains/person/coverage"')
        ]
        self.assertNotIn("get_person_client_coverage", legacy_routes)
        self.assertNotIn("person_client_coverage", self.source)
        self.assertIn('"/api/chains/person/coverage"', self.route)

    def test_coverage_exception_is_isolated_to_new_repository_and_service(self):
        repository = PERSON_COVERAGE_REPO.read_text()
        service = PERSON_COVERAGE_SERVICE.read_text()
        for source in (repository, service):
            self.assertIn("CONN-001", source)
        for statement in ("INSERT", "UPDATE ", "DELETE", "UPSERT", "ALTER ", "CREATE "):
            self.assertNotIn(statement, repository.upper())
        self.assertIn("identity:catalogs_read", self.route)
        self.assertIn("netskope:read", self.route)

    def test_route_gate_needs_a_tool_read_permission(self):
        self.assertIn("require_any_permission_read", self.route)
        for permission in ("access:manage", "pam:catalogs_read", "identity:catalogs_read", "netskope:read"):
            self.assertIn(f'"{permission}"', self.route)
        gate = self.route[
            self.route.index("READ = require_any_permission_read"):
            self.route.index("router = APIRouter")
        ]
        self.assertNotIn(
            "sia:catalogs_read", gate,
            "SIA cannot be the only permission for the person view",
        )
        self.assertIn('"sia:catalogs_read"', self.route)

    def test_sia_access_goes_only_through_the_sanctioned_grantee_rule(self):
        # 2026-10-05: SIA grantees (users and Identity roles) match only by exact
        # name in person_role_access.py, never with an ad-hoc predicate here.
        self.assertIn("sia_access_for_person", self.source)
        self.assertNotIn("policies_referencing_grantee", self.source)

    def test_netskope_summary_reuses_the_chain_device_filter(self):
        self.assertIn("user_matched_device_summary", self.source)
        self.assertIn("netskope_chain_expand", self.source)


if __name__ == "__main__":
    unittest.main()
