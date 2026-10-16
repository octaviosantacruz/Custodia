"""Response schemas for the Cadenas explorer (AUD-API-002 style)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class ChainRelation(BaseModel):
    kind: Literal["persisted", "derived", "reference"]
    basis: str


class ChainIdentity(BaseModel):
    """Identity person linked to a PAM user (exact UUID or exact email, 1 to 1)."""

    object_id: int
    display_name: str
    email: str
    basis: Literal["uuid_exact", "email_exact"]


class ChainCounts(BaseModel):
    forward: int
    back: int


class ChainNodeInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str
    id: int
    label: str
    sublabel: str
    counts: ChainCounts
    catalog_missing: bool = False
    identity: ChainIdentity | None = None


class ChainNodeResponse(BaseModel):
    node: ChainNodeInfo


class ChainHop(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str
    id: int
    label: str
    sublabel: str
    relation: ChainRelation
    counts: ChainCounts
    catalog_missing: bool = False
    restricted: bool = False
    identity: ChainIdentity | None = None


class ChainExpandResponse(BaseModel):
    type: str
    id: int
    direction: Literal["forward", "back"]
    rows: list[ChainHop]
    total: int
    limit: int
    offset: int


class ChainSearchItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str
    id: int
    label: str
    sublabel: str
    standard_seat_reconciled: bool = False
    identity: ChainIdentity | None = None


class ChainSearchResponse(BaseModel):
    query: str
    groups: dict[str, list[ChainSearchItem]]


class PersonSearchResult(BaseModel):
    email: str
    name: str
    sources: list[str]


class PersonSearchResponse(BaseModel):
    query: str
    people: list[PersonSearchResult]


class PersonToolUser(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    user_type: str | None = None
    suspended: bool | None = None
    active: bool | None = None
    last_login_date: str | None = None


class PersonToolTotals(BaseModel):
    roles: int = 0
    safes: int = 0
    platforms: int = 0
    psms: int = 0
    accounts: int = 0


class PersonFederation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str


class PersonRoleAccess(BaseModel):
    """PAM access reached through Identity roles linked by exact unique name."""

    basis: str
    matched_roles: int
    ambiguous_roles: int
    safes: int


class PersonSiaAccess(BaseModel):
    """SIA policies reaching a person by exact grantee name: directly or through an Identity role."""

    basis: str
    user_policies: int
    role_policies: int
    policies: int
    matched_roles: int
    ambiguous_roles: int


class PersonToolSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: Literal["matched", "ambiguous", "unmatched", "reference"]
    basis: str = ""
    user: PersonToolUser | None = None
    totals: PersonToolTotals | None = None
    federation: PersonFederation | None = None
    role_count: int = 0
    policy_count: int = 0
    device_count: int = 0
    stale_device_count: int = 0
    client_versions: list[str] = []
    operating_systems: list[str] = []
    company: str = ""
    role_access: PersonRoleAccess | None = None
    sia_access: PersonSiaAccess | None = None


class PersonSummaryResponse(BaseModel):
    email: str
    name: str
    tools: dict[str, PersonToolSummary]
