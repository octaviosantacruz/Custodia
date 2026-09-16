"""External CyberArk integration boundaries.

Concrete Identity Administration and SIA clients belong here. Their approved
contracts are explicit and their configuration status is reported without
making external calls. The inventory does not fabricate those records from the
Safes API.
"""

from .identity_admin import IdentityAdminClient, IdentityAdminError, IdentityAdminNotConfigured, IdentityAdminSettings
from .status import IntegrationStatus, get_integration_status

__all__ = ["IdentityAdminClient", "IdentityAdminError", "IdentityAdminNotConfigured", "IdentityAdminSettings", "IntegrationStatus", "get_integration_status"]
