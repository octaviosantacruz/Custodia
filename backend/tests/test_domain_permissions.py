import pathlib
import re
import unittest

MIGRATION = pathlib.Path(__file__).resolve().parents[2] / "migrations" / "023_domain_access_permissions.sql"


def _grants(sql: str) -> set[tuple[str, str]]:
    """Parse the ``(role_code, permission_code)`` tuples seeded by the migration."""
    body = sql.split("VALUES", 1)[1]
    return {
        (role, permission)
        for role, permission in re.findall(r"\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)", body)
    }


class DomainPermissionSeedTests(unittest.TestCase):
    def setUp(self):
        self.grants = _grants(MIGRATION.read_text())

    def test_pam_domain_granted_to_every_authenticated_role(self):
        for role in ("reader", "operator", "admin"):
            self.assertIn((role, "domain:pam"), self.grants)

    def test_admin_domain_is_admin_only(self):
        self.assertIn(("admin", "domain:admin"), self.grants)
        self.assertNotIn(("reader", "domain:admin"), self.grants)
        self.assertNotIn(("operator", "domain:admin"), self.grants)

    def test_dlp_and_dspm_are_not_granted_yet(self):
        granted_permissions = {grant[1] for grant in self.grants}
        self.assertNotIn("domain:dlp", granted_permissions)
        self.assertNotIn("domain:dspm", granted_permissions)

    def test_migration_is_idempotent(self):
        sql = MIGRATION.read_text()
        self.assertIn("ON CONFLICT (role_code, permission_code) DO NOTHING", sql)


if __name__ == "__main__":
    unittest.main()
