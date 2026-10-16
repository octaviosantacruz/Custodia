import unittest

from app.cyberark.identity_administration.services.identity_federation_resolution import resolve_expected_federation, resolve_users_federations


def federation(object_id: int, name: str, active: bool = True) -> dict:
    return {"object_id": object_id, "display_name": name, "source_id": f"fed-{object_id}", "active": active}


class IdentityFederationResolutionTests(unittest.TestCase):
    def test_exact_domains_resolve_the_expected_federation(self):
        catalog = [federation(1, "Okta Ueno"), federation(2, "Okta-ITTI"), federation(3, "Okta UPAY")]
        self.assertEqual(resolve_expected_federation(" User@ITTI.DIGITAL ", catalog)["federation_code"], "okta_itti")
        self.assertEqual(resolve_expected_federation("user@ueno.com.py", catalog)["display_name"], "Okta Ueno")
        self.assertEqual(resolve_expected_federation("user@upay.com.py", catalog)["source_id"], "fed-3")

    def test_similar_domains_do_not_match(self):
        result = resolve_expected_federation("user@falso-itti.digital", [federation(2, "Okta ITTI")])
        self.assertEqual(result["status"], "unsupported_domain")

    def test_missing_and_ambiguous_federations_are_explicit(self):
        self.assertEqual(resolve_expected_federation("user@itti.digital", [federation(2, "Okta ITTI", False)])["status"], "missing_federation")
        result = resolve_expected_federation("user@itti.digital", [federation(2, "Okta ITTI"), federation(4, "Okta ITTI")])
        self.assertEqual(result["status"], "ambiguous")
        self.assertEqual(result["expected_name"], "Okta ITTI")

    def test_missing_email_has_a_distinct_status(self):
        self.assertEqual(resolve_expected_federation(None, [federation(1, "Okta Ueno")])["status"], "missing_email")
        self.assertEqual(resolve_expected_federation("not-an-email", [federation(1, "Okta Ueno")])["status"], "unsupported_domain")

    def test_users_are_enriched_from_one_catalog(self):
        users = [{"attributes": {"email": "person@ueno.com.py"}}, {"attributes": {"email": "other@example.com"}}]
        resolve_users_federations(users, [federation(1, "Okta Ueno")])
        self.assertEqual(users[0]["federation_resolution"]["status"], "matched")
        self.assertEqual(users[1]["federation_resolution"]["status"], "unsupported_domain")


if __name__ == "__main__":
    unittest.main()
