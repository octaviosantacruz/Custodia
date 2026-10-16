"""Stable response schemas for the findings surface (AUD-API-002).

The list endpoint returns an allowlisted projection (no `created_at`), while
the PATCH returns ``UPDATE ... RETURNING *``, so both shapes are typed exactly
as the repository already returns them. `evidence` stays an opaque JSON object
on purpose: it is evidence for the reviewer, not a published join surface.

`severity`, `category` and `status` stay plain strings like the other
AUD-API-002 models: the DB CHECK constraints are storage rules, not a promise
that the API will never publish a new value.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class FindingListRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    finding_id: int
    rule_id: str
    rule_version: str
    source_system: str
    subject_type: str
    subject_id: str
    title: str
    severity: str
    category: str
    status: str
    evidence: dict[str, Any]
    source_run_id: UUID | None = None
    first_detected_at: datetime
    last_detected_at: datetime
    resolved_at: datetime | None = None
    exception_reason: str | None = None
    exception_until: datetime | None = None
    updated_at: datetime


class FindingRow(FindingListRow):
    """The full row returned by ``UPDATE ... RETURNING *``."""

    created_at: datetime


class FindingsResponse(BaseModel):
    rows: list[FindingListRow]
    total: int
    limit: int
    offset: int


class FindingsRefreshResponse(BaseModel):
    status: str
    current_findings: int
