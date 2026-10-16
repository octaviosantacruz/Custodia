"""Unit tests for the sanctioned person-email matching helper.

Fixtures are fabricated on purpose: the real tenant has no `component_user`
email user and no `EPVUser` in the technical domain, so the exclusions must be
proven with data that the database does not currently contain.
"""

import unittest

from app.cross.services.person_email_matching import (
    PAM_HUMAN_USER_TYPES,
    PERSON_EMAIL_SHAPE_SQL,
    is_excluded_person_email_domain,
    is_pam_human_user,
    normalize_person_email,
    pam_human_user_sql,
    person_email_sql,
    resolve_unique,
)


class NormalizePersonEmailTests(unittest.TestCase):
    def test_lowercases_and_trims(self):
        self.assertEqual(normalize_person_email("  Ada@Example.COM "), "ada@example.com")

    def test_rejects_values_without_a_single_valid_at(self):
        for value in (None, "", "   ", "adaexample.com", "a@b@c.com", "@example.com", "ada@", "ada@example"):
            with self.subTest(value=value):
                self.assertIsNone(normalize_person_email(value))

    def test_does_not_strip_plus_addressing_or_dots(self):
        self.assertEqual(normalize_person_email("ada+reports@example.com"), "ada+reports@example.com")
        self.assertEqual(normalize_person_email("a.da@example.com"), "a.da@example.com")

    def test_rejects_domains_without_labels_around_the_dot(self):
        # TEST-PROP-001: Hypothesis found the Python shape check accepting
        # "ada@." / "ada@.com" while PERSON_EMAIL_SHAPE_SQL (the SQL twin of
        # this predicate) rejects them; the sanctioned link must not be laxer
        # in Python than in SQL.
        for value in ("ada@.", "ada@.com", "ada@com.", "ada smith@example.com", "ada@exa mple.com"):
            with self.subTest(value=value):
                self.assertIsNone(normalize_person_email(value))


class ExcludedDomainTests(unittest.TestCase):
    def test_excludes_technical_tenant_domain(self):
        self.assertTrue(is_excluded_person_email_domain("svc@cyberark.cloud.23356"))
        self.assertTrue(is_excluded_person_email_domain("svc@cyberark.cloud"))
        self.assertTrue(is_excluded_person_email_domain("SVC@CYBERARK.CLOUD.23356"))

    def test_does_not_exclude_similar_domains(self):
        for value in ("ada@example.com", "ada@notcyberark.cloud.23356", "ada@cyberark.cloudx"):
            with self.subTest(value=value):
                self.assertFalse(is_excluded_person_email_domain(value))

    def test_invalid_values_are_not_excluded(self):
        self.assertFalse(is_excluded_person_email_domain(None))
        self.assertFalse(is_excluded_person_email_domain("sin-arroba"))


class PamHumanUserSqlTests(unittest.TestCase):
    def test_fragment_uses_only_the_declared_constants(self):
        sql = pam_human_user_sql("u")
        for user_type in PAM_HUMAN_USER_TYPES:
            self.assertIn(f"'{user_type}'", sql)
        self.assertIn("'cyberark.cloud'", sql)
        self.assertIn("'cyberark.cloud.%%'", sql)
        self.assertIn(PERSON_EMAIL_SHAPE_SQL, sql)
        self.assertIn("u.attributes->>'user_type' IN (", sql)
        self.assertIn("coalesce(u.attributes->>'component_user', 'false') <> 'true'", sql)
        self.assertIn(person_email_sql("u.source_id"), sql)

    def test_alias_is_configurable(self):
        self.assertIn("seat.attributes->>'user_type'", pam_human_user_sql("seat"))


class IsPamHumanUserTests(unittest.TestCase):
    def test_accepts_human_types_with_a_valid_email(self):
        self.assertTrue(is_pam_human_user("ada@example.com", {"user_type": "EPVUser"}))
        self.assertTrue(is_pam_human_user("ada@example.com", {"user_type": "ExtUser"}))

    def test_rejects_every_observed_service_type_and_unknown_values(self):
        for user_type in (
            "CyberArkServiceUser", "Install", "SaaSSRV", "SaasSRVUI",
            "PSM", "CPM", "PVWA", "Built-InAdmins", "ENE", "Telemetry",
            "FutureType", "",
        ):
            with self.subTest(user_type=user_type):
                self.assertFalse(is_pam_human_user("ada@example.com", {"user_type": user_type}))

    def test_rejects_component_users_even_when_the_type_is_human(self):
        self.assertFalse(
            is_pam_human_user("ada@example.com", {"user_type": "EPVUser", "component_user": "true"})
        )
        self.assertTrue(
            is_pam_human_user("ada@example.com", {"user_type": "EPVUser", "component_user": "false"})
        )

    def test_rejects_the_technical_tenant_domain(self):
        self.assertFalse(is_pam_human_user("svc@cyberark.cloud.23356", {"user_type": "EPVUser"}))

    def test_rejects_non_email_source_ids(self):
        self.assertFalse(is_pam_human_user("ada", {"user_type": "EPVUser"}))


class ResolveUniqueTests(unittest.TestCase):
    def test_matches_only_exactly_one_candidate(self):
        self.assertEqual(resolve_unique([]), {"status": "unmatched", "match": None})
        self.assertEqual(resolve_unique(["only"]), {"status": "matched", "match": "only"})
        self.assertEqual(resolve_unique(["a", "b"]), {"status": "ambiguous", "match": None})


if __name__ == "__main__":
    unittest.main()
