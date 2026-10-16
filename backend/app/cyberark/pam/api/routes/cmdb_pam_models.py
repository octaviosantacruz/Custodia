"""Stable response schemas for the PAM CMDB surface (AUD-API-002).

`attributes` stays an opaque JSON object on purpose (the PAM mapping owns the
normalized field set per object type). The role list/detail publish SIA hits
as explicit name references labeled `display_name_reference_only`, never as
normalized relationships. The platform/connector/PSM rows aggregate their
related objects as small `PamChainObjectRef`s, and the component summary
keeps `latest_logon_at` as the raw epoch it stores (nullable).

The end-to-end user chain reuses the shared traversal models from
`pam_chain_models.py` so it cannot drift from the Identity bridge.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.cyberark.pam.api.routes.pam_chain_models import PamChainObjectRef, PamChainRole, PamChainTotals


class PamRoleRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]
    member_count: int
    safe_count: int
    account_count: int
    role_examples: list[PamChainObjectRef]
    sia_reference_count: int


class PamRolesResponse(BaseModel):
    rows: list[PamRoleRow]
    total: int
    limit: int
    offset: int
    search: str
    kind: str


class PamRoleDetailRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]
    first_seen_at: datetime
    last_seen_at: datetime


class PamRoleSafeRow(PamChainObjectRef):
    account_count: int


class PamSiaReferenceRow(PamChainObjectRef):
    attributes: dict[str, Any]


class PamRoleDetailResponse(BaseModel):
    role: PamRoleDetailRow
    users: list[PamChainObjectRef]
    safes: list[PamRoleSafeRow]
    sia_references: list[PamSiaReferenceRow]
    sia_match_type: Literal['display_name_reference_only']


class PamUserRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    role_count: int
    standard_seat_reconciled: bool
    enabled: bool
    suspended: bool


class PamUsersResponse(BaseModel):
    rows: list[PamUserRow]
    total: int
    limit: int
    offset: int
    search: str
    standard_seat: str
    status: str


class PamPlatformRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    system_type: str
    active: bool
    allowed_safes_pattern: str
    safe_count: int
    account_count: int
    psms: list[PamChainObjectRef]


class PamPlatformsResponse(BaseModel):
    rows: list[PamPlatformRow]
    total: int
    limit: int
    offset: int
    search: str


class PamConnectorRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    address: str
    platform_count: int
    platforms: list[PamChainObjectRef]


class PamConnectorsResponse(BaseModel):
    rows: list[PamConnectorRow]
    total: int
    limit: int
    offset: int
    search: str


class PsmConnectorTypeRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str


class PsmConnectorTypesResponse(BaseModel):
    rows: list[PsmConnectorTypeRow]
    total: int
    limit: int
    offset: int
    search: str


class PamComponentRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    description: str
    total_count: int
    connected_count: int
    instance_versions: list[str]
    latest_logon_at: int | None = None
    all_instances_logged_on: bool


class PamComponentsResponse(BaseModel):
    rows: list[PamComponentRow]


class PamPlatformCatalogDependentRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    platform_base_id: str
    platform_base_type: str
    linked_target_platforms: int


class PamPlatformCatalogGroupRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    active: bool


class PamPlatformCatalogsResponse(BaseModel):
    dependents: list[PamPlatformCatalogDependentRow]
    groups: list[PamPlatformCatalogGroupRow]
    rotational_groups: list[PamPlatformCatalogGroupRow]


class PamPlatformTargetRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    platform_base_id: str
    dual_control_required: bool
    otp_required: bool
    reason_required: bool
    exclusive_access_required: bool
    credentials_change_automatic: bool
    credentials_change_interval_days: int | None = None
    credentials_verify_automatic: bool
    credentials_verify_interval_days: int | None = None
    credentials_reconcile_automatic: bool
    psm_server_id: str


class PamPlatformTargetsResponse(BaseModel):
    rows: list[PamPlatformTargetRow]
    total: int
    limit: int
    offset: int
    search: str


class PamUserChainResponse(BaseModel):
    matched: bool
    pam_user: PamChainObjectRef | None = None
    roles: list[PamChainRole]
    roles_omitted: int
    totals: PamChainTotals


class PamCleanupPeerGroup(BaseModel):
    object_id: int
    display_name: str
    source_id: str
    safe_count: int


class PamCleanupSignalItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    reason: str
    is_factory: bool = False
    factory_label: str | None = None
    member_count: int | None = None
    safe_count: int | None = None
    peer_groups: list[PamCleanupPeerGroup] = Field(default_factory=list)
    inventory_scope: Literal["pending", "business", "internal"] | None = None
    account_type_classification: Literal["nominal", "no_nominal", "internal"] | None = None
    classification_status: Literal["pending", "assigned", "review"] | None = None


class PamCleanupInventoryRun(BaseModel):
    model_config = ConfigDict(extra="ignore")

    run_id: str
    source_system: Literal["cyberark"]
    source_file: Literal["cyberark-api", "cyberark-psm-api"]
    status: Literal["queued", "running", "completed", "partial", "failed"]
    enqueued_at: datetime
    started_at: datetime
    completed_at: datetime | None
    inventory_refreshed: bool


class PamCleanupInventoryEvidence(BaseModel):
    family: Literal["pam_inventory", "psm_catalog"]
    latest_attempt: PamCleanupInventoryRun | None
    last_completed_inventory: PamCleanupInventoryRun | None


class PamCleanupSignalResponse(BaseModel):
    count: int
    denominator: int
    items: list[PamCleanupSignalItem]
    computed_at: datetime
    inventory_runs: list[PamCleanupInventoryEvidence]


class PamCleanupSignalsResponse(BaseModel):
    empty_groups: PamCleanupSignalResponse
    identical_member_groups: PamCleanupSignalResponse
    redundant_groups_with_access_peer: PamCleanupSignalResponse
    orphan_psm: PamCleanupSignalResponse
    platforms_without_accounts: PamCleanupSignalResponse
    safes_without_active_users: PamCleanupSignalResponse
