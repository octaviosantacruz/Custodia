"""SIA (Secure Infrastructure Access) API client — access policies.

Confirmed contract (2026-08-16, see docs/architecture/integration-contracts.md):
same OAuth client-credentials flow as PVWA/Identity Administration; the base
URL uses the PVWA tenant subdomain, not the Identity Administration one.
Structure mirrors identity_admin.py; kept as a separate client rather than a
shared abstraction until a third integration proves the same shape.
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


class SiaError(RuntimeError):
    """A controlled SIA client error."""


class SiaNotConfigured(SiaError):
    """Raised when the approved API contract is not configured."""


@dataclass(frozen=True)
class SiaSettings:
    base_url: str
    token_url: str
    client_id: str
    client_secret: str
    policies_path: str
    connectors_path: str = ""
    vm_infrastructure_path: str = ""
    db_strong_accounts_path: str = ""
    request_timeout_seconds: float = 60.0
    max_retries: int = 5

    @classmethod
    def from_environment(cls) -> "SiaSettings":
        required = {
            "CA_SIA_URL": os.getenv("CA_SIA_URL", "").strip(),
            "CA_SIA_TOKEN_URL": os.getenv("CA_SIA_TOKEN_URL", "").strip(),
            "CA_SIA_CLIENT_ID": os.getenv("CA_SIA_CLIENT_ID", "").strip(),
            "CA_SIA_POLICIES_PATH": os.getenv("CA_SIA_POLICIES_PATH", "").strip(),
        }
        missing = [name for name, value in required.items() if not value]
        secret = os.getenv("CA_SIA_CLIENT_SECRET", "").strip()
        secret_file = os.getenv("CA_SIA_SECRET_FILE", "").strip()
        if not secret and secret_file and Path(secret_file).exists():
            secret = Path(secret_file).read_text(encoding="utf-8").strip()
        if not secret:
            missing.append("CA_SIA_CLIENT_SECRET o CA_SIA_SECRET_FILE")
        if missing:
            raise SiaNotConfigured("Faltan variables del contrato SIA: " + ", ".join(missing))
        return cls(
            base_url=required["CA_SIA_URL"].rstrip("/"),
            token_url=required["CA_SIA_TOKEN_URL"],
            client_id=required["CA_SIA_CLIENT_ID"],
            client_secret=secret,
            policies_path=required["CA_SIA_POLICIES_PATH"],
            # Optional: an install that only ever configured policies keeps working
            # unchanged. get_connectors()/get_virtual_machines() raise SiaNotConfigured
            # if called without their own path set, instead of failing the whole
            # client (and every already-working SIA sync) at construction time.
            connectors_path=os.getenv("CA_SIA_CONNECTORS_PATH", "").strip(),
            vm_infrastructure_path=os.getenv("CA_SIA_VM_INFRASTRUCTURE_PATH", "").strip(),
            # Optional, same reasoning as above (SIA-STRONG-001 in docs/TO_IMPLEMENT.md):
            # only 2 tenant items were ever observed, so this stays opt-in rather than
            # assumed present.
            db_strong_accounts_path=os.getenv("CA_SIA_DB_STRONG_ACCOUNTS_PATH", "").strip(),
        )


class SiaClient:
    def __init__(self, settings: SiaSettings, http_client: httpx.AsyncClient | None = None):
        for name, value in (("CA_SIA_URL", settings.base_url), ("CA_SIA_TOKEN_URL", settings.token_url)):
            parsed = urlparse(value)
            if parsed.scheme != "https" or not parsed.netloc:
                raise SiaNotConfigured(f"{name} debe ser una URL HTTPS válida")
        self.settings = settings
        self._http = http_client
        self._owns_http = http_client is None
        self._access_token: str | None = None
        self._token_expires_at = 0.0

    async def __aenter__(self) -> "SiaClient":
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
                raise SiaError("La URL de SIA debe permanecer en el host HTTPS configurado")
            return path
        url = urljoin(self.settings.base_url + "/", path.lstrip("/"))
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != base.netloc:
            raise SiaError("URL de SIA fuera del host HTTPS configurado")
        return url

    async def _token(self) -> str:
        if self._http is None:
            raise SiaError("SiaClient debe usarse dentro de un context manager")
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
            raise SiaError(f"No se pudo obtener el token de SIA: {exc}") from exc
        token = payload.get("access_token")
        if not isinstance(token, str) or not token:
            raise SiaError("La respuesta OAuth no contiene access_token")
        try:
            expires_in = float(payload.get("expires_in", 300))
        except (TypeError, ValueError):
            expires_in = 300.0
        self._access_token = token
        self._token_expires_at = time.monotonic() + max(30.0, expires_in - 60.0)
        return token

    async def get_json(self, path: str) -> Any:
        if self._http is None:
            raise SiaError("SiaClient debe usarse dentro de un context manager")
        refreshed = False
        for attempt in range(self.settings.max_retries):
            try:
                response = await self._http.get(self._url_for(path), headers={"Authorization": f"Bearer {await self._token()}"})
            except httpx.HTTPError as exc:
                if attempt + 1 >= self.settings.max_retries:
                    raise SiaError(f"Error de red en SIA: {exc}") from exc
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
                raise SiaError(f"SIA respondió HTTP {response.status_code}: {response.text[:400]}")
            try:
                return response.json()
            except ValueError as exc:
                raise SiaError("SIA devolvió JSON inválido") from exc
        raise SiaError("No se pudo completar la llamada a SIA")

    # Confirmed 2026-09-10 against the tenant (see SIA-POL-001 in docs/TO_IMPLEMENT.md):
    # /api/access-policies accepts limit/offset and always returns {totalCount, items[]}.
    _POLICIES_PAGE_SIZE = 100
    _POLICIES_MAX_ITEMS = 20000  # safety cap against a misbehaving/looping tenant response

    async def get_policies(self) -> list[dict[str, Any]]:
        separator = "&" if "?" in self.settings.policies_path else "?"
        all_items: list[dict[str, Any]] = []
        total_count: int | None = None
        offset = 0
        while True:
            path = f"{self.settings.policies_path}{separator}limit={self._POLICIES_PAGE_SIZE}&offset={offset}"
            payload = await self.get_json(path)
            if not isinstance(payload, dict):
                raise SiaError("SIA devolvió un objeto inesperado para el listado de políticas")
            items = payload.get("items")
            if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
                raise SiaError("La respuesta de políticas no contiene items[] de objetos")
            page_total = payload.get("totalCount")
            if total_count is None:
                if isinstance(page_total, int):
                    total_count = page_total
            elif isinstance(page_total, int) and page_total != total_count:
                raise SiaError(
                    f"SIA reportó totalCount inconsistente entre páginas de políticas "
                    f"({total_count} luego {page_total}); abortando para no devolver un "
                    "listado incompleto o duplicado"
                )
            all_items.extend(items)
            if len(all_items) > self._POLICIES_MAX_ITEMS:
                raise SiaError("SIA superó el límite de seguridad de paginación de políticas")
            if total_count is not None:
                if len(all_items) >= total_count:
                    break
                if not items:
                    raise SiaError(
                        f"SIA reportó totalCount={total_count} pero devolvió una página vacía "
                        f"tras acumular sólo {len(all_items)} políticas; abortando para no "
                        "devolver un listado incompleto"
                    )
            elif not items or len(items) < self._POLICIES_PAGE_SIZE:
                # No totalCount to bound pagination; an empty or short page means there's no more.
                break
            offset += len(items)
        return all_items

    async def get_policy_detail(self, policy_id: str) -> dict[str, Any]:
        path = f"{self.settings.policies_path.rstrip('/')}/{policy_id}"
        payload = await self.get_json(path)
        if not isinstance(payload, dict):
            raise SiaError("SIA devolvió un objeto inesperado para el detalle de política")
        return payload

    # Confirmed 2026-09-11 against the tenant (see SIA-CONN-001 in docs/TO_IMPLEMENT.md):
    # /api/connectors returns {continuationToken, count, items[]}. Bound by
    # `count`, not by continuationToken's mere presence -- the VM
    # infrastructure endpoint (get_virtual_machines) was observed to return a
    # truthy cursor token even when the collection was already complete, and
    # there is no reason to assume this endpoint behaves differently.
    async def get_connectors(self) -> list[dict[str, Any]]:
        if not self.settings.connectors_path:
            raise SiaNotConfigured("Falta CA_SIA_CONNECTORS_PATH para listar conectores SIA")
        payload = await self.get_json(self.settings.connectors_path)
        if not isinstance(payload, dict):
            raise SiaError("SIA devolvió un objeto inesperado para el listado de conectores")
        items = payload.get("items")
        if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
            raise SiaError("La respuesta de conectores no contiene items[] de objetos")
        count = payload.get("count")
        if isinstance(count, int) and len(items) < count:
            raise SiaError(
                f"SIA reportó count={count} pero devolvió sólo {len(items)} conectores y la "
                "paginación de /api/connectors todavía no está confirmada; abortando para no "
                "devolver un listado incompleto"
            )
        return items

    # Confirmed 2026-09-11 (see SIA-RES-001): /api/infrastructure/virtual-machines
    # returns {items[], nextToken, totalCount}. nextToken was observed truthy
    # even when items already satisfies totalCount (28 items, totalCount=28,
    # nextToken still present) -- four guessed cursor parameter names
    # (nextToken/cursor/pageToken/continuationToken) all returned the exact
    # same 28 items back, consistent with there being nothing left to page
    # through regardless of which name is "correct". So totalCount, not
    # nextToken's mere presence, is the bound: only fail loudly if the
    # collection is short of its own reported total, since that is the one
    # case where guessing the real cursor parameter would matter.
    async def get_virtual_machines(self) -> list[dict[str, Any]]:
        if not self.settings.vm_infrastructure_path:
            raise SiaNotConfigured("Falta CA_SIA_VM_INFRASTRUCTURE_PATH para listar VMs de SIA")
        payload = await self.get_json(self.settings.vm_infrastructure_path)
        if not isinstance(payload, dict):
            raise SiaError("SIA devolvió un objeto inesperado para el listado de VMs")
        items = payload.get("items")
        if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
            raise SiaError("La respuesta de VMs no contiene items[] de objetos")
        total_count = payload.get("totalCount")
        if isinstance(total_count, int) and len(items) < total_count:
            raise SiaError(
                f"SIA reportó totalCount={total_count} pero devolvió sólo {len(items)} VMs "
                "y la paginación de /api/infrastructure/virtual-machines todavía no está "
                "confirmada; abortando para no devolver un listado incompleto"
            )
        return items

    # Confirmed 2026-09-11 (see SIA-STRONG-001): /api/database-strong-accounts
    # returns {items[], nextCursor, totalCount}. Only 2 tenant items were ever
    # observed (differing key subsets by storeType), so this mirrors the same
    # totalCount-bounded, cursor-agnostic pattern as get_virtual_machines rather
    # than trusting a larger, unverified assumption about nextCursor.
    async def get_database_strong_accounts(self) -> list[dict[str, Any]]:
        if not self.settings.db_strong_accounts_path:
            raise SiaNotConfigured("Falta CA_SIA_DB_STRONG_ACCOUNTS_PATH para listar cuentas fuertes de base de datos")
        payload = await self.get_json(self.settings.db_strong_accounts_path)
        if not isinstance(payload, dict):
            raise SiaError("SIA devolvió un objeto inesperado para el listado de cuentas fuertes de base de datos")
        items = payload.get("items")
        if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
            raise SiaError("La respuesta de cuentas fuertes de base de datos no contiene items[] de objetos")
        total_count = payload.get("totalCount")
        if isinstance(total_count, int) and len(items) < total_count:
            raise SiaError(
                f"SIA reportó totalCount={total_count} pero devolvió sólo {len(items)} cuentas "
                "y la paginación de /api/database-strong-accounts todavía no está confirmada; "
                "abortando para no devolver un listado incompleto"
            )
        return items
