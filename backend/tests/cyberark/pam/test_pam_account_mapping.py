import unittest

from app.cyberark.pam.services.pam_account_mapping import normalize_accounts


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

    def test_maps_only_allowlisted_secret_management_fields(self):
        rows, skipped = normalize_accounts(
            [{
                "id": "account-1", "safeName": "SAFE-1", "secretManagement": {
                    "automaticManagementEnabled": True,
                    "status": " SUCCESS ",
                    "lastModifiedTime": 1_700_000_000,
                    "manualManagementReason": "sensitive free text",
                    "platformAccountProperties": {"private": "value"},
                    "lastModifiedBy": "operator@example.test",
                    "secretType": "password",
                },
            }],
            {"SAFE-1": "101"},
            {},
        )

        attributes = rows[0]["attributes"]
        self.assertEqual(skipped, 0)
        self.assertIs(attributes["automatic_management_enabled"], True)
        self.assertEqual(attributes["management_status"], "success")
        self.assertEqual(attributes["secret_modified_at"], "2023-11-14T22:13:20Z")
        serialized = str(attributes)
        for excluded in (
            "manualManagementReason", "sensitive free text", "platformAccountProperties",
            "private", "lastModifiedBy", "operator@example.test", "secretType",
        ):
            self.assertNotIn(excluded, serialized)

    def test_missing_partial_and_unrecognized_values_stay_unknown(self):
        rows, skipped = normalize_accounts(
            [
                {"id": "absent", "safeName": "SAFE-1"},
                {"id": "partial", "safeName": "SAFE-1", "secretManagement": {
                    "automaticManagementEnabled": "false", "status": "manual", "lastModifiedTime": True,
                }},
                {"id": "unknown-status", "safeName": "SAFE-1", "secretManagement": {
                    "automaticManagementEnabled": False, "status": "futureState",
                }},
                {"id": "in-process", "safeName": "SAFE-1", "secretManagement": {
                    "automaticManagementEnabled": True, "status": "InProcess",
                }},
            ],
            {"SAFE-1": "101"},
            {},
        )

        self.assertEqual(skipped, 0)
        self.assertIsNone(rows[0]["attributes"]["automatic_management_enabled"])
        self.assertIsNone(rows[0]["attributes"]["management_status"])
        self.assertIsNone(rows[0]["attributes"]["secret_modified_at"])
        self.assertIsNone(rows[1]["attributes"]["automatic_management_enabled"])
        self.assertIsNone(rows[1]["attributes"]["management_status"])
        self.assertIsNone(rows[1]["attributes"]["secret_modified_at"])
        self.assertIs(rows[2]["attributes"]["automatic_management_enabled"], False)
        self.assertIsNone(rows[2]["attributes"]["management_status"])
        self.assertEqual(rows[3]["attributes"]["management_status"], "in_process")

    def test_invalid_epoch_values_are_not_interpreted_as_dates(self):
        invalid_epochs = (0, -1, 4_102_444_800, True, "1700000000", 1_700_000_000.0)
        payloads = [
            {"id": f"account-{index}", "safeName": "SAFE-1", "secretManagement": {"lastModifiedTime": value}}
            for index, value in enumerate(invalid_epochs)
        ]
        rows, skipped = normalize_accounts(payloads, {"SAFE-1": "101"}, {})

        self.assertEqual(skipped, 0)
        self.assertEqual([row["attributes"]["secret_modified_at"] for row in rows], [None] * len(invalid_epochs))

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
