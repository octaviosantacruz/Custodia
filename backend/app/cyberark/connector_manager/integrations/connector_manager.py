"""CMGR-001: bounded GET-only pools and networks, on shared CyberArk OAuth."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

from app.cyberark.shared.integrations.oauth_client import OAuthClient, OAuthClientError


class ConnectorManagerError(OAuthClientError):
    """Controlled remote contract failure, never a partial inventory."""


class ConnectorManagerNotConfigured(ConnectorManagerError):
    """Shared tenant credentials are missing or invalid."""


@dataclass(frozen=True)
class ConnectorManagerSettings:
    base_url: str
    token_url: str
    client_id: str
    client_secret: str = field(repr=False)
    request_timeout_seconds: float = 30.0
    max_retries: int = 5
    page_size: int = 100

    @classmethod
    def from_environment(cls) -> ConnectorManagerSettings:
        pvwa = urlparse(os.getenv("CA_PVWA_URL", "").strip())
        host = pvwa.hostname or ""
        match = re.fullmatch(r"([a-zA-Z0-9-]+)\.privilegecloud\.cyberark\.cloud", host)
        if pvwa.scheme != "https" or not match or pvwa.netloc != host:
            raise ConnectorManagerNotConfigured("Falta CA_PVWA_URL con el host HTTPS de Privilege Cloud")
        identity = os.getenv("CA_IDENTITY_URL", "").strip().rstrip("/")
        parsed_identity = urlparse(identity)
        if parsed_identity.scheme != "https" or not parsed_identity.netloc or parsed_identity.username or parsed_identity.password or parsed_identity.query or parsed_identity.fragment:
            raise ConnectorManagerNotConfigured("Falta CA_IDENTITY_URL HTTPS válida")
        client_id = os.getenv("CA_CLIENT_ID", "").strip()
        secret = os.getenv("CA_CLIENT_SECRET", "").strip()
        secret_file = os.getenv("CA_SECRET_FILE", ".ca_secret").strip()
        if not secret and secret_file:
            try:
                secret = Path(secret_file).read_text(encoding="utf-8").strip()
            except OSError:
                pass
        if not client_id or not secret:
            raise ConnectorManagerNotConfigured("Faltan CA_CLIENT_ID y CA_CLIENT_SECRET o CA_SECRET_FILE")
        return cls(
            base_url=f"https://{match[1]}.connectormanagement.cyberark.cloud",
            token_url=f"{identity}/oauth2/platformtoken",
            client_id=client_id,
            client_secret=secret,
        )


class ConnectorManagerClient(OAuthClient):
    error_type = ConnectorManagerError
    not_configured_type = ConnectorManagerNotConfigured
    label = "Connector Manager"
    expect_json_object = True
    MAX_PAGES = 200
    MAX_ITEMS = 20_000

    def _https_endpoints(self, settings: ConnectorManagerSettings):
        return (("Connector Manager", settings.base_url), ("CA_IDENTITY_URL", settings.token_url))

    async def get_pools(self) -> list[dict[str, Any]]:
        return await self._all("pools")

    async def get_networks(self) -> list[dict[str, Any]]:
        return await self._all("networks")

    async def _all(self, catalog: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        ids: set[str] = set()
        cursors: set[str] = set()
        params = {"projection": "EXTENDED", "page_size": str(self.settings.page_size)}
        total: int | None = None
        for _ in range(self.MAX_PAGES):
            payload = await self.get_json(f"/api/pool-service/{catalog}?{urlencode(params)}")
            resources = payload.get("resources")
            if not isinstance(resources, list):
                raise ConnectorManagerError("Connector Manager no devolvió resources[]")
            for row in resources:
                if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"].strip():
                    raise ConnectorManagerError("Connector Manager devolvió un registro sin ID válido")
                if row["id"] in ids:
                    raise ConnectorManagerError("Connector Manager repitió un ID en el catálogo")
                ids.add(row["id"])
            rows.extend(resources)
            if len(rows) > self.MAX_ITEMS:
                raise ConnectorManagerError("Connector Manager superó el límite de registros")
            page = payload.get("page", {})
            if not isinstance(page, dict):
                raise ConnectorManagerError("Connector Manager devolvió page inválida")
            # The tenant uses camelCase; the official SDK also documents snake_case.
            for camel, snake in (("continuationToken", "continuation_token"), ("totalResourcesCount", "total_resources_count")):
                if camel in page and snake in page and page[camel] != page[snake]:
                    raise ConnectorManagerError("Connector Manager devolvió metadatos de paginación contradictorios")
            cursor = page.get("continuationToken", page.get("continuation_token"))
            declared_total = page.get("totalResourcesCount", page.get("total_resources_count"))
            if declared_total is not None:
                if type(declared_total) is not int or declared_total < 0 or total is not None and declared_total != total:
                    raise ConnectorManagerError("Connector Manager devolvió un total inválido o cambiante")
                total = declared_total
            if total is not None and len(rows) > total:
                raise ConnectorManagerError("Connector Manager superó el total declarado")
            if cursor is None or cursor == "":
                if total is not None and len(rows) != total:
                    raise ConnectorManagerError("Connector Manager devolvió un catálogo incompleto")
                return rows
            if not isinstance(cursor, str) or not resources or cursor in cursors:
                raise ConnectorManagerError("Connector Manager devolvió una continuación inválida o repetida")
            cursors.add(cursor)
            params["continuation_token"] = cursor
        raise ConnectorManagerError("Connector Manager superó el límite de páginas")
