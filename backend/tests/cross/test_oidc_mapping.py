import os
import unittest
from unittest.mock import patch

from app.cross.services.oidc_mapping import roles_from_claims, warn_if_default_role_is_unscoped


class OidcMappingTests(unittest.TestCase):
    def test_maps_confirmed_itti_okta_groups_from_groups_claim(self):
        values = {
            "OIDC_GROUP_CLAIM": "groups",
            "OIDC_ROLE_MAP_JSON": '{"sg_ds-hub_lectores":"reader","sg_ds-hub_operadores":"operator","sg_ds-hub_admins":"admin"}',
        }
        with patch.dict(os.environ, values, clear=True):
            self.assertEqual(roles_from_claims({"groups": ["sg_ds-hub_lectores"]}), ["reader"])
            self.assertEqual(roles_from_claims({"groups": ["sg_ds-hub_operadores"]}), ["operator"])
            self.assertEqual(roles_from_claims({"groups": ["sg_ds-hub_admins"]}), ["admin"])
            self.assertEqual(roles_from_claims({"groups": ["sg_ds-hub_lectores", "sg_ds-hub_admins"]}), ["admin", "reader"])
            self.assertEqual(roles_from_claims({"groups": ["unrelated-group"]}), [])

    def test_maps_string_and_list_group_claims_without_duplicates(self):
        values = {
            "OIDC_ROLE_MAP_JSON": '{"security-admins":"admin","operators":"operator"}',
            "OIDC_GROUP_CLAIM": "groups",
        }
        with patch.dict(os.environ, values, clear=True):
            self.assertEqual(roles_from_claims({"groups": ["operators", "security-admins", "operators"]}), ["admin", "operator"])
            self.assertEqual(roles_from_claims({"groups": "operators"}), ["operator"])

    def test_uses_default_role_when_no_group_matches(self):
        values = {
            "OIDC_ROLE_MAP_JSON": '{"security-admins":"admin"}',
            "OIDC_DEFAULT_ROLE": "reader",
        }
        with patch.dict(os.environ, values, clear=True):
            self.assertEqual(roles_from_claims({"groups": ["unknown"]}), ["reader"])

    def test_claim_missing_entirely_behaves_like_an_empty_group_list(self):
        """Okta silently omits the groups claim from the ID token instead of
        sending an empty list once a user belongs to more groups than the
        claim's configured limit (commonly ~100) unless a Groups Claim
        Filter is set up on the authorization server. Both cases must fall
        through to the same default-role behavior -- there is no way for
        this code to tell "no groups" apart from "too many groups, omitted"
        without that filter configured on the IdP side, so it must never
        silently grant nothing (or something unexpected) either."""
        with patch.dict(os.environ, {"OIDC_ROLE_MAP_JSON": '{"security-admins":"admin"}', "OIDC_DEFAULT_ROLE": "reader"}, clear=True):
            self.assertEqual(roles_from_claims({}), ["reader"])
            self.assertEqual(roles_from_claims({"groups": []}), ["reader"])


class DefaultRoleWithoutMappingWarningTests(unittest.TestCase):
    def test_warns_when_default_role_is_set_but_the_map_is_empty(self):
        with patch.dict(os.environ, {"OIDC_DEFAULT_ROLE": "admin"}, clear=True):
            with self.assertLogs("app.cross.services.oidc_mapping", level="WARNING") as logs:
                warn_if_default_role_is_unscoped()
        self.assertIn("admin", logs.output[0])
        self.assertIn("OIDC_ROLE_MAP_JSON", logs.output[0])

    def test_does_not_warn_without_a_default_role(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertNoLogs("app.cross.services.oidc_mapping", level="WARNING"):
                warn_if_default_role_is_unscoped()

    def test_does_not_warn_when_the_map_is_actually_populated(self):
        values = {"OIDC_DEFAULT_ROLE": "reader", "OIDC_ROLE_MAP_JSON": '{"security-admins":"admin"}'}
        with patch.dict(os.environ, values, clear=True):
            with self.assertNoLogs("app.cross.services.oidc_mapping", level="WARNING"):
                warn_if_default_role_is_unscoped()


if __name__ == "__main__":
    unittest.main()
