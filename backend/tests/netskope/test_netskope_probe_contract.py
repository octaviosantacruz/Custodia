import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[3]
PROBE = ROOT / "scripts" / "probe_netskope_api.sh"


class NetskopeProbeContractTests(unittest.TestCase):
    def setUp(self):
        self.body = PROBE.read_text()
        allowlist_match = re.search(
            r"readonly -a APPROVED_PATHS=\(\n(?P<body>.*?)\n\)",
            self.body,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(allowlist_match)
        self.paths = set(re.findall(r'"([^"\n]+)"', allowlist_match.group("body")))

    def test_dem_read_only_collections_are_allowlisted(self):
        expected = {
            "/api/v2/dem/query/definitions",
            "/api/v2/dem/config/applications",
            "/api/v2/dem/config/gateways",
            "/api/v2/dem/config/sites",
            "/api/v2/dem/apps",
            "/api/v2/dem/appprobes",
            "/api/v2/dem/networkprobes",
            "/api/v2/dem/operatingsystems",
            "/api/v2/dem/monitoredapps",
            "/api/v2/dem/globalsettings",
            "/api/v2/dem/globalsettings/monitoredapps",
            "/api/v2/dem/alert/receiver/templates",
            "/api/v2/dem/alert/receivers",
            "/api/v2/dem/alert/rules",
            "/api/v2/dem/alert/rules/entities",
        }
        self.assertLessEqual(expected, self.paths)

    def test_rbac_read_only_collections_are_allowlisted(self):
        self.assertLessEqual(
            {
                "/api/v2/rbac/roles",
                "/api/v2/rbac/labels",
                "/api/v2/rbac/apigroups/pagemapping",
                "/api/v2/scim/Groups",
                "/api/v2/scim/Users",
                "/api/v2/platform/administration/scim/Users",
                "/api/v2/users/getgroups",
            },
            self.paths,
        )

    def test_high_return_graph_candidate_collections_are_allowlisted(self):
        self.assertLessEqual(
            {
                "/api/v2/deviceclassification/rules",
                "/api/v2/deviceclassification/tags",
                "/api/v2/deviceclassification/onpremdetection/steering",
                "/api/v2/policy/internetaccess/rules",
                "/api/v2/policy/internetaccess/rules/applied",
                "/api/v2/policy/internetaccess/groups",
                "/api/v2/profiles/destinations",
                "/api/v2/profiles/networks",
                "/api/v2/profiles/serviceobjects",
            },
            self.paths,
        )

    def test_probe_only_posts_to_the_read_only_query_allowlist(self):
        self.assertNotRegex(self.body, r"(?:--request|-X)\s+(?:PUT|PATCH|DELETE)\b")
        # The single POST is gated by is_post_path, i.e. APPROVED_POST_PATHS.
        self.assertEqual(len(re.findall(r"(?:--request|-X)\s+POST\b", self.body)), 1)
        post_match = re.search(
            r"readonly -a APPROVED_POST_PATHS=\(\n(?P<body>.*?)\n\)",
            self.body,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(post_match)
        post_paths = re.findall(r'"([^"\n]+)"', post_match.group("body"))
        self.assertTrue(post_paths)
        for path in post_paths:
            self.assertRegex(path, r"/(get[a-z]*|uci|inventory)$")
            self.assertNotRegex(path, r"/(create|update|delete|deploy|scan|upload|rotate|reset)")
        self.assertIn('PROBE_VERSION="NSK-API-001/v3"', self.body)

    def test_v3_adds_verified_read_routes(self):
        self.assertLessEqual(
            {
                "/api/v2/steering/ipsec/pops",
                "/api/v2/steering/ipsec/tunnels",
                "/api/v2/users/counts",
                "/api/v2/nsbrowser/licensesettings",
                "/api/v2/auth/tokens",
            },
            self.paths,
        )

if __name__ == "__main__":
    unittest.main()
