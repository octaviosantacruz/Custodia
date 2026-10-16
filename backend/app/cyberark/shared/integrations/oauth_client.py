"""Shared OAuth client-credentials transport for the CyberArk tools.

Identity Administration, SIA and Access space use the same
`oauth2/platformtoken` client-credentials flow with identical HTTPS host
pinning, token caching, 401 refresh and 429/5xx backoff. Each tool keeps its
own settings, error classes and endpoints; this base owns only the transport,
so a fourth CyberArk tool does not reimplement it.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from app.cross.services.retry_backoff import retry_delay


class OAuthClientError(RuntimeError):
    """Base error for the shared OAuth transport."""


class OAuthClientNotConfigured(OAuthClientError):
    """Raised when an approved HTTPS endpoint is missing or invalid."""


class OAuthClient:
    """Client-credentials transport shared by the CyberArk tool clients."""

    # Subclasses override these with their own error classes so existing
    # callers keep catching the source-specific errors.
    error_type: type[OAuthClientError] = OAuthClientError
    not_configured_type: type[OAuthClientError] = OAuthClientNotConfigured
    # Human label used in error messages, e.g. "SIA".
    label = "la integración"
    # When True, a successful GET must return a JSON object, not any JSON value.
    expect_json_object = False

    def __init__(self, settings, http_client: httpx.AsyncClient | None = None):
        for name, value in self._https_endpoints(settings):
            parsed = urlparse(value)
            if parsed.scheme != "https" or not parsed.netloc:
                raise self.not_configured_type(f"{name} debe ser una URL HTTPS válida")
        self.settings = settings
        self._http = http_client
        self._owns_http = http_client is None
        self._access_token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()

    def _https_endpoints(self, settings) -> tuple[tuple[str, str], ...]:
        """Return the (env name, value) endpoints that must be HTTPS."""
        return ()

    async def __aenter__(self) -> "OAuthClient":
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
                raise self.error_type(
                    f"La URL absoluta de {self.label} debe permanecer en el host HTTPS configurado"
                )
            return path
        url = urljoin(self.settings.base_url + "/", path.lstrip("/"))
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != base.netloc:
            raise self.error_type(f"URL de {self.label} fuera del host HTTPS configurado")
        return url

    async def _token(self) -> str:
        if self._http is None:
            raise self.error_type(f"{type(self).__name__} debe usarse dentro de un context manager")
        if self._access_token and time.monotonic() < self._token_expires_at:
            return self._access_token
        # Parallel read surfaces share one refresh instead of requesting a
        # separate token for every resource while the first POST is in flight.
        async with self._token_lock:
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
                raise self.error_type(f"No se pudo obtener el token de {self.label}: {exc}") from exc
            token = payload.get("access_token")
            if not isinstance(token, str) or not token:
                raise self.error_type("La respuesta OAuth no contiene access_token")
            try:
                expires_in = float(payload.get("expires_in", 300))
            except (TypeError, ValueError):
                expires_in = 300.0
            self._access_token = token
            self._token_expires_at = time.monotonic() + max(30.0, expires_in - 60.0)
            return token

    async def get_json(self, path: str) -> Any:
        return await self._request_json(path)

    async def post_read_json(self, path: str, body: dict[str, Any]) -> Any:
        """POST for read-only directory queries; never use for mutations."""
        return await self._request_json(path, body)

    async def _request_json(self, path: str, body: dict[str, Any] | None = None) -> Any:
        if self._http is None:
            raise self.error_type(f"{type(self).__name__} debe usarse dentro de un context manager")
        refreshed = False
        for attempt in range(self.settings.max_retries):
            try:
                url = self._url_for(path)
                headers = {"Authorization": f"Bearer {await self._token()}"}
                if body is None:
                    response = await self._http.get(url, headers=headers)
                else:
                    response = await self._http.post(url, headers=headers, json=body)
            except httpx.HTTPError as exc:
                if attempt + 1 >= self.settings.max_retries:
                    raise self.error_type(f"Error de red en {self.label}: {exc}") from exc
                await asyncio.sleep(retry_delay(attempt, cap=8))
                continue
            if response.status_code == 401 and not refreshed:
                self._access_token = None
                refreshed = True
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt + 1 >= self.settings.max_retries:
                    break
                # BE-RETRY-001: Retry-After was previously ignored here; the
                # PAM tools can face the same throttling as CyberArk PAM.
                retry_after_seconds: float | None = None
                if response.status_code == 429:
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        try:
                            retry_after_seconds = max(1.0, float(retry_after))
                        except ValueError:
                            retry_after_seconds = None
                await asyncio.sleep(retry_delay(attempt, cap=8, retry_after=retry_after_seconds))
                continue
            if response.is_error:
                raise self.error_type(
                    f"{self.label} respondió HTTP {response.status_code}"
                )
            try:
                payload = response.json()
            except ValueError as exc:
                raise self.error_type(f"{self.label} devolvió JSON inválido") from exc
            if self.expect_json_object and not isinstance(payload, dict):
                raise self.error_type(f"{self.label} devolvió un objeto JSON inesperado")
            return payload
        raise self.error_type(f"No se pudo completar la llamada a {self.label}")
