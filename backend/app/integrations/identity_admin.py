from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from .identity_admin_parsing import parse_collection_page


class IdentityAdminError(RuntimeError):
    """A controlled Identity Administration client error."""


class IdentityAdminNotConfigured(IdentityAdminError):
    """Raised when the approved API contract is not configured."""


@dataclass(frozen=True)
class IdentityAdminSettings:
    base_url: str
    token_url: str
    client_id: str
    client_secret: str
    users_path: str
    roles_path: str
    federations_path: str = ""
    request_timeout_seconds: float = 60.0
    max_retries: int = 5

    @classmethod
    def from_environment(cls) -> "IdentityAdminSettings":
        required = {
            "CA_IDENTITY_ADMIN_URL": os.getenv("CA_IDENTITY_ADMIN_URL", "").strip(),
            "CA_IDENTITY_ADMIN_TOKEN_URL": os.getenv("CA_IDENTITY_ADMIN_TOKEN_URL", "").strip(),
            "CA_IDENTITY_ADMIN_CLIENT_ID": os.getenv("CA_IDENTITY_ADMIN_CLIENT_ID", "").strip(),
            "CA_IDENTITY_ADMIN_USERS_PATH": os.getenv("CA_IDENTITY_ADMIN_USERS_PATH", "").strip(),
            "CA_IDENTITY_ADMIN_ROLES_PATH": os.getenv("CA_IDENTITY_ADMIN_ROLES_PATH", "").strip(),
        }
        missing = [name for name, value in required.items() if not value]
        secret = os.getenv("CA_IDENTITY_ADMIN_CLIENT_SECRET", "").strip()
        secret_file = os.getenv("CA_IDENTITY_ADMIN_SECRET_FILE", "").strip()
        if not secret and secret_file and Path(secret_file).exists():
            secret = Path(secret_file).read_text(encoding="utf-8").strip()
        if not secret:
            missing.append("CA_IDENTITY_ADMIN_CLIENT_SECRET o CA_IDENTITY_ADMIN_SECRET_FILE")
        if missing:
            raise IdentityAdminNotConfigured("Faltan variables del contrato Identity Administration: " + ", ".join(missing))
        return cls(
            base_url=required["CA_IDENTITY_ADMIN_URL"].rstrip("/"),
            token_url=required["CA_IDENTITY_ADMIN_TOKEN_URL"],
            client_id=required["CA_IDENTITY_ADMIN_CLIENT_ID"],
            client_secret=secret,
            users_path=required["CA_IDENTITY_ADMIN_USERS_PATH"],
            roles_path=required["CA_IDENTITY_ADMIN_ROLES_PATH"],
            # Optional (ID-001 in docs/TO_IMPLEMENT.md): an install that hasn't set
            # CA_IDENTITY_ADMIN_FEDERATIONS_PATH keeps syncing users/roles exactly
            # as before. get_federations() raises IdentityAdminNotConfigured if
            # called without it, same pattern as SIA's optional catalogs.
            federations_path=os.getenv("CA_IDENTITY_ADMIN_FEDERATIONS_PATH", "").strip(),
        )


class IdentityAdminClient:
    def __init__(self, settings: IdentityAdminSettings, http_client: httpx.AsyncClient | None = None):
        for name, value in (("CA_IDENTITY_ADMIN_URL", settings.base_url), ("CA_IDENTITY_ADMIN_TOKEN_URL", settings.token_url)):
            parsed = urlparse(value)
            if parsed.scheme != "https" or not parsed.netloc:
                raise IdentityAdminNotConfigured(f"{name} debe ser una URL HTTPS válida")
        self.settings = settings
        self._http = http_client
        self._owns_http = http_client is None
        self._access_token: str | None = None
        self._token_expires_at = 0.0

    async def __aenter__(self) -> "IdentityAdminClient":
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
                raise IdentityAdminError("nextLink de Identity Administration debe permanecer en el host HTTPS configurado")
            return path
        url = urljoin(self.settings.base_url + "/", path.lstrip("/"))
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != base.netloc:
            raise IdentityAdminError("URL de Identity Administration fuera del host HTTPS configurado")
        return url

    async def _token(self) -> str:
        if self._http is None:
            raise IdentityAdminError("IdentityAdminClient debe usarse dentro de un context manager")
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
            raise IdentityAdminError(f"No se pudo obtener el token de Identity Administration: {exc}") from exc
        token = payload.get("access_token")
        if not isinstance(token, str) or not token:
            raise IdentityAdminError("La respuesta OAuth no contiene access_token")
        try:
            expires_in = float(payload.get("expires_in", 300))
        except (TypeError, ValueError):
            expires_in = 300.0
        self._access_token = token
        self._token_expires_at = time.monotonic() + max(30.0, expires_in - 60.0)
        return token

    async def get_json(self, path: str) -> dict[str, Any]:
        if self._http is None:
            raise IdentityAdminError("IdentityAdminClient debe usarse dentro de un context manager")
        refreshed = False
        for attempt in range(self.settings.max_retries):
            try:
                response = await self._http.get(self._url_for(path), headers={"Authorization": f"Bearer {await self._token()}"})
            except httpx.HTTPError as exc:
                if attempt + 1 >= self.settings.max_retries:
                    raise IdentityAdminError(f"Error de red en Identity Administration: {exc}") from exc
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
                raise IdentityAdminError(f"Identity Administration respondió HTTP {response.status_code}: {response.text[:400]}")
            try:
                payload = response.json()
            except ValueError as exc:
                raise IdentityAdminError("Identity Administration devolvió JSON inválido") from exc
            if not isinstance(payload, dict):
                raise IdentityAdminError("Identity Administration devolvió un objeto JSON inesperado")
            return payload
        raise IdentityAdminError("No se pudo completar la llamada a Identity Administration")

    async def get_collection(self, path: str, page_size: int = 100) -> tuple[list[dict[str, Any]], int | None]:
        # totalResults is observed to be unreliable on this tenant (it under-reports
        # the real count), so completeness is driven by page size, not by that field:
        # a short page is the only trustworthy end-of-collection signal.
        #
        # The tenant has also been observed to repeat the same SCIM id within one
        # page — sometimes as an identical copy, sometimes with different field
        # values for the same id. Both are collapsed here (first occurrence wins)
        # so a source-side quirk never reaches deduplicate_snapshot as a hard
        # "conflicting observation" failure.
        separator = "&" if "?" in path else "?"
        values: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        reported_total: int | None = None
        start_index = 1
        for _ in range(10000):
            page_path = f"{path}{separator}startIndex={start_index}&count={page_size}"
            payload = await self.get_json(page_path)
            try:
                page, total_results = parse_collection_page(payload)
            except ValueError as exc:
                raise IdentityAdminError(str(exc)) from exc
            for item in page:
                item_id = item.get("id")
                if isinstance(item_id, str) and item_id:
                    if item_id in seen_ids:
                        continue
                    seen_ids.add(item_id)
                values.append(item)
            if total_results is not None:
                reported_total = total_results
            if len(page) < page_size:
                break
            start_index += len(page)
        else:
            raise IdentityAdminError("Se excedió el límite de páginas")
        return values, reported_total

    async def get_users(self, page_size: int = 100) -> tuple[list[dict[str, Any]], int | None]:
        return await self.get_collection(self.settings.users_path, page_size)

    async def get_roles(self, page_size: int = 100) -> tuple[list[dict[str, Any]], int | None]:
        return await self.get_collection(self.settings.roles_path, page_size)

    # Confirmed 2026-09-11 against the tenant (see ID-001 in
    # docs/TO_IMPLEMENT.md): GET /Federation/GetFederations returns
    # {Result:[...], ErrorCode, success} -- not a SCIM collection, so this
    # does not reuse get_collection's startIndex/count paging (only 4
    # federations were observed, and the response shape carries no
    # pagination fields at all).
    async def get_federations(self) -> list[dict[str, Any]]:
        if not self.settings.federations_path:
            raise IdentityAdminNotConfigured(
                "Falta CA_IDENTITY_ADMIN_FEDERATIONS_PATH para listar federaciones"
            )
        payload = await self.get_json(self.settings.federations_path)
        if payload.get("success") is False:
            raise IdentityAdminError(
                f"Identity Administration reportó error al listar federaciones: {payload.get('ErrorCode')}"
            )
        result = payload.get("Result")
        if not isinstance(result, list) or not all(isinstance(item, dict) for item in result):
            raise IdentityAdminError("La respuesta de federaciones no contiene Result[] de objetos")
        return result
