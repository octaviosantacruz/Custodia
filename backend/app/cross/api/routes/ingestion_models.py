"""Stable response schemas for the ingestion surface (AUD-API-002).

`IngestionRunRow` mirrors the `_RUN_COLUMNS` projection exactly: every count
and breakdown column is NOT NULL after `finish_ingestion_run`, while
`source_file`, `completed_at`, the lease/heartbeat fields, `triggered_by` and
`expected_safe_count` are nullable in the schema. `started_at` is NOT NULL in
the database (migration 003) even for queued runs, which is why it is not
declared optional here.

The preview mirrors `compare_inventory` plus the route's own additions
(`reported_safe_count`, `complete_snapshot`, `can_reconcile`, `warning`);
`reported_safe_count` stays optional because `fetch_safes` can legitimately
not receive a total from CyberArk. Change `before`/`after` values stay `Any`:
they are display data serialized by `ingestion_compare._serialize`, not a
typed join surface.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class IngestionStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_safes: int = Field(default=0, ge=0, le=10000)
    page_size: int = Field(default=100, ge=1, le=250)
    member_delay_seconds: float = Field(default=0.3, ge=0, le=60)
    member_concurrency: int = Field(default=4, ge=1, le=8)
    reconcile_complete: bool = False


class IngestionRunRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    run_id: UUID
    source_system: str
    source_file: str | None = None
    task_key: str | None = None
    status: str
    enqueued_at: datetime
    started_at: datetime
    completed_at: datetime | None = None
    status_message: str | None = None
    attempt_count: int
    worker_id: str | None = None
    heartbeat_at: datetime | None = None
    lease_expires_at: datetime | None = None
    expected_safe_count: int | None = None
    received_safe_count: int
    received_member_count: int
    received_object_count: int
    received_relationship_count: int
    retired_object_count: int
    retired_relationship_count: int
    error_count: int
    error_details: list[dict[str, Any]]
    triggered_by: str | None = None
    safes_created: int
    safes_updated: int
    safes_retired: int
    members_created: int
    members_updated: int
    members_retired: int
    pam_synced: bool


class SyncStageRow(BaseModel):
    stage: str
    required: bool
    status: Literal["completed", "failed", "skipped"]
    item_count: int | None = None
    duration_ms: int
    error_kind: str | None = None
    detail: str | None = None


class SyncStagesResponse(BaseModel):
    rows: list[SyncStageRow]


class StageFreshnessRow(BaseModel):
    stage: str
    last_success_at: datetime | None = None
    last_status: Literal["completed", "failed"]
    last_attempt_at: datetime


class StageFreshnessResponse(BaseModel):
    rows: list[StageFreshnessRow]


class StageHistoryRow(BaseModel):
    run_id: UUID
    completed_at: datetime
    stage: str
    status: Literal["completed", "failed"]
    item_count: int | None = None
    duration_ms: int


class StageHistoryResponse(BaseModel):
    rows: list[StageHistoryRow]


class IngestionRunsResponse(BaseModel):
    rows: list[IngestionRunRow]


class IngestionScheduleResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool
    interval_minutes: float
    last_scheduled_at: datetime | None = None
    next_scheduled_at: datetime | None = None


class SyncTaskScheduleRow(BaseModel):
    task_key: str
    source_system: str
    source_file: str
    configured: bool
    active: bool
    interval_minutes: float
    interval_source: str
    admin_override: float | None = None
    updated_at: datetime | None = None
    last_success_at: datetime | None = None
    last_attempt_at: datetime | None = None
    last_status: str | None = None
    consecutive_failures: int = 0
    freshness: Literal["fresh", "stale", "unknown"] = "unknown"
    intervals_since_success: float | None = None
    stale_after_intervals: int = 3
    next_scheduled_at: datetime | None = None


class SyncTaskSchedulesResponse(BaseModel):
    rows: list[SyncTaskScheduleRow]


class SyncScheduleOverrideUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interval_minutes: float | None = Field(ge=0, le=525600)

    @field_validator("interval_minutes")
    @classmethod
    def validate_interval(cls, value):
        if value is not None and 0 < value < 5:
            raise ValueError("El intervalo debe ser 0 (deshabilitado) o de al menos 5 minutos")
        return value


class IngestionAllEnqueuedRow(BaseModel):
    run_id: UUID
    status: str
    source_system: str
    task_key: str | None = None


class IngestionEnqueuedResponse(BaseModel):
    run_id: UUID
    status: str
    # Present when one request enqueued several independent tasks of a source
    # (Netskope); run_id is the one a caller polls first, not the whole outcome.
    runs: list[IngestionAllEnqueuedRow] | None = None


class IngestionAllEnqueuedResponse(BaseModel):
    runs: list[IngestionAllEnqueuedRow]


class IngestionCounts(BaseModel):
    model_config = ConfigDict(extra="ignore")

    incoming: int
    current: int
    new: int
    changed: int
    unchanged: int
    retired: int


class IngestionFieldChange(BaseModel):
    model_config = ConfigDict(extra="ignore")

    field: str
    before: Any = None
    after: Any = None


class IngestionSafeSample(BaseModel):
    model_config = ConfigDict(extra="ignore")

    safe_number: int
    safe_name: str


class IngestionChangedSafeSample(IngestionSafeSample):
    changes: list[IngestionFieldChange]


class IngestionMemberSample(BaseModel):
    model_config = ConfigDict(extra="ignore")

    safe_number: int
    member_id: str
    member_name: str


class IngestionChangedMemberSample(IngestionMemberSample):
    changes: list[IngestionFieldChange]
    security_relevant: bool


class IngestionPreviewSamples(BaseModel):
    model_config = ConfigDict(extra="ignore")

    new_safes: list[IngestionSafeSample]
    changed_safes: list[IngestionChangedSafeSample]
    retired_safes: list[IngestionSafeSample]
    new_members: list[IngestionMemberSample]
    changed_members: list[IngestionChangedMemberSample]
    retired_members: list[IngestionMemberSample]


class IngestionPreviewResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    safe_counts: IngestionCounts
    member_counts: IngestionCounts
    samples: IngestionPreviewSamples
    reported_safe_count: int | None = None
    complete_snapshot: bool
    can_reconcile: bool
    warning: str | None = None
