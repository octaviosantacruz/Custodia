from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class IntegrationStatus:
    identity_administration: str
    sia: str


def _source_status(required: tuple[str, ...], secret_name: str, secret_file_name: str) -> str:
    configured_values = sum(bool(os.getenv(name, '').strip()) for name in required)
    secret_configured = bool(os.getenv(secret_name, '').strip())
    secret_file = os.getenv(secret_file_name, '').strip()
    if not secret_configured and secret_file:
        secret_configured = Path(secret_file).is_file()
    if configured_values == 0 and not secret_configured:
        return 'not_configured'
    if configured_values == len(required) and secret_configured:
        return 'configured'
    return 'partially_configured'


def get_integration_status() -> IntegrationStatus:
    """Report approved contract configuration without making external calls."""
    return IntegrationStatus(
        identity_administration=_source_status(
            (
                'CA_IDENTITY_ADMIN_URL',
                'CA_IDENTITY_ADMIN_TOKEN_URL',
                'CA_IDENTITY_ADMIN_CLIENT_ID',
                'CA_IDENTITY_ADMIN_USERS_PATH',
                'CA_IDENTITY_ADMIN_ROLES_PATH',
            ),
            'CA_IDENTITY_ADMIN_CLIENT_SECRET',
            'CA_IDENTITY_ADMIN_SECRET_FILE',
        ),
        sia=_source_status(
            (
                'CA_SIA_URL',
                'CA_SIA_TOKEN_URL',
                'CA_SIA_CLIENT_ID',
                'CA_SIA_POLICIES_PATH',
            ),
            'CA_SIA_CLIENT_SECRET',
            'CA_SIA_SECRET_FILE',
        ),
    )
