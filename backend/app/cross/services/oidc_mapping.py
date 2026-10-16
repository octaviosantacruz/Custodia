from __future__ import annotations

import json
import logging
import os
from typing import Any, Literal

from app.cross.repositories.oidc_group_roles import stored_group_role_pairs

LOGGER = logging.getLogger(__name__)


def role_map_from_environment() -> dict[str, str]:
    try:
        value = json.loads(os.environ.get("OIDC_ROLE_MAP_JSON", "{}"))
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError("OIDC_ROLE_MAP_JSON debe ser JSON válido") from exc


def environment_role_pairs() -> list[tuple[str, str]]:
    """OIDC_ROLE_MAP_JSON as (group, role) pairs, ignoring malformed entries."""
    return sorted(
        (group.strip(), role.strip()) for group, role in role_map_from_environment().items()
        if isinstance(group, str) and group.strip() and isinstance(role, str) and role.strip()
    )


async def effective_role_pairs(pool: Any) -> tuple[list[tuple[str, str]], Literal["database", "environment"]]:
    """ACCESS-UI-001: the mapping managed in DS Hub once adopted; until then, the environment."""
    stored = await stored_group_role_pairs(pool)
    if stored is not None:
        return stored, "database"
    return environment_role_pairs(), "environment"


def warn_if_default_role_is_unscoped() -> None:
    """OIDC_DEFAULT_ROLE is meant as a fallback for users whose IdP groups
    don't match any entry in OIDC_ROLE_MAP_JSON -- not as a blanket grant.
    If the role map is empty (unset, or "{}"), *every* successful OIDC
    login falls through to this default, silently handing out whatever
    role it names (e.g. "admin") to anyone who can authenticate at all,
    regardless of their real group membership at the IdP.

    This only logs a warning, not a hard startup failure: some environments
    (an isolated IdP preview/test tenant, or a deliberate temporary choice
    during rollout) may accept that risk on purpose. Called once at
    startup when OIDC is enabled (see build_lifespan)."""
    default_role = os.environ.get("OIDC_DEFAULT_ROLE", "").strip()
    if not default_role:
        return
    if not role_map_from_environment():
        LOGGER.warning(
            "OIDC_DEFAULT_ROLE=%s está configurado pero OIDC_ROLE_MAP_JSON está vacío o sin "
            "definir: todo usuario que se autentique vía OIDC va a recibir ese rol sin importar "
            "sus grupos reales en el proveedor de identidad. Completar OIDC_ROLE_MAP_JSON con el "
            "mapeo real de grupos antes de exponer este ambiente a más usuarios.",
            default_role,
        )


def _pairs(pairs: list[tuple[str, str]] | None) -> list[tuple[str, str]]:
    return environment_role_pairs() if pairs is None else pairs


def roles_from_claims(user: dict[str, Any], pairs: list[tuple[str, str]] | None = None) -> list[str]:
    """Roles the claimed groups grant; `pairs` defaults to the environment mapping."""
    groups = user.get(os.environ.get("OIDC_GROUP_CLAIM", "groups"), [])
    if isinstance(groups, str):
        groups = [groups]
    if not isinstance(groups, list):
        groups = []
    claimed = {group for group in groups if isinstance(group, str)}
    roles = [role for group, role in _pairs(pairs) if group in claimed]
    if not roles and os.environ.get("OIDC_DEFAULT_ROLE"):
        roles = [os.environ["OIDC_DEFAULT_ROLE"]]
    return sorted(set(roles))


def observed_mapped_groups(user: dict[str, Any], pairs: list[tuple[str, str]] | None = None) -> list[str] | None:
    """Exact mapped names from the verified login claim; never infer from roles."""
    groups = user.get(os.environ.get("OIDC_GROUP_CLAIM", "groups"))
    if isinstance(groups, str):
        groups = [groups]
    if not isinstance(groups, list):
        return None
    mapped = {group for group, _ in _pairs(pairs)}
    return sorted({group for group in groups if isinstance(group, str) and group in mapped})
