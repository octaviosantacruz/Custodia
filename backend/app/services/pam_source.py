"""CyberArk PAM source acquisition."""

import asyncio
from dataclasses import dataclass, field
from typing import Any

from ..cyberark import CyberArkClient, CyberArkError, CyberArkSettings
from .pam_mapping import _text, get_group_details


@dataclass(frozen=True)
class PamSourceSnapshot:
    users: list[dict[str, Any]]
    groups: list[dict[str, Any]]
    platforms: list[dict[str, Any]]
    accounts: list[dict[str, Any]]
    group_details: list[dict[str, Any]]
    platform_details: dict[str, dict[str, Any]] | None = None
    # Technical catalogs verified 2026-09-10 (SYS-001, PSM-001, PLAT-002,
    # PLAT-003, AIM-001). All default to empty so existing callers/tests that
    # construct a snapshot positionally keep working unchanged.
    platform_targets: list[dict[str, Any]] = field(default_factory=list)
    platform_dependents: list[dict[str, Any]] = field(default_factory=list)
    platform_groups: list[dict[str, Any]] = field(default_factory=list)
    platform_rotational_groups: list[dict[str, Any]] = field(default_factory=list)
    psm_servers: list[dict[str, Any]] = field(default_factory=list)
    psm_connectors: list[dict[str, Any]] = field(default_factory=list)
    components_summary: dict[str, Any] = field(default_factory=dict)
    components_detail: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    aim_applications: list[dict[str, Any]] = field(default_factory=list)


async def get_platform_details(
    client: CyberArkClient,
    platforms: list[dict[str, Any]],
    *,
    max_concurrency: int = 8,
) -> dict[str, dict[str, Any]]:
    """Get platform detail only to retain the approved AllowedSafes pattern.

    SAFE-PLAT-001 (GET /API/Platforms/{id}/Safes/) was probed and found to
    return the tenant's full Safe count for every platform tested, not a
    platform-specific list -- the tenant's contract does not match the
    documented candidate, so it is not mapped here. See docs/TO_IMPLEMENT.md.
    """
    if max_concurrency < 1:
        raise ValueError("max_concurrency debe ser al menos 1")
    platform_ids: list[str] = []
    seen_ids: set[str] = set()
    for platform in platforms:
        general = platform.get("general")
        platform_id = _text(general.get("id")) if isinstance(general, dict) else ""
        if not platform_id:
            raise CyberArkError("/API/Platforms devolvió una plataforma sin general.id")
        if platform_id not in seen_ids:
            platform_ids.append(platform_id)
            seen_ids.add(platform_id)

    semaphore = asyncio.Semaphore(max_concurrency)

    async def fetch_detail(platform_id: str) -> tuple[str, dict[str, Any]]:
        async with semaphore:
            detail = await client.get_platform_detail(platform_id)
        if _text(detail.get("PlatformID")) != platform_id:
            raise CyberArkError("/API/Platforms/{id} devolvió un PlatformID distinto")
        details = detail.get("Details")
        if not isinstance(details, dict):
            raise CyberArkError("/API/Platforms/{id} no contiene Details")
        allowed_safes = details.get("AllowedSafes")
        # CyberArk omits AllowedSafes (null) for some platforms regardless of
        # active status -- that means "no documented pattern", not a broken
        # contract. Only a present-but-wrong-typed value is unexpected.
        if allowed_safes is not None and not isinstance(allowed_safes, str):
            raise CyberArkError("/API/Platforms/{id} contiene Details.AllowedSafes con un tipo inesperado")
        return platform_id, {
            "allowed_safes_pattern": _text(allowed_safes) if isinstance(allowed_safes, str) else "",
        }

    results = await asyncio.gather(*(fetch_detail(platform_id) for platform_id in platform_ids))
    return dict(results)


async def get_components_detail(
    client: CyberArkClient,
    component_ids: list[str],
    *,
    max_concurrency: int = 8,
) -> dict[str, list[dict[str, Any]]]:
    """Fetch per-instance detail for each observed ComponentID (SYS-001)."""
    if max_concurrency < 1:
        raise ValueError("max_concurrency debe ser al menos 1")
    semaphore = asyncio.Semaphore(max_concurrency)

    async def fetch(component_id: str) -> tuple[str, list[dict[str, Any]]]:
        async with semaphore:
            detail = await client.get_component_detail(component_id)
        return component_id, detail

    ids = [component_id for component_id in component_ids if component_id]
    if not ids:
        return {}
    results = await asyncio.gather(*(fetch(component_id) for component_id in ids))
    return dict(results)


async def fetch_pam_source(page_size: int = 100) -> PamSourceSnapshot:
    """Fetch the complete PAM source snapshot with bounded group/platform detail calls."""
    settings = CyberArkSettings.from_environment()
    async with CyberArkClient(settings) as client:
        users, _ = await client.get_users()
        groups, _ = await client.get_user_groups(page_size=page_size)
        platforms, _ = await client.get_platforms()
        accounts, _ = await client.get_accounts(page_size=page_size)
        platform_targets, _ = await client.get_platform_targets()
        platform_dependents, _ = await client.get_platform_dependents()
        platform_groups, _ = await client.get_platform_groups()
        platform_rotational_groups, _ = await client.get_platform_rotational_groups()
        psm_servers, _ = await client.get_psm_servers()
        psm_connectors, _ = await client.get_psm_connectors()
        components_summary = await client.get_components_summary()
        aim_applications = await client.get_aim_applications()
        component_ids = [
            _text(component.get("ComponentID"))
            for component in components_summary.get("Components", [])
            if isinstance(component, dict)
        ]
        group_details, platform_details, components_detail = await asyncio.gather(
            get_group_details(client, groups),
            get_platform_details(client, platforms),
            get_components_detail(client, component_ids),
        )
    return PamSourceSnapshot(
        users, groups, platforms, accounts, group_details, platform_details,
        platform_targets=platform_targets,
        platform_dependents=platform_dependents,
        platform_groups=platform_groups,
        platform_rotational_groups=platform_rotational_groups,
        psm_servers=psm_servers,
        psm_connectors=psm_connectors,
        components_summary=components_summary,
        components_detail=components_detail,
        aim_applications=aim_applications,
    )


async def fetch_psm_servers() -> list[dict[str, Any]]:
    """Fetch the authoritative PSM server catalog for an isolated refresh."""
    settings = CyberArkSettings.from_environment()
    async with CyberArkClient(settings) as client:
        servers, _ = await client.get_psm_servers()
    return servers
