"""Stable response schemas for the Identity Administration CMDB surface
(AUD-API-002).

`attributes` stays an opaque JSON object on purpose: the SCIM-normalized field
set is decided by the identity ingestion mapping and differs per object type
(user, role, federation); the route descriptions document which core fields
exist, but the API does not publish them as a join surface.

`federation_resolution` mirrors the business-owned email-domain rule
(`services/identity_federation_resolution.py`), always labeled with
`match_basis: email_domain_rule`, never presented as a CyberArk edge.
`standard_seat_reconciled` is the exact-email annotation added by
`identity_pam_bridge`.

The PAM chain is the sanctioned cross-source bridge (exact UUID first, then
the approved exact-email exception); `match_basis` and `status` are always
published so the UI can label the link. Read-only, never fed into coverage or
KPIs.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import Field, BaseModel, ConfigDict

from app.cyberark.pam.api.routes.pam_chain_models import (
    PamChainObjectRef,
    PamChainRole,
    PamChainTotals,
)


class FederationResolutionRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: Literal[
        'matched', 'missing_federation', 'unsupported_domain', 'missing_email', 'ambiguous',
    ]
    match_basis: Literal['email_domain_rule']
    email_domain: str | None = None
    federation_code: str | None = None
    expected_name: str | None = None
    object_id: int | None = None
    source_id: str | None = None
    display_name: str | None = None
    active: bool | None = None


class IdentityUserRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]
    role_count: int
    standard_seat_reconciled: bool
    federation_resolution: FederationResolutionRow


class IdentityUsersResponse(BaseModel):
    rows: list[IdentityUserRow]
    total: int
    limit: int
    offset: int
    search: str
    active_filter: str
    standard_seat: str


class IdentityRoleRef(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str


class IdentityUserDetailRow(IdentityUserRow):
    first_seen_at: datetime
    last_seen_at: datetime


class IdentityUserDetailResponse(BaseModel):
    user: IdentityUserDetailRow
    roles: list[IdentityRoleRef]


class IdentityRoleRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]
    member_count: int


class IdentityRolesResponse(BaseModel):
    rows: list[IdentityRoleRow]
    total: int
    limit: int
    offset: int
    search: str


class IdentityRoleDetailRow(IdentityRoleRow):
    first_seen_at: datetime
    last_seen_at: datetime


class IdentityRoleDetailResponse(BaseModel):
    role: IdentityRoleDetailRow
    members: list[IdentityRoleRef]


class IdentityFederationRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]


class IdentityFederationsResponse(BaseModel):
    rows: list[IdentityFederationRow]
    total: int
    limit: int
    offset: int
    search: str


class IdentityFederationDetailRow(IdentityFederationRow):
    first_seen_at: datetime
    last_seen_at: datetime


class IdentityPamChainResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    matched: bool
    pam_user: PamChainObjectRef | None = None
    roles: list[PamChainRole]
    roles_omitted: int
    totals: PamChainTotals
    match_basis: Literal['uuid', 'email'] | None = None
    status: Literal['matched', 'ambiguous', 'unmatched']


class IdentityUnresolvedMember(BaseModel):
    display_name: str
    kind: Literal['user', 'role', 'unknown']


class IdentityMembershipNode(BaseModel):
    object_id: int
    display_name: str
    source_id: str
    kind: Literal['user', 'role', 'okta_group']
    membership_status: Literal['complete', 'not_reported']
    unresolved_member_count: int
    direct_member_count: int | None = None
    unresolved_members: list[IdentityUnresolvedMember] = Field(default_factory=list)
    user_name: str = ""
    last_seen_at: datetime | None


class IdentityMembershipEdge(BaseModel):
    parent_id: int
    member_id: int


class IdentityMembershipResponse(BaseModel):
    root_id: int
    nodes: list[IdentityMembershipNode]
    edges: list[IdentityMembershipEdge]
    truncated: bool


class IdentityRoleMatchRef(BaseModel):
    id: str
    object_id: int | None = None
    name: str
    traversal: list["IdentityRoleMatchRef"] = Field(default_factory=list)


class IdentityDirectMatchGroup(BaseModel):
    roles: list[IdentityRoleMatchRef]
    direct_members: int


class IdentityAccountMatchGroup(BaseModel):
    roles: list[IdentityRoleMatchRef]
    referenced_accounts: int


class IdentityRoleMatchesResponse(BaseModel):
    same_direct_members: list[IdentityDirectMatchGroup]
    same_user_references: list[IdentityAccountMatchGroup]
    roles_with_incomplete_user_paths: list[str]
    permissions_status: Literal['not_collected']
    scope: Literal['Coincidencia de miembros; no prueba permisos iguales ni autoriza retirar roles']
    source: "IdentityRoleMatchSource"
    complete: bool
    roles_analyzed: int
    roles_excluded: int


class IdentityRoleMatchSource(BaseModel):
    source_system: str
    last_run_status: str | None
    last_run_finished_at: datetime | None


IdentityRoleMatchRef.model_rebuild()
IdentityRoleMatchesResponse.model_rebuild()
