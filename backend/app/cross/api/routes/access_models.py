from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class PermissionRow(BaseModel):
    permission_code: str
    domain_code: str
    resource_code: str
    action_code: str
    description: str
    lifecycle_status: str
    system_managed: bool


class PermissionsResponse(BaseModel):
    rows: list[PermissionRow]


class RoleLevelDetail(BaseModel):
    domain_code: str
    level_code: str
    level_display_name: str
    base_role_code: str


class RoleRow(BaseModel):
    role_code: str
    display_name: str
    description: str
    domain_code: str | None
    lifecycle_status: str
    system_managed: bool
    role_kind: str
    permission_codes: list[str]
    level_refs: list[RoleLevelDetail]
    user_count: int
    oidc_groups: list[str]


class RolesResponse(BaseModel):
    rows: list[RoleRow]


class DomainLevel(BaseModel):
    level_code: str
    display_name: str
    base_role_code: str
    lifecycle_status: str
    permission_codes: list[str]


class DomainRow(BaseModel):
    domain_code: str
    display_name: str
    lifecycle_status: str
    sort_order: int
    levels: list[DomainLevel]


class DomainsResponse(BaseModel):
    rows: list[DomainRow]


class CreatedPermissionResponse(BaseModel):
    created: Literal[True]
    permission_code: str


class CreatedRoleResponse(BaseModel):
    created: Literal[True]
    role_code: str


class CompositeWarning(BaseModel):
    code: Literal['duplicate_combination']
    matching_role_code: str
    matching_role_name: str


class CompositeRoleResponse(BaseModel):
    created: bool
    updated: bool
    role_code: str
    warning: CompositeWarning | None


class OidcRoleMappingEntry(BaseModel):
    group: str
    role_code: str
    role_exists: bool
    role_status: str | None
    role_display_name: str | None


class OidcHealthWarning(BaseModel):
    code: str
    level: Literal['warning', 'notice']
    message: str


# ACCESS-OIDC-HEALTH-001: non-secret configuration plus deterministic
# warnings. Deliberately has no field for client id/secret, tokens, callback
# credentials or identity payloads.
class OidcHealthResponse(BaseModel):
    mode: Literal['local', 'oidc', 'hybrid']
    enabled: bool
    configured: bool
    issuer: str | None
    scopes: str
    redirect_uri_configured: bool
    group_claim: str | None
    group_claim_effective: str
    default_role: str | None
    default_role_status: str | None
    default_role_display_name: str | None
    # ACCESS-UI-001: 'database' once the mapping is edited from Custodia.
    role_map_source: Literal['database', 'environment']
    role_map: list[OidcRoleMappingEntry]
    last_oidc_login_at: datetime | None
    oidc_identity_count: int
    warnings: list[OidcHealthWarning]


class UpdatedResponse(BaseModel):
    updated: Literal[True]


class OidcGroupRolesResponse(BaseModel):
    group: str
    role_codes: list[str]
