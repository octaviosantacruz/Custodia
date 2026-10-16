from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.cyberark.identity_administration.integrations.identity_admin_parsing import parse_collection_page
from app.cyberark.shared.integrations.oauth_client import OAuthClient, OAuthClientError


class IdentityAdminError(OAuthClientError):
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


class IdentityAdminClient(OAuthClient):
    """Identity Administration client: settings and endpoints on the shared transport."""

    error_type = IdentityAdminError
    not_configured_type = IdentityAdminNotConfigured
    label = "Identity Administration"
    expect_json_object = True

    def _https_endpoints(self, settings: IdentityAdminSettings):
        return (
            ("CA_IDENTITY_ADMIN_URL", settings.base_url),
            ("CA_IDENTITY_ADMIN_TOKEN_URL", settings.token_url),
        )

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

    async def get_directory_user(self, source_id: str) -> dict[str, Any] | None:
        """Recover an exact role member omitted by SCIM, using the native SDK contract.

        Only the allowlisted projection leaves this integration; attributes can
        contain sensitive settings and must never be retained as a raw payload.
        """
        if not source_id or len(source_id) > 512 or any(ord(char) < 32 for char in source_id):
            raise IdentityAdminError("ID de miembro inválido para consultar Identity")
        literal = source_id.replace("'", "''")
        payload = await self.post_read_json("/Redrock/query", {
            "Script": f"Select ID, Username, DisplayName from User WHERE ID='{literal}'",
        })
        result = payload.get("Result")
        rows = result.get("Results") if isinstance(result, dict) else None
        if payload.get("success") is not True or not isinstance(rows, list):
            raise IdentityAdminError("Consulta del directorio Identity incompleta")
        if not rows:
            return None
        row = rows[0].get("Row") if isinstance(rows[0], dict) else None
        if len(rows) != 1 or not isinstance(row, dict) or row.get("ID") != source_id:
            raise IdentityAdminError("El directorio Identity no devolvió el ID exacto solicitado")
        username = row.get("Username")
        if not isinstance(username, str) or not username.strip():
            raise IdentityAdminError("El directorio Identity devolvió una cuenta sin nombre")
        payload = await self.post_read_json("/UserMgmt/GetUserAttributes", {"ID": source_id})
        attributes = payload.get("Result")
        if payload.get("success") is not True or not isinstance(attributes, dict):
            raise IdentityAdminError("Atributos del usuario Identity incompletos")
        if attributes.get("Uuid", source_id) != source_id:
            raise IdentityAdminError("Atributos de otro usuario Identity")
        everybody = attributes.get("InEverybodyRole")
        oauth = attributes.get("OauthClient")
        if not isinstance(everybody, bool) or (oauth is not None and not isinstance(oauth, bool)):
            raise IdentityAdminError("Clasificación del usuario Identity no informada")
        # Official CyberArk Identity SDK: !InEverybodyRole identifies service users.
        return {
            "id": source_id,
            "userName": username.strip(),
            "displayName": row.get("DisplayName") if isinstance(row.get("DisplayName"), str) else username.strip(),
            "record_source": "identity_directory",
            "service_user_basis": "sdk_in_everybody_role",
            "urn:ietf:params:scim:schemas:cyberark:1.0:User": {
                "serviceUser": not everybody, "oauthClient": oauth,
            },
        }

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
