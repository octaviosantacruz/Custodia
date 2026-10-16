import os
import tempfile
import unittest
from unittest.mock import patch

from app.cross.integrations.status import get_integration_status


class IntegrationStatusTests(unittest.TestCase):
    def test_missing_urls_are_not_configured(self):
        with patch.dict(os.environ, {}, clear=True):
            status = get_integration_status()
        self.assertEqual(
            status,
            {
                "identity_administration": "not_configured",
                "sia": "not_configured",
                "access": "not_configured",
                "netskope": "not_configured",
            },
        )

    def test_partial_contract_is_reported_without_external_call(self):
        with patch.dict(
            os.environ,
            {"CA_IDENTITY_ADMIN_URL": "https://identity.example", "CA_SIA_URL": "https://sia.example"},
            clear=True,
        ):
            status = get_integration_status()
        self.assertEqual(status["identity_administration"], "partially_configured")
        self.assertEqual(status["sia"], "partially_configured")
        self.assertEqual(status["access"], "not_configured")
        self.assertEqual(status["netskope"], "not_configured")

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
        self.assertEqual(status["identity_administration"], "configured")
        self.assertEqual(status["sia"], "configured")

    def test_access_and_netskope_contracts_are_reported(self):
        with patch.dict(
            os.environ,
            {
                "CA_ACCESS_URL": "https://access.example",
                "CA_ACCESS_TOKEN_URL": "https://access.example/token",
                "CA_ACCESS_CLIENT_ID": "client",
                "CA_ACCESS_CLIENT_SECRET": "secret",
                "CA_ACCESS_ASSETS_PATH": "/api/assets",
                "NETSKOPE_URL": "https://tenant.example",
                "NETSKOPE_DEVICE_STATUS_PATH": "/api/v2/events/datasearch/clientstatus",
                "NETSKOPE_USERS_PATH": "/api/v2/users/getusers",
                "NETSKOPE_USER_COUNTS_PATH": "/api/v2/users/counts",
                "NETSKOPE_API_TOKEN": "token",
            },
            clear=True,
        ):
            status = get_integration_status()
        self.assertEqual(status["access"], "configured")
        self.assertEqual(status["netskope"], "configured")

    def test_secret_file_is_accepted_instead_of_the_secret_env(self):
        with tempfile.NamedTemporaryFile("w", suffix=".secret", delete=False) as handle:
            handle.write("token-from-file")
            secret_path = handle.name
        try:
            with patch.dict(
                os.environ,
                {
                    "NETSKOPE_URL": "https://tenant.example",
                    "NETSKOPE_DEVICE_STATUS_PATH": "/api/v2/events/datasearch/clientstatus",
                    "NETSKOPE_USERS_PATH": "/api/v2/users/getusers",
                    "NETSKOPE_USER_COUNTS_PATH": "/api/v2/users/counts",
                    "NETSKOPE_API_TOKEN_FILE": secret_path,
                },
                clear=True,
            ):
                status = get_integration_status()
        finally:
            os.unlink(secret_path)
        self.assertEqual(status["netskope"], "configured")


if __name__ == "__main__":
    unittest.main()
