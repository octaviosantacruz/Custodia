from __future__ import annotations

import asyncio
import time
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse

import httpx

from ..cyberark_errors import CyberArkError
from .cyberark_settings import CyberArkSettings


class CyberArkTransport:
    """OAuth and resilient HTTP transport for the CyberArk API."""

    def __init__(self, settings: CyberArkSettings, http_client: httpx.AsyncClient | None = None):
        self.settings = settings
        self._http = http_client
        self._owns_http = http_client is None
        self._access_token: str | None = None
        self._token_expires_at = 0.0

    async def __aenter__(self) -> "CyberArkTransport":
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(
                    self.settings.request_timeout_seconds,
                    connect=self.settings.connect_timeout_seconds,
                )
            )
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        if self._http is not None and self._owns_http:
            await self._http.aclose()
            self._http = None

    async def _login(self) -> None:
        if self._http is None:
            raise CyberArkError("CyberArkTransport debe usarse dentro de un context manager")
        try:
            response = await self._http.post(
                f"{self.settings.identity_url}/oauth2/platformtoken",
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.settings.client_id,
                    "client_secret": self.settings.client_secret,
                },
            )
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise CyberArkError(f"No se pudo obtener el token de CyberArk: {exc}") from exc

        token = data.get("access_token")
        if not isinstance(token, str) or not token:
            raise CyberArkError("La respuesta OAuth de CyberArk no contiene access_token")
        try:
            expires_in = float(data.get("expires_in", 300))
        except (TypeError, ValueError):
            expires_in = 300.0
        self._access_token = token
        self._token_expires_at = time.monotonic() + max(30.0, expires_in - 60.0)

    async def _token(self) -> str:
        if not self._access_token or time.monotonic() >= self._token_expires_at:
            await self._login()
        assert self._access_token is not None
        return self._access_token

    def _url_for(self, path: str) -> str:
        if path.startswith(("http://", "https://")):
            parsed = urlparse(path)
            expected = urlparse(self.settings.pvwa_url)
            if parsed.scheme != "https" or parsed.netloc != expected.netloc:
                raise CyberArkError("nextLink de CyberArk debe permanecer en el host HTTPS configurado")
            return urlunparse(parsed)
        return urljoin(f"{self.settings.pvwa_url}/", path.lstrip("/"))

    async def get_json(self, path: str) -> dict[str, Any]:
        if self._http is None:
            raise CyberArkError("CyberArkTransport debe usarse dentro de un context manager")

        refreshed = False
        for attempt in range(self.settings.max_retries):
            token = await self._token()
            try:
                response = await self._http.get(
                    self._url_for(path), headers={"Authorization": f"Bearer {token}"}
                )
            except httpx.HTTPError as exc:
                if attempt + 1 >= self.settings.max_retries:
                    raise CyberArkError(f"Error de red llamando a CyberArk: {exc}") from exc
                await asyncio.sleep(min(2**attempt, 8))
                continue

            if response.status_code == 401 and not refreshed:
                self._access_token = None
                refreshed = True
                continue
            if response.status_code == 429:
                if attempt + 1 >= self.settings.max_retries:
                    raise CyberArkError("CyberArk mantuvo el throttling 429 tras varios reintentos")
                retry_after = response.headers.get("Retry-After")
                try:
                    delay = max(1.0, float(retry_after)) if retry_after else min(2**attempt, 8)
                except ValueError:
                    delay = min(2**attempt, 8)
                await asyncio.sleep(delay)
                continue
            if response.status_code >= 500 and attempt + 1 < self.settings.max_retries:
                await asyncio.sleep(min(2**attempt, 8))
                continue
            if response.is_error:
                detail = response.text.replace("\n", " ")[:400]
                raise CyberArkError(f"CyberArk respondió HTTP {response.status_code}: {detail}")
            try:
                data = response.json()
            except ValueError as exc:
                raise CyberArkError("CyberArk devolvió una respuesta que no es JSON") from exc
            if not isinstance(data, dict):
                raise CyberArkError("CyberArk devolvió un payload JSON inesperado")
            return data
        raise CyberArkError("No se pudo completar la llamada a CyberArk")
