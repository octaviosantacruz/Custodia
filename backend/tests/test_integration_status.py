import os
import unittest
from unittest.mock import patch

from app.integrations.status import get_integration_status


class IntegrationStatusTests(unittest.TestCase):
    def test_missing_urls_are_not_configured(self):
        with patch.dict(os.environ, {}, clear=True):
            status = get_integration_status()
        self.assertEqual(status.identity_administration, "not_configured")
        self.assertEqual(status.sia, "not_configured")

    def test_partial_contract_is_reported_without_external_call(self):
        with patch.dict(
            os.environ,
            {"CA_IDENTITY_ADMIN_URL": "https://identity.example", "CA_SIA_URL": "https://sia.example"},
            clear=True,
        ):
            status = get_integration_status()
        self.assertEqual(status.identity_administration, "partially_configured")
        self.assertEqual(status.sia, "partially_configured")

    def test_complete_contract_is_reported_as_configured(self):
        with patch.dict(
            os.environ,
            {
                "CA_IDENTITY_ADMIN_URL": "https://identity.example",
                "CA_IDENTITY_ADMIN_TOKEN_URL": "https://identity.example/token",
                "CA_IDENTITY_ADMIN_CLIENT_ID": "client",
                "CA_IDENTITY_ADMIN_CLIENT_SECRET": "secret",
                "CA_IDENTITY_ADMIN_USERS_PATH": "/scim/v2/Users",
                "CA_IDENTITY_ADMIN_ROLES_PATH": "/scim/v2/Groups",
                "CA_SIA_URL": "https://sia.example",
                "CA_SIA_TOKEN_URL": "https://sia.example/token",
                "CA_SIA_CLIENT_ID": "client",
                "CA_SIA_CLIENT_SECRET": "secret",
                "CA_SIA_POLICIES_PATH": "/api/access-policies",
            },
            clear=True,
        ):
            status = get_integration_status()
        self.assertEqual(status.identity_administration, "configured")
        self.assertEqual(status.sia, "configured")


if __name__ == "__main__":
    unittest.main()
