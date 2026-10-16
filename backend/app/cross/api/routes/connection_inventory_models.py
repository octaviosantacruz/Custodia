"""Stable response schemas for the connection inventory surface (AUD-API-002).

The list projection joins the current import metadata into every row (that is
why `import_id`/`file_name`/`row_count`/`imported_at` are not nullable here),
and adds the exact-IP matches against PAM and SIA as opaque-for-navigation
objects. The envelope keeps the `import` key through a field alias because
`import` is a Python keyword; `ConnectionImport` belongs to
this module so the executive coverage and this list publish the
same import-metadata shape.
"""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


WorkStatus = Literal["pending", "in_progress", "onboarded", "blocked", "not_applicable"]


class ConnectionImport(BaseModel):
    model_config = ConfigDict(extra="ignore")

    import_id: UUID
    file_name: str
    row_count: int
    imported_at: datetime


class ConnectionSafeMatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    safe_number: int
    safe_name: str
    account_id: str
    account_name: str
    address: str | None = None
    platform_name: str | None = None
    platform_id: str | None = None


class ConnectionSiaMatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    capability: Literal["platform", "dba", "other"] | None = None


class ConnectionInventoryListRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    inventory_id: int
    source_row_number: int
    instance_name: str
    environment: str
    private_ip: str
    port: int | None = None
    ca_sia: bool | None = None
    ca_dba: bool | None = None
    zsp_implemented: bool | None = None
    access_available: bool | None = None
    description: str
    lifecycle_status: Literal["active", "retired"] = "active"
    retired_at: datetime | None = None
    platform_result: str | None = None
    dba_result: str | None = None
    work_status: WorkStatus = "pending"
    responsible: str = ""
    note: str = ""
    import_id: UUID
    file_name: str
    row_count: int
    imported_at: datetime
    safe_matches: list[ConnectionSafeMatch]
    sia_matches: list[ConnectionSiaMatch]
    safe_match_count: int
    sia_match_count: int


class ConnectionInventoryFilters(BaseModel):
    model_config = ConfigDict(extra="ignore")

    environment: str
    coverage: str
    status: str = "active"
    deviation: str = ""
    work_status: str = ""
    responsible: str = ""


class ConnectionInventoryResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    rows: list[ConnectionInventoryListRow]
    total: int
    limit: int
    offset: int
    search: str
    filters: ConnectionInventoryFilters
    import_: ConnectionImport | None = Field(default=None, alias="import")


class ConnectionImportCounts(BaseModel):
    incoming: int
    new: int
    changed: int
    unchanged: int
    missing: int
    already_retired: int


class ConnectionImportSample(BaseModel):
    model_config = ConfigDict(extra="ignore")

    private_ip: str
    port: int | None = None
    instance_name: str
    fields: list[str] = []
    reactivated: bool = False


class ConnectionImportSamples(BaseModel):
    new: list[ConnectionImportSample]
    changed: list[ConnectionImportSample]
    missing: list[ConnectionImportSample]


class ConnectionImportRowError(BaseModel):
    row: int
    message: str


class ConnectionInventoryPreviewResponse(BaseModel):
    mode: Literal["update", "replace"]
    counts: ConnectionImportCounts
    samples: ConnectionImportSamples
    errors: list[ConnectionImportRowError]


class ConnectionInventoryImportedResponse(BaseModel):
    imported: Literal[True]
    import_id: str
    row_count: int
    mode: Literal["update", "replace"]
    counts: ConnectionImportCounts


class ConnectionDestinationChanged(BaseModel):
    inventory_id: int


class ConnectionDestinationsChanged(BaseModel):
    changed: int


class SiaPolicyCapabilityRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    source_id: str
    display_name: str
    status: str
    capability: Literal["platform", "dba", "other"] | None = None
    suggested: Literal["platform", "dba"] | None = None
    destinations: int
    classified_by: str | None = None
    classified_at: datetime | None = None


class SiaPolicyCapabilitiesResponse(BaseModel):
    rows: list[SiaPolicyCapabilityRow]


class CapabilityReadings(BaseModel):
    match: int
    missing: int
    undeclared: int
    unclassified: int
    unknown: int


class ResponsibleCount(BaseModel):
    responsible: str
    total: int


class ConnectionDeviationsResponse(BaseModel):
    platform: CapabilityReadings
    dba: CapabilityReadings
    policies: dict[str, int]
    work: dict[str, int]
    responsibles: list[ResponsibleCount]


class ConnectionHistoryEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    actor_id: str
    action: str
    before_data: dict | None = None
    after_data: dict | None = None
    created_at: datetime


class ConnectionHistoryResponse(BaseModel):
    rows: list[ConnectionHistoryEvent]


class ProgressBlock(BaseModel):
    n: int
    platform: CapabilityReadings
    dba: CapabilityReadings
    work: dict[str, int]


class ProgressEnvironment(ProgressBlock):
    environment: str


class ProgressResponsible(ProgressBlock):
    responsible: str


class CoverageProgress(BaseModel):
    total: ProgressBlock
    by_environment: list[ProgressEnvironment]
    by_responsible: list[ProgressResponsible]


class ProgressPoint(ProgressBlock):
    snapshot_date: date
    captured_at: datetime


class CoverageProgressResponse(BaseModel):
    current: CoverageProgress
    series: list[ProgressPoint]


class StaleDestination(BaseModel):
    inventory_id: int
    instance_name: str
    environment: str
    private_ip: str
    port: int | None
    work_status: WorkStatus
    responsible: str
    last_change: datetime | None
    idle_since: datetime
    idle_days: int


class StaleDestinationsResponse(BaseModel):
    days: int
    total: int
    rows: list[StaleDestination]


class UninventoriedAddress(BaseModel):
    address: str
    pam_accounts: int
    pam_safes: int
    sia_policies: int
    sia_policy_names: list[str]


class UninventoriedAddressesResponse(BaseModel):
    total: int
    rows: list[UninventoriedAddress]
