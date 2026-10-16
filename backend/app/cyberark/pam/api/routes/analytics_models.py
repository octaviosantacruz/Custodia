"""Stable response schemas for the analytics surface (AUD-API-002).

Mirrors the repository projections exactly; this types what the endpoints
already return instead of reshaping it. Counts are integers, bucket labels are
display strings, and `connection_coverage.import` keeps its JSON key through a
field alias (`import` is a Python keyword).
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.cross.api.routes.connection_inventory_models import ConnectionImport as ConnectionImport


class SafeHealth(BaseModel):
    model_config = ConfigDict(extra="ignore")

    denominator: int
    missing_cpm: int
    no_accounts: int
    olac_disabled: int
    retention_unconfigured: int
    manage_safe_concentration: int


class SummaryLatestRun(BaseModel):
    model_config = ConfigDict(extra="ignore")

    run_id: UUID
    source_system: str
    source_file: str | None = None
    status: str
    started_at: datetime
    completed_at: datetime | None = None
    expected_safe_count: int | None = None
    received_safe_count: int
    received_member_count: int
    error_count: int


class SummaryResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    safes: int
    business_safes: int
    internal_safes: int
    scope_pending_safes: int
    scope_candidate_safes: int
    clean_business_safes: int
    obsolete_safes: int
    duplicate_safes: int
    accounts: int
    pending_classification: int
    assigned: int
    review: int
    safe_health: SafeHealth
    latest_run: SummaryLatestRun | None = None


class AnalyticsBucket(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str
    count: int


class LabeledAnalyticsBucket(AnalyticsBucket):
    label: str


class AnalyticsResponse(BaseModel):
    workflow_status: list[AnalyticsBucket]
    next_actions: list[AnalyticsBucket]
    account_types: list[AnalyticsBucket]
    business_units: list[LabeledAnalyticsBucket]
    responsibles: list[LabeledAnalyticsBucket]


class ConcentrationEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    safe_count: int


class ConcentrationTotals(BaseModel):
    model_config = ConfigDict(extra="ignore")

    users: int
    roles: int
    safes: int


class AccessConcentrationResponse(BaseModel):
    users: list[ConcentrationEntry]
    roles: list[ConcentrationEntry]
    totals: ConcentrationTotals


class LicenseReconciliationTotals(BaseModel):
    model_config = ConfigDict(extra="ignore")

    standard_users: int
    reconciled_users: int
    only_user_type: int
    only_role_members: int
    confirmed: bool


class LicenseReconciliationRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    user_id: str | None = None
    license_roles: list[str]
    okta_groups: list[str]


class LicenseReconciliationResponse(BaseModel):
    totals: LicenseReconciliationTotals
    rows: list[LicenseReconciliationRow]


class ConnectionCoverageTotals(BaseModel):
    model_config = ConfigDict(extra="ignore")

    total: int
    both: int
    pam_only: int
    sia_only: int
    none: int
    zsp_implemented: int
    zsp_pending: int
    zsp_unknown: int


class ConnectionCoverageEnvironment(ConnectionCoverageTotals):
    environment: str


class ConnectionCoverageResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    totals: ConnectionCoverageTotals
    by_environment: list[ConnectionCoverageEnvironment]
    import_: ConnectionImport | None = Field(default=None, alias="import")


class ExecutiveAnalyticsResponse(BaseModel):
    connection_coverage: ConnectionCoverageResponse
    access_concentration: AccessConcentrationResponse


class InventoryFreshnessResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    safes: int
    last_mod_unknown: int
    last_mod_30d: int
    last_mod_90d: int
    last_mod_365d: int
    last_mod_over_year: int
    safes_without_accounts: int
    accounts_active: int
    accounts_retired: int
    accounts_not_seen_30d: int


class AccountPlatformCoverageResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    accounts_active: int
    accounts_with_platform: int
    accounts_without_platform: int
    accounts_with_partial_platform: int
    platforms_observed: int
    safes_without_accounts: int


class AccountManagementSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    accounts_active: int
    automatic_enabled: int
    automatic_disabled: int
    management_unknown: int
    status_success: int
    status_failure: int
    status_in_process: int
    status_unknown: int
    changed_30d: int
    changed_90d: int
    changed_365d: int
    changed_older: int
    changed_unknown: int
