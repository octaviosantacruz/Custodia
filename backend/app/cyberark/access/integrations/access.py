"""Access space API client — cross-domain accessible assets (ACCESS-001).

Confirmed contract (2026-09-11, see docs/architecture/integration-contracts.md):
GET {base_url}/api/assets returns {assets: [...], diagnostics, nextToken, size}.
Reuses the same OAuth client-credentials flow (oauth2/platformtoken) and the
same client_id/secret already authorized for PVWA -- confirmed live, no new
credentials needed. The transport lives in oauth_client.py; this module keeps
Access space settings and endpoints.

Pagination for /api/assets has NOT been observed: every probe response so far
had a null nextToken (7 assets, one page). Rather than guess the cursor query
parameter name, get_assets() fails loudly if a non-null nextToken is ever
returned, exactly like get_policies() originally did for SIA before its
pagination contract was confirmed.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.cyberark.shared.integrations.oauth_client import OAuthClient, OAuthClientError


class AccessError(OAuthClientError):
    """A controlled Access space client error."""


class AccessNotConfigured(AccessError):
    """Raised when the approved API contract is not configured."""


@dataclass(frozen=True)
class AccessSettings:
    base_url: str
    token_url: str
    client_id: str
    client_secret: str
    assets_path: str
    request_timeout_seconds: float = 60.0
    max_retries: int = 5

    @classmethod
    def from_environment(cls) -> "AccessSettings":
        required = {
            "CA_ACCESS_URL": os.getenv("CA_ACCESS_URL", "").strip(),
            "CA_ACCESS_TOKEN_URL": os.getenv("CA_ACCESS_TOKEN_URL", "").strip(),
            "CA_ACCESS_CLIENT_ID": os.getenv("CA_ACCESS_CLIENT_ID", "").strip(),
            "CA_ACCESS_ASSETS_PATH": os.getenv("CA_ACCESS_ASSETS_PATH", "").strip(),
        }
        missing = [name for name, value in required.items() if not value]
        secret = os.getenv("CA_ACCESS_CLIENT_SECRET", "").strip()
        secret_file = os.getenv("CA_ACCESS_SECRET_FILE", "").strip()
        if not secret and secret_file and Path(secret_file).exists():
            secret = Path(secret_file).read_text(encoding="utf-8").strip()
        if not secret:
            missing.append("CA_ACCESS_CLIENT_SECRET o CA_ACCESS_SECRET_FILE")
        if missing:
            raise AccessNotConfigured("Faltan variables del contrato Access: " + ", ".join(missing))
        return cls(
            base_url=required["CA_ACCESS_URL"].rstrip("/"),
            token_url=required["CA_ACCESS_TOKEN_URL"],
            client_id=required["CA_ACCESS_CLIENT_ID"],
            client_secret=secret,
            assets_path=required["CA_ACCESS_ASSETS_PATH"],
        )


class AccessClient(OAuthClient):
    """Access space client: settings and endpoints on the shared transport."""

    error_type = AccessError
    not_configured_type = AccessNotConfigured
    label = "Access space"

    def _https_endpoints(self, settings: AccessSettings):
        return (
            ("CA_ACCESS_URL", settings.base_url),
            ("CA_ACCESS_TOKEN_URL", settings.token_url),
        )

    async def get_assets(self) -> list[dict[str, Any]]:
        payload = await self.get_json(self.settings.assets_path)
        if not isinstance(payload, dict):
            raise AccessError("Access devolvió un objeto inesperado para el listado de assets")
        assets = payload.get("assets")
        if not isinstance(assets, list) or not all(isinstance(item, dict) for item in assets):
            raise AccessError("La respuesta de assets no contiene assets[] de objetos")
        next_token = payload.get("nextToken")
        if next_token:
            raise AccessError(
                "Access devolvió un nextToken no nulo pero la paginación de /api/assets "
                "todavía no está confirmada; abortando para no devolver un listado incompleto"
            )
        return assets
