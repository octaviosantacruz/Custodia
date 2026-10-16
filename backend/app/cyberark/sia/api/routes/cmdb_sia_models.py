"""Stable response schemas for the SIA CMDB surface (AUD-API-002).

`attributes` stays an opaque JSON object on purpose (the SIA mapping owns the
normalized field set, which differs per object type).

Two shapes deserve a note:

- The list row carries the derived Safe linkage (`linked_safes`,
  `linked_ip_count`, `linkage_status`) computed by `_safe_links_by_ip`, but
  the detail row does not: `get_sia_policy_detail` only projects the stored
  object. That asymmetry is modeled explicitly instead of forcing one shape.
- `destination` in the destinations endpoint is the raw jsonb element:
  `ip_rules` can hold a literal string or an object with
  `ipAddresses`/`ip_addresses`/`ips`, while FQDN and logical names are
  strings. The repository intentionally does not normalize it (its extractor
  handles both when linking Safes), so it is published as `Any` and the UI
  must treat it as opaque display data.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SiaPolicySafeAccountRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    account_id: str
    account_name: str
    address: str | None = None
    platform_name: str | None = None
    platform_id: str | None = None


class SiaPolicyLinkedSafeRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    safe_number: int
    safe_name: str
    matched_ips: list[str]
    accounts: list[SiaPolicySafeAccountRow]


class SiaPolicyGranteeMatch(BaseModel):
    object_id: int
    display_name: str


class SiaPolicyGranteeSide(BaseModel):
    status: Literal['matched', 'ambiguous', 'unmatched']
    match: SiaPolicyGranteeMatch | None = None


class SiaPolicyGranteeLink(BaseModel):
    value: str
    identity: SiaPolicyGranteeSide | None = None
    pam: SiaPolicyGranteeSide | None = None


class SiaPolicyRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]
    linked_safes: list[SiaPolicyLinkedSafeRow]
    linked_ip_count: int
    linkage_status: Literal['linked', 'multiple', 'unlinked']
    grantee_links: list[SiaPolicyGranteeLink] = Field(default_factory=list)


class SiaPoliciesResponse(BaseModel):
    rows: list[SiaPolicyRow]
    total: int
    limit: int
    offset: int
    search: str
    status_filter: str
    linkage_status: str


class SiaPolicyDetailRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]
    first_seen_at: datetime
    last_seen_at: datetime
    grantee_links: list[SiaPolicyGranteeLink] = Field(default_factory=list)


class SiaPolicyDetailResponse(BaseModel):
    policy: SiaPolicyDetailRow


class SiaDestinationRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    policy_object_id: int
    display_name: str
    source_id: str
    platforms: list[str]
    destination_type: Literal['ip', 'fqdn', 'logical_name']
    destination: Any = None


class SiaDestinationsResponse(BaseModel):
    rows: list[SiaDestinationRow]
    total: int
    limit: int
    offset: int
    search: str
    destination_type: str


class SiaConnectorRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]


class SiaConnectorsResponse(BaseModel):
    rows: list[SiaConnectorRow]
    total: int
    limit: int
    offset: int
    search: str


class SiaResourceRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]


class SiaResourcesResponse(BaseModel):
    rows: list[SiaResourceRow]
    total: int
    limit: int
    offset: int
    search: str
    resource_type: str


class SiaDatabaseAccountRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]


class SiaDatabaseAccountsResponse(BaseModel):
    rows: list[SiaDatabaseAccountRow]
    total: int
    limit: int
    offset: int
    search: str


class SiaTargetSetRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]


class SiaTargetSetsResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    rows: list[SiaTargetSetRow]
    total: int
    limit: int
    offset: int
    search: str
