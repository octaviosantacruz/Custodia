"""Stable response schemas for the Safe lifecycle reads (AUD-API-002)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class SafeAuditRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    audit_id: int
    actor_id: str
    action: str
    entity_type: str
    entity_id: str
    before_data: dict[str, Any] | None = None
    after_data: dict[str, Any] | None = None
    created_at: datetime


class SafeAuditResponse(BaseModel):
    rows: list[SafeAuditRow]


class RetiredSafeRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    safe_number: int
    safe_name: str
    safe_url_id: str | None = None
    retired_at: datetime | None = None
    retired_member_count: int


class RetiredCandidatesResponse(BaseModel):
    rows: list[RetiredSafeRow]
    total: int
    deletion_enabled: Literal[False] = False
