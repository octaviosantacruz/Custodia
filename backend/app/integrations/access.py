"""Access space API client — cross-domain accessible assets (ACCESS-001).

Confirmed contract (2026-09-11, see docs/architecture/integration-contracts.md):
GET {base_url}/api/assets returns {assets: [...], diagnostics, nextToken, size}.
Reuses the same OAuth client-credentials flow (oauth2/platformtoken) and the
same client_id/secret already authorized for PVWA -- confirmed live, no new
credentials needed. Structure mirrors sia.py; kept as a separate client
rather than a shared abstraction until a fourth integration proves the same
shape is worth generalizing.

Pagination for /api/assets has NOT been observed: every probe response so far
had a null nextToken (7 assets, one page). Rather than guess the cursor query
parameter name, get_assets() fails loudly if a non-null nextToken is ever
returned, exactly like get_policies() originally did for SIA before its
pagination contract was confirmed.
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx


class AccessError(RuntimeError):
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


class AccessClient:
    def __init__(self, settings: AccessSettings, http_client: httpx.AsyncClient | None = None):
        for name, value in (("CA_ACCESS_URL", settings.base_url), ("CA_ACCESS_TOKEN_URL", settings.token_url)):
            parsed = urlparse(value)
            if parsed.scheme != "https" or not parsed.netloc:
                raise AccessNotConfigured(f"{name} debe ser una URL HTTPS válida")
        self.settings = settings
        self._http = http_client
        self._owns_http = http_client is None
        self._access_token: str | None = None
        self._token_expires_at = 0.0

    async def __aenter__(self) -> "AccessClient":
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=self.settings.request_timeout_seconds)
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        if self._http is not None and self._owns_http:
            await self._http.aclose()
            self._http = None

    def _url_for(self, path: str) -> str:
        base = urlparse(self.settings.base_url)
        if path.startswith(("http://", "https://")):
            parsed = urlparse(path)
            if parsed.scheme != "https" or parsed.netloc != base.netloc:
                raise AccessError("La URL de Access debe permanecer en el host HTTPS configurado")
            return path
        url = urljoin(self.settings.base_url + "/", path.lstrip("/"))
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != base.netloc:
            raise AccessError("URL de Access fuera del host HTTPS configurado")
        return url

    async def _token(self) -> str:
        if self._http is None:
            raise AccessError("AccessClient debe usarse dentro de un context manager")
        if self._access_token and time.monotonic() < self._token_expires_at:
            return self._access_token
        try:
            response = await self._http.post(
                self.settings.token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.settings.client_id,
                    "client_secret": self.settings.client_secret,
                },
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise AccessError(f"No se pudo obtener el token de Access: {exc}") from exc
        token = payload.get("access_token")
        if not isinstance(token, str) or not token:
            raise AccessError("La respuesta OAuth no contiene access_token")
        try:
            expires_in = float(payload.get("expires_in", 300))
        except (TypeError, ValueError):
            expires_in = 300.0
        self._access_token = token
        self._token_expires_at = time.monotonic() + max(30.0, expires_in - 60.0)
        return token

    async def get_json(self, path: str) -> Any:
        if self._http is None:
            raise AccessError("AccessClient debe usarse dentro de un context manager")
        refreshed = False
        for attempt in range(self.settings.max_retries):
            try:
                response = await self._http.get(self._url_for(path), headers={"Authorization": f"Bearer {await self._token()}"})
            except httpx.HTTPError as exc:
                if attempt + 1 >= self.settings.max_retries:
                    raise AccessError(f"Error de red en Access: {exc}") from exc
                await asyncio.sleep(min(2**attempt, 8))
                continue
            if response.status_code == 401 and not refreshed:
                self._access_token = None
                refreshed = True
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt + 1 >= self.settings.max_retries:
                    break
                await asyncio.sleep(min(2**attempt, 8))
                continue
            if response.is_error:
                raise AccessError(f"Access respondió HTTP {response.status_code}: {response.text[:400]}")
            try:
                return response.json()
            except ValueError as exc:
                raise AccessError("Access devolvió JSON inválido") from exc
        raise AccessError("No se pudo completar la llamada a Access")

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
