"""Stable response schemas for the user administration surface (AUD-API-002).

The directory is a union of local and OIDC identities: `auth_source` says
which side a row came from, and `last_login_at` is only meaningful for OIDC
(local rows carry NULL by construction in `user_admin.list_users`). The
mutation endpoints return small acknowledgment objects, typed with literals
so the published contract cannot silently drift from the `True` flags the
routes actually return. `temporary_password` is the one-time value the
backend authorizes and audits; it is returned once and never stored in clear
text.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class RoleAssignment(BaseModel):
    """ACCESS-UI-001: 'oidc' roles come from the identity's groups at login;
    'manual' roles were assigned in Custodia and no login removes them."""

    role_code: str
    source: Literal['oidc', 'manual']


class UserListRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    actor_id: str
    email: str
    display_name: str
    is_active: bool
    must_change_password: bool
    created_at: datetime
    updated_at: datetime
    auth_source: Literal['local', 'oidc']
    last_login_at: datetime | None = None
    roles: list[str]
    role_assignments: list[RoleAssignment] = []


class UsersResponse(BaseModel):
    rows: list[UserListRow]
    total: int
    limit: int
    offset: int


class PersonIdentity(BaseModel):
    model_config = ConfigDict(extra="ignore")

    actor_id: str
    email: str
    display_name: str
    is_active: bool
    must_change_password: bool
    auth_source: Literal['local', 'oidc']
    last_login_at: datetime | None = None
    roles: list[str]
    role_assignments: list[RoleAssignment] = []
    observed_groups: list[str] | None = None
    groups_observed_at: datetime | None = None


class PersonRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str
    email: str
    display_name: str
    identities: list[PersonIdentity]


class PeopleResponse(BaseModel):
    rows: list[PersonRow]
    total: int
    limit: int
    offset: int


class UserCreatedResponse(BaseModel):
    created: Literal[True]
    actor_id: str
    temporary_password: str


class UserUpdatedResponse(BaseModel):
    updated: Literal[True]


class TemporaryPasswordResponse(BaseModel):
    temporary_password: str


class UserDeletedResponse(BaseModel):
    deleted: Literal[True]
    actor_id: str


class OidcGroupMember(BaseModel):
    actor_id: str
    email: str
    display_name: str
    groups_observed_at: datetime


class ObservedOidcGroup(BaseModel):
    group: str
    role_codes: list[str]
    member_count: int
    members: list[OidcGroupMember]


class ObservedOidcGroupsResponse(BaseModel):
    rows: list[ObservedOidcGroup]
    # ACCESS-UI-001: 'environment' until the first edit from Custodia adopts OIDC_ROLE_MAP_JSON.
    source: Literal['database', 'environment']
    observed_identities: int
    unobserved_identities: int


class UserRoleGrantedResponse(BaseModel):
    granted: Literal[True]
    actor_id: str
    role_code: str


class UserRoleRevokedResponse(BaseModel):
    revoked: Literal[True]
    actor_id: str
    role_code: str


class AccessReviewRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    actor_id: str
    email: str
    display_name: str
    is_active: bool
    auth_source: Literal['local', 'oidc']
    last_login_at: datetime | None = None
    role_code: str
    role_name: str
    source: Literal['oidc', 'manual']
    granted_at: datetime | None = None
    granted_by: str | None = None
    flags: list[Literal['inactive_account', 'manual_old', 'stale_login']]


class AccessReviewSummary(BaseModel):
    assignments: int
    attention: int
    inactive_account: int
    manual_old: int
    stale_login: int


class AccessReviewResponse(BaseModel):
    rows: list[AccessReviewRow]
    total: int
    limit: int
    offset: int
    days: int
    summary: AccessReviewSummary
