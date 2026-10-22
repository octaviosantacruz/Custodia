"""Public allowlist; raw network values and component payloads stay excluded."""

from datetime import datetime, timezone
from typing import Any, Literal

from app.cyberark.connector_manager.integrations.connector_manager import ConnectorManagerClient, ConnectorManagerError

SOURCE = "cyberark_connector_manager"


def _text(value: Any, limit: int) -> str | None:
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else None


def _date(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return date.astimezone(timezone.utc).isoformat() if date.tzinfo else None
    except ValueError:
        return None


def _count(value: Any) -> int | None:
    return value if type(value) is int and value >= 0 else None


async def get_catalog(client: ConnectorManagerClient, catalog: Literal["pools", "networks"]) -> dict:
    raw = await (client.get_pools() if catalog == "pools" else client.get_networks())
    rows = []
    for item in raw:
        name = _text(item.get("name"), 300)
        if not name:
            raise ConnectorManagerError("Connector Manager devolvió un registro sin nombre")
        row = {"id": item["id"], "name": name, "created_at": _date(item.get("createdAt")), "updated_at": _date(item.get("updatedAt"))}
        if catalog == "pools":
            counts = item.get("componentsCount")
            networks = item.get("assignedNetworkIds")
            row.update({
                "description": _text(item.get("description"), 2000),
                "assigned_network_count": len(networks) if isinstance(networks, list) else None,
                "identifiers_count": _count(item.get("identifiersCount")),
                "platform_connectors_count": _count(counts.get("PLATFORM_CONNECTOR")) if isinstance(counts, dict) else None,
                "access_connectors_count": _count(counts.get("ACCESS_CONNECTOR")) if isinstance(counts, dict) else None,
            })
        else:
            pools = item.get("assignedPools")
            row["assigned_pool_count"] = len(pools) if isinstance(pools, list) else None
        rows.append(row)
    return {"source_system": SOURCE, "catalog": catalog, "queried_at": datetime.now(timezone.utc).isoformat(), "rows": rows, "total": len(rows)}
