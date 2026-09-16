import unittest

from app.services.pam_account_mapping import normalize_accounts


class PamAccountMappingTests(unittest.TestCase):
    def test_normalizes_supported_account_shapes_without_secrets(self):
        rows, skipped = normalize_accounts(
            [{
                "id": 123, "safeName": "SAFE-1", "name": "svc-db",
                "userName": "svc-db", "platformId": "Unix",
                "address": "10.0.0.1", "accountType": "service", "password": "secret",
            }],
            {"SAFE-1": "101"},
            {"Unix": "Unix Platform"},
        )
        self.assertEqual(skipped, 0)
        self.assertEqual(rows[0]["account_id"], "123")
        self.assertEqual(rows[0]["safe_number"], 101)
        self.assertNotIn("password", rows[0])

    def test_skips_accounts_without_safe_or_identifier(self):
        rows, skipped = normalize_accounts(
            [{"safeName": "UNKNOWN", "name": "svc"}, {"safeName": "SAFE-1"}],
            {"SAFE-1": "101"},
            {},
        )
        self.assertEqual(rows, [])
        self.assertEqual(skipped, 2)


if __name__ == "__main__":
    unittest.main()
