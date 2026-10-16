"""SIA (Secure Infrastructure Access) API client — access policies.

Confirmed contract (2026-08-16, see docs/architecture/integration-contracts.md):
same OAuth client-credentials flow as PVWA/Identity Administration; the base
URL uses the PVWA tenant subdomain, not the Identity Administration one.
The transport lives in oauth_client.py; this module keeps SIA's settings and
endpoints.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from app.cyberark.shared.integrations.oauth_client import OAuthClient, OAuthClientError
from app.cyberark.sia.target_sets_contract import (
    TARGET_SETS_CURSOR_KEY,
    TARGET_SETS_ITEMS_KEY,
)


class SiaError(OAuthClientError):
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
    target_sets_path: str = ""
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
            target_sets_path=os.getenv("CA_SIA_TARGET_SETS_PATH", "").strip(),
        )


class SiaClient(OAuthClient):
    """SIA client: settings and endpoints on the shared transport."""

    error_type = SiaError
    not_configured_type = SiaNotConfigured
    label = "SIA"

    def _https_endpoints(self, settings: SiaSettings):
        return (
            ("CA_SIA_URL", settings.base_url),
            ("CA_SIA_TOKEN_URL", settings.token_url),
        )

    # Confirmed 2026-09-10 against the tenant (see SIA-POL-001 in docs/TO_IMPLEMENT.md):
    # /api/access-policies accepts limit/offset and always returns {totalCount, items[]}.
    _POLICIES_PAGE_SIZE = 100
    _POLICIES_MAX_ITEMS = 20000  # safety cap against a misbehaving/looping tenant response
    _TARGET_SETS_MAX_PAGES = _POLICIES_MAX_ITEMS

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

    async def get_target_sets(self) -> list[dict[str, Any]]:
        """Read the optional target-set catalog using its not-yet-tenant-confirmed cursor shape.

        The SDK names and cursor query parameter are centralized in
        ``sia/target_sets_contract.py`` pending a human probe against the tenant.
        """
        if not self.settings.target_sets_path:
            raise SiaNotConfigured("Falta CA_SIA_TARGET_SETS_PATH para listar target sets SIA")

        all_items: list[dict[str, Any]] = []
        seen_cursors: set[str] = set()
        cursor: str | None = None
        page_count = 0
        while True:
            path = self.settings.target_sets_path
            if cursor is not None:
                separator = "&" if "?" in path else "?"
                path = f"{path}{separator}{urlencode({TARGET_SETS_CURSOR_KEY: cursor})}"

            payload = await self.get_json(path)
            if not isinstance(payload, dict):
                raise SiaError("SIA devolvió una forma inesperada para el catálogo de target sets")
            items = payload.get(TARGET_SETS_ITEMS_KEY)
            if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
                raise SiaError("La respuesta de target sets no contiene target_sets[] de objetos")

            next_cursor = payload.get(TARGET_SETS_CURSOR_KEY)
            if next_cursor is not None and not isinstance(next_cursor, str):
                raise SiaError("SIA devolvió un cursor inesperado para el catálogo de target sets")

            all_items.extend(items)
            if len(all_items) > self._POLICIES_MAX_ITEMS:
                raise SiaError("SIA superó el límite de seguridad de elementos de target sets")
            page_count += 1
            if page_count > self._TARGET_SETS_MAX_PAGES:
                raise SiaError("SIA superó el límite de seguridad de páginas de target sets")

            if not next_cursor:
                return all_items
            if next_cursor in seen_cursors:
                raise SiaError("SIA repitió un cursor al paginar target sets; se abortó para evitar un bucle")
            seen_cursors.add(next_cursor)
            cursor = next_cursor
