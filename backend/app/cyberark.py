from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import quote

from .cyberark_errors import CyberArkError
from .services.cyberark_parsing import parse_paged_payload, parse_total_collection
from .services.cyberark_settings import CyberArkSettings
from .services.cyberark_transport import CyberArkTransport


class CyberArkClient:
    """Endpoint facade for CyberArk collections and Safe members."""

    def __init__(self, settings: CyberArkSettings, http_client=None):
        self.settings = settings
        self._transport = CyberArkTransport(settings, http_client)

    async def __aenter__(self) -> "CyberArkClient":
        await self._transport.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        await self._transport.__aexit__(exc_type, exc_value, traceback)

    async def get_json(self, path: str) -> dict[str, Any]:
        return await self._transport.get_json(path)

    async def get_collection(
        self,
        path: str,
        page_size: int = 100,
        delay_seconds: float = 0.3,
    ) -> tuple[list[dict[str, Any]], int | None]:
        separator = "&" if "?" in path else "?"
        next_path = f"{path}{separator}limit={page_size}"
        values: list[dict[str, Any]] = []
        expected_count: int | None = None
        pages = 0

        while next_path:
            pages += 1
            if pages > 10000:
                raise CyberArkError("Se excedió el límite de páginas de CyberArk")
            payload = await self.get_json(next_path)
            try:
                page_values, page_count, next_path = parse_paged_payload(payload)
            except ValueError as exc:
                raise CyberArkError(str(exc)) from exc
            values.extend(page_values)
            if page_count is not None:
                expected_count = page_count
            if next_path and delay_seconds > 0:
                await asyncio.sleep(delay_seconds)

        if expected_count is not None and len(values) != expected_count:
            raise CyberArkError(
                f"Paginación incompleta: CyberArk reportó {expected_count} elementos y se obtuvieron {len(values)}"
            )
        return values, expected_count

    async def get_safes(self, page_size: int = 100) -> tuple[list[dict[str, Any]], int | None]:
        return await self.get_collection("/API/Safes", page_size=page_size)

    async def get_members(
        self,
        safe_name: str,
        page_size: int = 100,
        delay_seconds: float = 0.3,
    ) -> tuple[list[dict[str, Any]], int | None]:
        encoded_name = quote(safe_name, safe="")
        return await self.get_collection(
            f"/API/Safes/{encoded_name}/Members",
            page_size=page_size,
            delay_seconds=delay_seconds,
        )

    async def get_users(self) -> tuple[list[dict[str, Any]], int | None]:
        payload = await self.get_json("/API/Users?ExtendedDetails=true")
        try:
            return parse_total_collection(
                payload,
                key="Users",
                invalid_message="La respuesta de /API/Users no contiene Users[] válido",
                invalid_total_message="La respuesta de /API/Users contiene Total inválido",
                incomplete_message="Paginación incompleta de usuarios: CyberArk reportó {expected} y devolvió {actual}",
            )
        except ValueError as exc:
            raise CyberArkError(str(exc)) from exc

    async def get_user_groups(self, page_size: int = 100) -> tuple[list[dict[str, Any]], int | None]:
        return await self.get_collection("/API/UserGroups", page_size=page_size, delay_seconds=0)

    async def get_user_group(self, group_id: str | int) -> dict[str, Any]:
        """Fetch one group because list responses omit its members."""
        payload = await self.get_json(f"/API/UserGroups/{quote(str(group_id), safe='')}")
        members = payload.get("members")
        if not isinstance(members, list) or not all(isinstance(item, dict) for item in members):
            raise CyberArkError("La respuesta de detalle de /API/UserGroups no contiene members[] válido")
        return payload

    async def get_platforms(self) -> tuple[list[dict[str, Any]], int | None]:
        payload = await self.get_json("/API/Platforms")
        try:
            return parse_total_collection(
                payload,
                key="Platforms",
                invalid_message="La respuesta de /API/Platforms no contiene Platforms[] válido",
                invalid_total_message="La respuesta de /API/Platforms contiene Total inválido",
                incomplete_message="Paginación incompleta de plataformas: CyberArk reportó {expected} y devolvió {actual}",
            )
        except ValueError as exc:
            raise CyberArkError(str(exc)) from exc

    async def get_platform_detail(self, platform_id: str) -> dict[str, Any]:
        """Fetch one platform detail for the explicitly allowlisted fields."""
        payload = await self.get_json(f"/API/Platforms/{quote(platform_id, safe='')}")
        if not isinstance(payload, dict):
            raise CyberArkError("/API/Platforms/{id} devolvió un detalle inválido")
        return payload

    async def get_accounts(self, page_size: int = 100) -> tuple[list[dict[str, Any]], int | None]:
        return await self.get_collection("/API/Accounts", page_size=page_size, delay_seconds=0)

    async def get_platform_targets(self) -> tuple[list[dict[str, Any]], int | None]:
        """CPM/workflow policy per destination platform (PLAT-002)."""
        payload = await self.get_json("/API/platforms/targets/?limit=1000")
        try:
            return parse_total_collection(
                payload,
                key="Platforms",
                invalid_message="La respuesta de /API/platforms/targets/ no contiene Platforms[] válido",
                invalid_total_message="La respuesta de /API/platforms/targets/ contiene Total inválido",
                incomplete_message="Paginación incompleta de política de plataformas: CyberArk reportó {expected} y devolvió {actual}",
            )
        except ValueError as exc:
            raise CyberArkError(str(exc)) from exc

    async def get_platform_dependents(self) -> tuple[list[dict[str, Any]], int | None]:
        """Dependent platform catalog (PLAT-003)."""
        payload = await self.get_json("/API/platforms/dependents/?limit=1000")
        try:
            return parse_total_collection(
                payload,
                key="Platforms",
                invalid_message="La respuesta de /API/platforms/dependents/ no contiene Platforms[] válido",
                invalid_total_message="La respuesta de /API/platforms/dependents/ contiene Total inválido",
                incomplete_message="Paginación incompleta de plataformas dependientes: CyberArk reportó {expected} y devolvió {actual}",
            )
        except ValueError as exc:
            raise CyberArkError(str(exc)) from exc

    async def get_platform_groups(self) -> tuple[list[dict[str, Any]], int | None]:
        """Grouped platform catalog (PLAT-003)."""
        payload = await self.get_json("/API/platforms/groups/?limit=1000")
        try:
            return parse_total_collection(
                payload,
                key="Platforms",
                invalid_message="La respuesta de /API/platforms/groups/ no contiene Platforms[] válido",
                invalid_total_message="La respuesta de /API/platforms/groups/ contiene Total inválido",
                incomplete_message="Paginación incompleta de plataformas agrupadas: CyberArk reportó {expected} y devolvió {actual}",
            )
        except ValueError as exc:
            raise CyberArkError(str(exc)) from exc

    async def get_platform_rotational_groups(self) -> tuple[list[dict[str, Any]], int | None]:
        """Rotational group platform catalog (PLAT-003)."""
        payload = await self.get_json("/API/platforms/rotationalGroups/?limit=1000")
        try:
            return parse_total_collection(
                payload,
                key="Platforms",
                invalid_message="La respuesta de /API/platforms/rotationalGroups/ no contiene Platforms[] válido",
                invalid_total_message="La respuesta de /API/platforms/rotationalGroups/ contiene Total inválido",
                incomplete_message="Paginación incompleta de plataformas rotacionales: CyberArk reportó {expected} y devolvió {actual}",
            )
        except ValueError as exc:
            raise CyberArkError(str(exc)) from exc

    async def get_psm_servers(self) -> tuple[list[dict[str, Any]], int | None]:
        """PSM server catalog (PSM-001)."""
        payload = await self.get_json("/API/PSM/Servers?limit=1000")
        try:
            return parse_total_collection(
                payload,
                key="PSMServers",
                invalid_message="La respuesta de /API/PSM/Servers no contiene PSMServers[] válido",
                invalid_total_message="La respuesta de /API/PSM/Servers contiene Total inválido",
                incomplete_message="Paginación incompleta de servidores PSM: CyberArk reportó {expected} y devolvió {actual}",
            )
        except ValueError as exc:
            raise CyberArkError(str(exc)) from exc

    async def get_psm_connectors(self) -> tuple[list[dict[str, Any]], int | None]:
        """PSM session connector-type catalog (PSM-001)."""
        payload = await self.get_json("/API/PSM/Connectors?limit=1000")
        try:
            return parse_total_collection(
                payload,
                key="PSMConnectors",
                invalid_message="La respuesta de /API/PSM/Connectors no contiene PSMConnectors[] válido",
                invalid_total_message="La respuesta de /API/PSM/Connectors contiene Total inválido",
                incomplete_message="Paginación incompleta de conectores PSM: CyberArk reportó {expected} y devolvió {actual}",
            )
        except ValueError as exc:
            raise CyberArkError(str(exc)) from exc

    async def get_components_summary(self) -> dict[str, Any]:
        """PAM component health summary (SYS-001)."""
        payload = await self.get_json("/API/ComponentsMonitoringSummary")
        if not isinstance(payload, dict) or not isinstance(payload.get("Components"), list):
            raise CyberArkError("/API/ComponentsMonitoringSummary devolvió un resumen inválido")
        return payload

    async def get_component_detail(self, component_id: str) -> list[dict[str, Any]]:
        """Per-instance component detail (SYS-001). Excludes host IP/username at the mapping layer."""
        payload = await self.get_json(f"/API/ComponentsMonitoringDetails/{quote(component_id, safe='')}/")
        details = payload.get("ComponentsDetails") if isinstance(payload, dict) else None
        if not isinstance(details, list):
            raise CyberArkError(f"/API/ComponentsMonitoringDetails/{component_id}/ devolvió ComponentsDetails[] inválido")
        return details

    async def get_aim_applications(self) -> list[dict[str, Any]]:
        """AIM application catalog (AIM-001), Gen1 web service."""
        payload = await self.get_json("/WebServices/PIMServices.svc/Applications/")
        applications = payload.get("application") if isinstance(payload, dict) else None
        if not isinstance(applications, list) or not all(isinstance(item, dict) for item in applications):
            raise CyberArkError("/WebServices/PIMServices.svc/Applications/ devolvió application[] inválido")
        return applications
