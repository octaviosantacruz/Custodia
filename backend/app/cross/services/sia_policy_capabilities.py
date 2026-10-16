"""COV-003: SIA policy classification (Platform / DBA / other) and its name-based suggestion.

The suggestion only reads the policy name for a person to confirm; nothing here classifies a policy by itself, and the
rules of the policy are never read for it (that would need an explicit approval).
"""

from __future__ import annotations

import re
from typing import Any

from app.cross.repositories.sia_policy_capabilities import list_policy_capabilities, set_policy_capabilities

CAPABILITIES = ("platform", "dba", "other")
_SUGGESTION = re.compile(r"(?:^|[-_ ])(platform|dba)$", re.IGNORECASE)


def suggest_capability(name: str) -> str | None:
    match = _SUGGESTION.search(name.strip())
    return match.group(1).lower() if match else None


async def policies_with_suggestions(pool) -> list[dict[str, Any]]:
    rows = await list_policy_capabilities(pool)
    return [{**row, "suggested": suggest_capability(row["display_name"])} for row in rows]


async def classify_policies(pool, items: list[dict[str, Any]], actor_id: str) -> int:
    if not items:
        raise ValueError("No hay políticas para clasificar")
    if len({item["policy_source_id"] for item in items}) != len(items):
        raise ValueError("Una política aparece más de una vez")
    return await set_policy_capabilities(pool, items, actor_id)
