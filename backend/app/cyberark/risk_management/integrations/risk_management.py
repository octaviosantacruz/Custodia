"""Read-only CyberArk Risk Management client (RISK-001)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.cyberark.shared.integrations.oauth_client import OAuthClient, OAuthClientError


class RiskManagementError(OAuthClientError):
    """Controlled Risk Management client error."""


class RiskManagementLimitError(RiskManagementError):
    """A full read exceeded its bounded item count; the caller can fall back to pages."""


class RiskManagementNotConfigured(RiskManagementError):
    """Raised when the shared CyberArk OAuth contract is unavailable."""


@dataclass(frozen=True)
class RiskManagementSettings:
    base_url: str
    token_url: str
    client_id: str
    client_secret: str
    request_timeout_seconds: float = 60.0
    max_retries: int = 5

    @classmethod
    def from_environment(cls) -> "RiskManagementSettings":
        pvwa_url = os.getenv("CA_PVWA_URL", "").strip()
        identity_url = os.getenv("CA_IDENTITY_URL", "").strip()
        client_id = os.getenv("CA_CLIENT_ID", "").strip()
        parsed = urlparse(pvwa_url)
        suffix = ".privilegecloud.cyberark.cloud"
        host = (parsed.hostname or "").lower()
        tenant = host[: -len(suffix)] if host.endswith(suffix) else ""
        missing = []
        if parsed.scheme != "https" or not tenant or "." in tenant:
            missing.append("CA_PVWA_URL con host Privilege Cloud")
        if not identity_url:
            missing.append("CA_IDENTITY_URL")
        if not client_id:
            missing.append("CA_CLIENT_ID")
        secret = os.getenv("CA_CLIENT_SECRET", "").strip()
        secret_file = os.getenv("CA_SECRET_FILE", ".ca_secret").strip()
        if not secret and secret_file and Path(secret_file).is_file():
            secret = Path(secret_file).read_text(encoding="utf-8").strip()
        if not secret:
            missing.append("CA_CLIENT_SECRET o CA_SECRET_FILE")
        if missing:
            raise RiskManagementNotConfigured(
                "Faltan variables del contrato Risk Management: " + ", ".join(missing)
            )
        return cls(
            base_url=f"https://{tenant}.compass.cyberark.cloud",
            token_url=f"{identity_url.rstrip('/')}/oauth2/platformtoken",
            client_id=client_id,
            client_secret=secret,
        )


class RiskManagementClient(OAuthClient):
    """GET-only Risk Management surface on the shared OAuth transport."""

    error_type = RiskManagementError
    not_configured_type = RiskManagementNotConfigured
    label = "CyberArk Risk Management"
    expect_json_object = True
    _PAGE_SIZE = 100
    _MAX_ITEMS = 20_000
    # Upper bound for reading every finding in one request (grouped view);
    # beyond it the UI keeps the paginated reading instead.
    MAX_GROUPED_FINDINGS = 2_000

    def _https_endpoints(self, settings: RiskManagementSettings):
        return (("CyberArk Compass", settings.base_url), ("CA_IDENTITY_URL", settings.token_url))

    async def _page(self, path: str, key: str, limit: int, offset: int) -> dict[str, Any]:
        separator = "&" if "?" in path else "?"
        payload = await self.get_json(f"{path}{separator}limit={limit}&offset={offset}")
        items = payload.get(key)
        if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
            raise RiskManagementError(f"Risk Management no devolvió {key}[] de objetos")
        is_last_page = payload.get("isLastPage")
        if not isinstance(is_last_page, bool):
            raise RiskManagementError("Risk Management no devolvió isLastPage booleano")
        return {key: items, "limit": limit, "offset": offset, "isLastPage": is_last_page}

    async def _all(self, path: str, key: str, max_items: int | None = None) -> list[dict[str, Any]]:
        limit = self._MAX_ITEMS if max_items is None else max_items
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = await self._page(path, key, self._PAGE_SIZE, offset)
            items = page[key]
            rows.extend(items)
            if len(rows) > limit:
                raise RiskManagementLimitError(f"Risk Management superó el límite de {limit} {key}")
            if page["isLastPage"]:
                return rows
            if not items:
                raise RiskManagementError("Risk Management devolvió una página vacía que no era la última")
            offset += len(items)

    async def get_summary(self) -> dict[str, Any]:
        return await self.get_json("/risks/summary")

    async def get_risk_types(self) -> list[dict[str, Any]]:
        return await self._all("/risks/risk-types", "riskTypes")

    async def get_findings_page(self, limit: int, offset: int) -> dict[str, Any]:
        return await self._page("/risks/findings", "findings", limit, offset)

    async def get_all_findings(self) -> list[dict[str, Any]]:
        return await self._all("/risks/findings", "findings", self.MAX_GROUPED_FINDINGS)

    async def get_remediations(self) -> list[dict[str, Any]]:
        return await self._all("/remediations", "remediations")

    async def get_progress(self) -> dict[str, Any]:
        return await self.get_json("/risk-posture/secure-standing-privilege/progress")
