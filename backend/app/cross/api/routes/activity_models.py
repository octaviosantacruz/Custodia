"""Stable response schemas for the administrative audit and log surfaces
(AUD-API-002).

The allowlists mirror the SQL projections exactly; JSONB payloads stay as
opaque objects on purpose. `extra="ignore"` matches the established
`inventory_models.py` response style so a new repository column never leaks
into the published contract by accident.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ActivityRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    audit_id: int
    actor_id: str
    actor_name: str
    action: str
    entity_type: str
    entity_id: str | None = None
    entity_name: str | None = None
    before_data: dict[str, Any] | None = None
    after_data: dict[str, Any] | None = None
    created_at: datetime


class ActivityResponse(BaseModel):
    rows: list[ActivityRow]
    total: int
    limit: int
    offset: int


class SecurityEventRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event_id: int
    occurred_at: datetime
    event_type: str
    actor_id: str | None = None
    actor_name: str | None = None
    result: str
    source_ip: str | None = None
    request_id: str | None = None
    mechanism: str | None = None
    metadata: dict[str, Any] | None = None


class SecurityEventsResponse(BaseModel):
    rows: list[SecurityEventRow]
    total: int
    limit: int
    offset: int


class OperationalErrorRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event_id: int
    occurred_at: datetime
    request_id: str
    method: str
    path: str
    error_kind: str
    status_code: int
    metadata: dict[str, Any] | None = None


class OperationalErrorsResponse(BaseModel):
    rows: list[OperationalErrorRow]
    total: int
    limit: int
    offset: int


class OperationalLogRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    log_id: int
    occurred_at: datetime
    level: str
    source_system: str
    event: str
    message: str
    run_id: UUID | None = None
    metadata: dict[str, Any] | None = None


class OperationalLogsResponse(BaseModel):
    rows: list[OperationalLogRow]
    total: int
    limit: int
    offset: int


class ActivityEventRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event_id: int
    kind: str
    actor_id: str | None = None
    actor_name: str | None = None
    run_id: str | None = None
    source_system: str | None = None
    created_at: datetime


class ActivityEventsResponse(BaseModel):
    rows: list[ActivityEventRow]
