"""Map Access space assets (ACCESS-001) into the normalized CMDB.

Confirmed contract (2026-09-11, two probe rounds, see docs/TO_IMPLEMENT.md):
each asset has accessMethod, address, assetCategory, assetId, assetType,
connectionComponents, customProperties ({port, logon_domain}), fileCategories
(usually {}, sometimes {LogonDomain}), isFavorite, platformId, platformSubtype,
platformType, protocol, username, workflowStatus.

Excluded on purpose (host/credential-adjacent data, same criterion as
SYS-001/PAM-USR-001): address, username, customProperties.logon_domain,
fileCategories.LogonDomain. customProperties.port is kept -- it identifies the
service on the asset, not an infrastructure address.

platformId is kept as a raw attribute only. It is NOT turned into a
cyberark_inventory_relationships row here: that table's single source_system
column can't represent an edge between an 'access' object and a 'cyberark'
object. The cross-reference is resolved at read time with an exact-match join
in repositories/access_queries.py, the same pattern already used for the
SIA->PAM IP join (sia_queries.py) and the Identity->PAM UUID bridge
(identity_pam_bridge.py).
"""

from __future__ import annotations

from typing import Any

from .cmdb_models import InventoryObject

SOURCE_SYSTEM = "access"


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: Any) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _bool(value: Any) -> bool:
    return bool(value) if isinstance(value, bool) else False


def map_access_objects(assets: list[dict[str, Any]]) -> list[InventoryObject]:
    objects: list[InventoryObject] = []
    for asset in assets:
        asset_id = _text(asset.get("assetId"))
        if not asset_id:
            raise ValueError("/api/assets devolvió un asset sin assetId")
        custom_properties = asset.get("customProperties")
        port = custom_properties.get("port") if isinstance(custom_properties, dict) else None
        platform_id = asset.get("platformId")
        objects.append(InventoryObject(
            object_type="access_asset",
            source_id=asset_id,
            display_name=asset_id,
            source_system=SOURCE_SYSTEM,
            attributes={
                "access_method": _text(asset.get("accessMethod")),
                "asset_category": _text(asset.get("assetCategory")),
                "asset_type": _text(asset.get("assetType")),
                "platform_type": _text(asset.get("platformType")),
                "platform_subtype": _text(asset.get("platformSubtype")),
                "protocol": _text(asset.get("protocol")),
                "workflow_status": _text(asset.get("workflowStatus")),
                "is_favorite": _bool(asset.get("isFavorite")),
                "connection_components": _string_list(asset.get("connectionComponents")),
                "port": port if isinstance(port, (int, str)) else None,
                # Kept for the read-time bridge to PAM platforms; never a
                # persisted relationship. See module docstring.
                "platform_id": str(platform_id) if platform_id not in (None, "") else "",
            },
        ))
    return objects
