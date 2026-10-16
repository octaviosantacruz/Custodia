"""Historical device review filters and suggestions that do not need a database."""

import unittest

from app.netskope.sse.repositories.netskope_device_reviews import (
    ATTENTIONS, DIAGNOSES, SUGGESTIONS, review_filter_clause, suggestion_sql,
)

class DeviceReviewRuleTests(unittest.TestCase):
    def test_filter_clause_is_parameterized_and_rejects_unknown_values(self):
        clause, params = review_filter_clause("replaced", "pending")
        self.assertEqual(params, ["replaced", "pending"])
        self.assertNotIn("replaced", clause)
        undetermined, _ = review_filter_clause("undetermined", "")
        self.assertIn("NOT EXISTS", undetermined)
        for args in (("x", ""), ("", "x")):
            with self.assertRaises(ValueError):
                review_filter_clause(*args)
        self.assertEqual(review_filter_clause("", ""), ("", []))
        self.assertEqual(len(set(DIAGNOSES)), 7)

    def test_attention_and_suggestion_filters_are_whitelisted(self):
        for kwargs in ({"attention": "made_up"}, {"suggestion": "decommissioned"}):
            with self.assertRaises(ValueError):
                review_filter_clause("", "", **kwargs)
        for attention in ATTENTIONS:
            clause, params = review_filter_clause("", "", attention=attention)
            self.assertTrue(clause)
            self.assertEqual(params, [])
        clause, params = review_filter_clause("", "", suggestion="replaced")
        self.assertEqual(params, ["replaced"])
        # The requested value travels as a parameter, never inside the SQL text.
        self.assertTrue(clause.endswith("= %s"))

    def test_suggestions_are_only_the_diagnoses_with_reported_evidence(self):
        self.assertEqual(SUGGESTIONS, ("uninstalled_reported", "replaced", "historical_record"))
        self.assertTrue(set(SUGGESTIONS) <= set(DIAGNOSES))
        sql = suggestion_sql()
        # Heartbeat and user_status never take part in a suggestion.
        self.assertNotIn("heartbeat", sql)
        self.assertNotIn("user_status", sql)
        self.assertLess(sql.index("uninstalled_reported"), sql.index("replaced"))
        self.assertLess(sql.index("replaced"), sql.index("historical_record"))
