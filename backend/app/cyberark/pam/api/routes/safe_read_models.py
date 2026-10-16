"""Stable response schemas for the Safe and account inventory reads
(AUD-API-002).

`SafeDetailRow` intentionally allowlists `public.safes.*` plus the manual
metadata instead of publishing the raw row: a new database column must be a
deliberate contract decision, not an accidental leak (same rationale as
`inventory_models.py`).
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class SafeListRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    safe_number: int
    safe_name: str
    safe_url_id: str
    location: str | None = None
    member_count: int
    account_count: int
    cpm_configured: bool
    olac_enabled: bool | None = None
    retention_configured: bool | None = None
    number_of_days_retention: int | None = None
    number_of_versions_retention: int | None = None
    retired_account_count: int = 0
    last_account_retired_at: datetime | None = None
    manage_safe_principal_count: int
    account_type_counts: dict[str, int]
    internal_name: str | None = None
    business_unit_id: int | None = None
    responsible_id: int | None = None
    classification_status: str
    inventory_scope: str
    account_type_classification: str | None = None
    data_quality_status: str
    workflow_status: str
    next_action: str | None = None
    scope_hint: str | None = None
    business_unit_name: str | None = None
    responsible_name: str | None = None


class SafeClassificationCounts(BaseModel):
    assigned: int
    review: int
    pending: int


class SafeListResponse(BaseModel):
    rows: list[SafeListRow]
    total: int
    classification_counts: SafeClassificationCounts
    limit: int
    offset: int
    search: str
    workflow_status: str
    classification_status: str
    account_type: str
    inventory_scope: str
    data_quality_status: str
    scope_hint: str
    health_filter: str
    next_action: str
    business_unit: str
    responsible: str
    include_accounts: bool = False


class SafeMemberRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    member_id: str
    member_name: str
    member_type: str
    membership_expiration_date: datetime | None = None
    lifecycle_status: str
    is_predefined_user: bool | None = None
    is_read_only: bool | None = None
    permissions: dict[str, Any]


class SafeDetailRow(BaseModel):
    """The detail projection is the raw Safe row plus manual metadata, not a
    superset of `SafeListRow`: `member_count`, `cpm_configured` and
    `manage_safe_principal_count` are only computed by the list query."""

    model_config = ConfigDict(extra="ignore")

    safe_number: int
    safe_name: str
    safe_url_id: str
    location: str | None = None
    creator_id: str | None = None
    creator_name: str | None = None
    olac_enabled: bool | None = None
    number_of_versions_retention: int | None = None
    number_of_days_retention: int | None = None
    auto_purge_enabled: bool | None = None
    creation_time: datetime | None = None
    last_modification_time: datetime | None = None
    description: str | None = None
    managing_cpm: str | None = None
    is_expired_member: bool | None = None
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    source_run_id: UUID | None = None
    lifecycle_status: str
    retired_at: datetime | None = None
    internal_name: str | None = None
    business_unit_id: int | None = None
    responsible_id: int | None = None
    classification_status: str | None = None
    inventory_scope: str | None = None
    account_type_classification: str | None = None
    data_quality_status: str | None = None
    workflow_status: str | None = None
    next_action: str | None = None
    notes: str | None = None
    assigned_at: datetime | None = None
    assigned_by: str | None = None
    account_count: int
    account_type_counts: dict[str, int]
    business_unit_name: str | None = None
    responsible_name: str | None = None


class SafeDetailResponse(BaseModel):
    safe: SafeDetailRow
    members: list[SafeMemberRow]


class AccountRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    safe_number: int
    safe_name: str
    account_id: str
    account_name: str
    user_name: str | None = None
    address: str | None = None
    platform_id: str | None = None
    platform_name: str | None = None
    lifecycle_status: str
    last_seen_at: datetime
    retired_detected_at: datetime | None = None
    attributes: dict[str, Any]
    inventory_account_type: str | None = None


class AccountListResponse(BaseModel):
    rows: list[AccountRow]
    total: int
    limit: int
    offset: int
