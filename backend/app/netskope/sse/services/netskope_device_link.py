"""ADR 006: link an ADEM device to an inventory device of the same user by exact, unique name.

This is the only place that compares an ADEM ``deviceName`` with an inventory hostname. A name that
repeats on either side links neither device; nothing is persisted and no metric reads this link.
"""

from typing import Any


def _normalize(value: Any) -> str | None:
    return value.strip().casefold() if isinstance(value, str) and value.strip() else None


def link_devices_by_exact_name(inventory: list[dict[str, Any]], adem: list[dict[str, Any]]) -> dict[str, int]:
    """Map each linkable ADEM ``device_id`` to the ``object_id`` of its inventory device."""
    inventory_by_name: dict[str, list[int]] = {}
    for device in inventory:
        name = _normalize(device.get("name"))
        if name is not None:
            inventory_by_name.setdefault(name, []).append(device["object_id"])
    adem_counts: dict[str, int] = {}
    for device in adem:
        name = _normalize(device.get("device_name"))
        if name is not None:
            adem_counts[name] = adem_counts.get(name, 0) + 1
    links: dict[str, int] = {}
    for device in adem:
        name = _normalize(device.get("device_name"))
        if name is not None and adem_counts[name] == 1 and len(inventory_by_name.get(name, [])) == 1:
            links[device["device_id"]] = inventory_by_name[name][0]
    return links
