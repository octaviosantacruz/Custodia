"""Read-only OIDC diagnostic for the Administration workspace.

ACCESS-OIDC-HEALTH-001. Surfaces only non-secret configuration (issuer,
scopes, expected group claim, configured group->role mappings, default role)
plus role existence/lifecycle and the last observed OIDC login. It never
returns client id/secret, tokens, callback credentials, environment dumps or
identity payloads.

Layer ownership: this module is the configuration/health service; the HTTP
route (api/routes/access_control.py) owns authorization and the response
contract; repositories/access_control.py and repositories/auth_queries.py
provide the role catalog and login timestamp reads.
"""
from __future__ import annotations

import os
from typing import Any

from app.auth import AUTH_MODE, OIDC_CONFIGURED, OIDC_ISSUER_URL
from app.cross.repositories.access_control import list_roles
from app.cross.repositories.auth_queries import get_oidc_login_summary
from app.cross.repositories.oidc_group_roles import stored_group_role_pairs
from app.cross.services.oidc_mapping import role_map_from_environment

VALID_AUTH_MODES = ("local", "oidc", "hybrid")
OIDC_MODES = {"oidc", "hybrid"}
DEFAULT_GROUP_CLAIM = "groups"
PRIVILEGED_PERMISSION_SUFFIX = ":manage"

WARNING_OIDC_NOT_CONFIGURED = "oidc_not_configured"
WARNING_GROUP_CLAIM_MISSING = "group_claim_missing"
WARNING_ROLE_MAP_INVALID = "role_map_invalid"
WARNING_ROLE_MAP_EMPTY = "role_map_empty"
WARNING_ROLE_UNKNOWN = "role_unknown"
WARNING_ROLE_INACTIVE = "role_inactive"
WARNING_DEFAULT_ROLE_PRIVILEGED = "default_role_privileged"

# Deterministic evaluation order for the API response and its regression tests.
WARNING_ORDER = (
    WARNING_OIDC_NOT_CONFIGURED,
    WARNING_GROUP_CLAIM_MISSING,
    WARNING_ROLE_MAP_INVALID,
    WARNING_ROLE_MAP_EMPTY,
    WARNING_ROLE_UNKNOWN,
    WARNING_ROLE_INACTIVE,
    WARNING_DEFAULT_ROLE_PRIVILEGED,
)


def _warning(code: str, message: str) -> dict[str, str]:
    return {"code": code, "level": "warning", "message": message}


def normalized_auth_mode() -> str:
    """AUTH_MODE with the same coercion the auth routes publish: an unknown
    value is reported as `local` instead of inventing a fourth mode."""
    mode = str(AUTH_MODE).strip().lower()
    return mode if mode in VALID_AUTH_MODES else "local"


def collect_oidc_configuration() -> dict[str, Any]:
    """Non-secret OIDC configuration read from the process environment.

    Deliberately excludes client id/secret and any token material: the client
    secret is only consulted through auth.py's boolean `OIDC_CONFIGURED`, so
    its value never enters this module's output.
    """
    mode = normalized_auth_mode()
    group_claim = os.environ.get("OIDC_GROUP_CLAIM", "").strip()
    default_role = os.environ.get("OIDC_DEFAULT_ROLE", "").strip()
    role_map_invalid = False
    try:
        raw_role_map = role_map_from_environment()
    except RuntimeError:
        raw_role_map = {}
        role_map_invalid = True
    return {
        "mode": mode,
        "enabled": mode in OIDC_MODES,
        "configured": bool(OIDC_CONFIGURED),
        "issuer": OIDC_ISSUER_URL or None,
        "scopes": os.environ.get("OIDC_SCOPES", "openid profile email").strip() or "openid profile email",
        "redirect_uri_configured": bool(os.environ.get("OIDC_REDIRECT_URI", "").strip()),
        "group_claim": group_claim or None,
        "group_claim_effective": group_claim or DEFAULT_GROUP_CLAIM,
        "default_role": default_role or None,
        "role_map": [
            {"group": group, "role_code": role_code}
            for group, role_code in sorted(raw_role_map.items())
            if isinstance(group, str) and group.strip() and isinstance(role_code, str) and role_code.strip()
        ],
        "role_map_invalid": role_map_invalid,
    }


def build_warnings(config: dict[str, Any], roles: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    """Deterministic warnings for the operator, ordered by WARNING_ORDER.

    `roles` maps role_code -> role row (lifecycle_status, permission_codes,
    display_name). Warnings only apply while OIDC is enabled: in `local` mode
    the mapping is inert and must not be presented as a problem.
    """
    if not config.get("enabled"):
        return []
    warnings: list[dict[str, str]] = []
    if not config.get("configured"):
        warnings.append(_warning(
            WARNING_OIDC_NOT_CONFIGURED,
            "OIDC está habilitado en AUTH_MODE pero falta issuer, client id o el secreto del cliente: ningún login OIDC puede completarse.",
        ))
    if not config.get("group_claim"):
        warnings.append(_warning(
            WARNING_GROUP_CLAIM_MISSING,
            "OIDC_GROUP_CLAIM no está configurado: se asume el claim por defecto 'groups', que puede no coincidir con el proveedor de identidad.",
        ))
    if config.get("role_map_invalid"):
        warnings.append(_warning(
            WARNING_ROLE_MAP_INVALID,
            "OIDC_ROLE_MAP_JSON no es JSON válido: el mapping de grupos se ignora y todo login cae al default role.",
        ))
    entries = config.get("role_map") or []
    if not entries and not config.get("role_map_invalid"):
        warnings.append(_warning(
            WARNING_ROLE_MAP_EMPTY,
            "OIDC_ROLE_MAP_JSON está vacío o sin entradas: ningún grupo del proveedor asigna un rol y aplica el default role.",
        ))

    groups_by_role: dict[str, list[str]] = {}
    for entry in entries:
        groups_by_role.setdefault(entry["role_code"], []).append(entry["group"])
    default_role = config.get("default_role")
    if default_role and default_role not in groups_by_role:
        groups_by_role[default_role] = []
    for role_code in sorted(groups_by_role):
        groups = sorted(groups_by_role[role_code])
        context = f"El grupo {', '.join(groups)} apunta a" if groups else "El default role es"
        role = roles.get(role_code)
        if role is None:
            warnings.append(_warning(
                WARNING_ROLE_UNKNOWN,
                f"{context} {role_code}, que no existe en el catálogo local de roles.",
            ))
        elif role.get("lifecycle_status") != "active":
            status = role.get("lifecycle_status") or "desconocido"
            warnings.append(_warning(
                WARNING_ROLE_INACTIVE,
                f"{context} {role_code}, que está en estado '{status}' y no otorga acceso efectivo.",
            ))
    if default_role:
        role = roles.get(default_role) or {}
        privileged = sorted(
            code for code in role.get("permission_codes", [])
            if code == "access:manage" or code.endswith(PRIVILEGED_PERMISSION_SUFFIX)
        )
        if privileged:
            warnings.append(_warning(
                WARNING_DEFAULT_ROLE_PRIVILEGED,
                f"OIDC_DEFAULT_ROLE={default_role} otorga permisos administrativos ({', '.join(privileged)}): "
                "cualquier usuario OIDC sin grupo mapeado los recibe.",
            ))
    order = {code: index for index, code in enumerate(WARNING_ORDER)}
    return sorted(warnings, key=lambda item: order[item["code"]])


async def collect_oidc_health(pool: Any) -> dict[str, Any]:
    """Build the full read-only diagnostic payload for the admin route."""
    config = collect_oidc_configuration()
    stored = await stored_group_role_pairs(pool)
    if stored is not None:
        # ACCESS-UI-001: once managed in Custodia, the login no longer reads OIDC_ROLE_MAP_JSON.
        config["role_map"] = [{"group": group, "role_code": role_code} for group, role_code in stored]
        config["role_map_invalid"] = False
    role_rows = await list_roles(pool)
    roles = {row["role_code"]: row for row in role_rows}
    login = await get_oidc_login_summary(pool)
    default_role = config["default_role"]
    default_role_row = roles.get(default_role) if default_role else None
    return {
        "mode": config["mode"],
        "enabled": config["enabled"],
        "configured": config["configured"],
        "issuer": config["issuer"],
        "scopes": config["scopes"],
        "redirect_uri_configured": config["redirect_uri_configured"],
        "group_claim": config["group_claim"],
        "group_claim_effective": config["group_claim_effective"],
        "default_role": default_role,
        "default_role_status": default_role_row.get("lifecycle_status") if default_role_row else None,
        "default_role_display_name": default_role_row.get("display_name") if default_role_row else None,
        "role_map_source": "database" if stored is not None else "environment",
        "role_map": [
            {
                "group": entry["group"],
                "role_code": entry["role_code"],
                "role_exists": entry["role_code"] in roles,
                "role_status": roles.get(entry["role_code"], {}).get("lifecycle_status"),
                "role_display_name": roles.get(entry["role_code"], {}).get("display_name"),
            }
            for entry in config["role_map"]
        ],
        "last_oidc_login_at": login["last_login_at"],
        "oidc_identity_count": login["identities"],
        "warnings": build_warnings(config, roles),
    }
