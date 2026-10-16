"""Versioned response contracts for the CONN-001 person client pilot."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


CoverageStatus = Literal["covered", "partial", "gap", "unknown", "not_applicable"]
SourceFreshness = Literal["fresh", "stale", "incomplete", "missing"]


class CoverageSourceRun(BaseModel):
    model_config = ConfigDict(extra="ignore")

    source_system: Literal["identity_administration", "netskope"]
    source_file: str
    run_id: str | None = None
    status: Literal["running", "completed", "partial", "failed"] | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    freshness: SourceFreshness
    age_hours: float | None = None


class PersonClientCoverageCounts(BaseModel):
    denominator: int
    covered: int
    partial: int
    gap: int
    unknown: int
    coverage_percent: float | None
    devices_recent: int
    devices_total: int
    device_coverage_percent: float | None


class PersonClientCoverageSummary(BaseModel):
    metric_code: Literal["CONN-001"] = "CONN-001"
    metric_version: Literal["1"] = "1"
    label: Literal["Cliente Netskope activo y observado recientemente"] = (
        "Cliente Netskope activo y observado recientemente"
    )
    population: Literal["Usuarios humanos activos de Identity Administration"] = (
        "Usuarios humanos activos de Identity Administration"
    )
    person_freshness_hours: int = 24
    device_freshness_days: int = 7
    counts: PersonClientCoverageCounts
    sources: dict[str, CoverageSourceRun]


class PersonClientCoverageDetail(BaseModel):
    model_config = ConfigDict(extra="ignore")

    metric_code: Literal["CONN-001"] = "CONN-001"
    metric_version: Literal["1"] = "1"
    email: str
    status: CoverageStatus
    identity_records: int
    netskope_users: int
    devices_recent: int
    devices_not_recent: int
    devices_total: int
    devices_ambiguous: int
    sources: dict[str, CoverageSourceRun]
    explanation: str
