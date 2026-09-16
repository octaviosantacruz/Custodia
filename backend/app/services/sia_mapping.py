"""Map SIA access policies into the normalized CMDB.

Grantees (users/groups/roles) are kept as attributes on the access_policy
object for now, not as separate graph relationships: the API gives emails
for users but no stable, confirmed identifier space shared with any other
object type, and no groups/roles have been observed with real data yet.
Materializing edges from a guessed identifier would repeat the mistake the
project's own rules warn against (docs/architecture/integration-contracts.md:
"No tratar nombres como identificadores estables fuera de esa evidencia de
unión documentada").
"""

from __future__ import annotations

from typing import Any

from .cmdb_models import InventoryObject

SOURCE_SYSTEM = "sia"


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: Any) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _bool(value: Any) -> bool:
    return bool(value) if isinstance(value, bool) else False


def _optional_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _provider_rules(detail: dict[str, Any], key: str) -> list[Any]:
    """Keep the confirmed provider rule entries without guessing their shape."""
    providers = detail.get("providersData")
    on_prem = providers.get("OnPrem") if isinstance(providers, dict) else None
    values = on_prem.get(key) if isinstance(on_prem, dict) else None
    return values if isinstance(values, list) else []


def _grantees(rules: Any) -> dict[str, list[str]]:
    users: list[str] = []
    groups: list[str] = []
    roles: list[str] = []
    for rule in rules if isinstance(rules, list) else []:
        user_data = rule.get("userData") if isinstance(rule, dict) else None
        if not isinstance(user_data, dict):
            continue
        for entry in user_data.get("users") or []:
            if isinstance(entry, dict) and _text(entry.get("name")):
                users.append(_text(entry["name"]))
        for entry in user_data.get("groups") or []:
            if isinstance(entry, dict) and _text(entry.get("name")):
                groups.append(_text(entry["name"]))
        for entry in user_data.get("roles") or []:
            if isinstance(entry, dict) and _text(entry.get("name")):
                roles.append(_text(entry["name"]))
    return {"users": sorted(set(users)), "groups": sorted(set(groups)), "roles": sorted(set(roles))}


def map_sia_objects(policies: list[dict[str, Any]], details: dict[str, dict[str, Any]]) -> list[InventoryObject]:
    objects: list[InventoryObject] = []
    for policy in policies:
        policy_id = _text(policy.get("policyId"))
        display_name = _text(policy.get("policyName")) or policy_id
        if not policy_id:
            raise ValueError("/api/access-policies devolvió una política sin policyId")
        detail = details.get(policy_id) or {}
        grantees = _grantees(detail.get("userAccessRules"))
        objects.append(InventoryObject(
            object_type="access_policy",
            source_id=policy_id,
            display_name=display_name,
            source_system=SOURCE_SYSTEM,
            attributes={
                "status": _text(policy.get("status")),
                "description": _text(policy.get("description")),
                "platforms": _string_list(policy.get("platforms")),
                "rule_names": _string_list(policy.get("ruleNames")),
                "policy_type": _text(detail.get("policyType")),
                "ip_rules": _provider_rules(detail, "ipRules"),
                "fqdn_rules": _provider_rules(detail, "fqdnRules"),
                "logical_names": _provider_rules(detail, "logicalNames"),
                "granted_users": grantees["users"],
                "granted_groups": grantees["groups"],
                "granted_roles": grantees["roles"],
            },
        ))
    return objects


# Confirmed 2026-09-11 (see SIA-CONN-001 in docs/TO_IMPLEMENT.md). Excludes
# hostIp/hostName/hostNetwork/hostSubnet/hostInstanceId (host/network
# infrastructure, same criterion as SYS-001) and proxySettings (shape never
# observed with a non-empty value).
def map_sia_connectors(connectors: list[dict[str, Any]]) -> list[InventoryObject]:
    objects: list[InventoryObject] = []
    for connector in connectors:
        connector_id = _text(connector.get("id"))
        if not connector_id:
            raise ValueError("/api/connectors devolvió un conector sin id")
        objects.append(InventoryObject(
            object_type="sia_connector",
            source_id=connector_id,
            display_name=connector_id,
            source_system=SOURCE_SYSTEM,
            attributes={
                "status": _text(connector.get("status")),
                "status_code": _text(connector.get("statusCode")),
                "version": _text(connector.get("version")),
                "is_latest_version": _bool(connector.get("isLatestVersion")),
                "os": _text(connector.get("os")),
                "host_type": _text(connector.get("hostType")),
                "region": _text(connector.get("region")),
                "workspace_id": _text(connector.get("workspaceId")),
                "active_sessions_count": connector.get("activeSessionsCount") if isinstance(connector.get("activeSessionsCount"), int) else None,
            },
        ))
    return objects


# Confirmed 2026-09-11 (see SIA-RES-001). Excludes ip/fqdn/networkName (host
# infrastructure, same criterion as SYS-001). Modeled as object_type =
# 'sia_resource' with attributes.resource_type = 'virtual_machine' so a
# future Database resource listing (if one is ever found) can share the
# same object type instead of needing another migration.
def map_sia_virtual_machines(machines: list[dict[str, Any]]) -> list[InventoryObject]:
    objects: list[InventoryObject] = []
    for machine in machines:
        machine_id = _text(machine.get("machineId"))
        if not machine_id:
            raise ValueError("/api/infrastructure/virtual-machines devolvió una VM sin machineId")
        display_name = _text(machine.get("name")) or machine_id
        objects.append(InventoryObject(
            object_type="sia_resource",
            source_id=machine_id,
            display_name=display_name,
            source_system=SOURCE_SYSTEM,
            attributes={
                "resource_type": "virtual_machine",
                "os_type": _text(machine.get("osType")),
                "location_type": _text(machine.get("locationType")),
                "discovery_engine": _text(machine.get("discoveryEngine")),
                "scanned_on": _text(machine.get("scannedOn")),
            },
        ))
    return objects


# Confirmed 2026-09-11 (see SIA-STRONG-001). Only 2 tenant items observed, with
# differing key subsets between them, so only the fields confirmed present are
# mapped. accountProperties.address/username are excluded (host/credential
# identity, same criterion as SYS-001/PAM-USR-001); accountProperties.platform/
# port/database are safe. Own object_type ('sia_database_account'), not shared
# with sia_resource -- see migrations/043 for why.
def map_sia_database_strong_accounts(accounts: list[dict[str, Any]]) -> list[InventoryObject]:
    objects: list[InventoryObject] = []
    for account in accounts:
        account_id = _text(account.get("id"))
        if not account_id:
            raise ValueError("/api/database-strong-accounts devolvió una cuenta sin id")
        display_name = _text(account.get("name")) or account_id
        properties = account.get("accountProperties")
        properties = properties if isinstance(properties, dict) else {}
        objects.append(InventoryObject(
            object_type="sia_database_account",
            source_id=account_id,
            display_name=display_name,
            source_system=SOURCE_SYSTEM,
            attributes={
                "store_type": _text(account.get("storeType")),
                "platform": _text(properties.get("platform")),
                "port": _optional_int(properties.get("port")),
                "database": _text(properties.get("database")),
                "created_at": _text(account.get("createdAt")),
                "modified_at": _text(account.get("modifiedAt")),
            },
        ))
    return objects
