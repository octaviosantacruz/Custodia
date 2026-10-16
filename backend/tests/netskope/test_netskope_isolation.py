"""Guards the source_system isolation rule for the Netskope queries."""
import pathlib
import unittest

REPOS = pathlib.Path(__file__).resolve().parents[2] / "app" / "netskope/sse/repositories"
NETSKOPE_MODULES = (
    REPOS / "netskope_queries.py",
    REPOS / "netskope_shared.py",
    REPOS / "netskope_metrics.py",
    REPOS / "netskope_inventory.py",
    REPOS / "netskope_compliance.py",
    REPOS / "netskope_chain_expand.py",
    REPOS / "netskope_dlp_queries.py",
)

OTHER_SOURCE_TOKENS = (
    "safe_members",
    "cyberark_accounts",
    "role_grants_access",
    "user_has_role",
    "safe_uses_platform",
    "platform_uses_psm",
    "source_system = 'cyberark'",
    "source_system = 'sia'",
    "source_system = 'identity_administration'",
    "identity_administration",
    "'sia'",
)


class NetskopeIsolationTests(unittest.TestCase):
    def test_source_system_constant_is_netskope(self):
        shared = (REPOS / "netskope_shared.py").read_text(encoding="utf-8")
        self.assertIn('SOURCE_SYSTEM = "netskope"', shared)

    def test_queries_never_reference_another_source(self):
        for module in NETSKOPE_MODULES:
            source = module.read_text(encoding="utf-8")
            for token in OTHER_SOURCE_TOKENS:
                self.assertNotIn(
                    token, source, f"{module.name} must not reference {token}"
                )

    def test_inventory_scoping_uses_the_netskope_constant(self):
        # The generic CMDB tables are shared infrastructure; every query over
        # them must scope by the SOURCE_SYSTEM parameter instead of a literal.
        for module in NETSKOPE_MODULES:
            source = module.read_text(encoding="utf-8")
            if "cyberark_inventory_objects" not in source:
                continue
            self.assertIn("source_system = %s", source, module.name)


if __name__ == "__main__":
    unittest.main()
