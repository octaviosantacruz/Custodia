from datetime import datetime

from pydantic import BaseModel


# NSK-DLP-001: the response contract mirrors the persisted allowlist exactly.
# There is deliberately no field for file name/content, hash, URL, IP, event
# email/name or any forensic attribute.
class NetskopeDlpResolvedUser(BaseModel):
    object_id: int
    display_name: str
    email: str | None


class NetskopeDlpAlertRow(BaseModel):
    incident_id: str
    event_timestamp: datetime
    status: str
    severity: str
    policy: str
    action: str
    user_id: str
    user: NetskopeDlpResolvedUser | None


class NetskopeDlpAlertsResponse(BaseModel):
    rows: list[NetskopeDlpAlertRow]
    total: int
    limit: int
    offset: int
    severity: str
    status: str
    action: str
    policy: str
    resolution: str
    user_id: str


class NetskopeDlpBucket(BaseModel):
    key: str
    count: int


class NetskopeDlpStatusResponse(BaseModel):
    configured: bool
    captured_at: datetime | None
    coverage_start: datetime | None
    coverage_end: datetime | None
    partial: bool | None
    scanned_events: int
    captured_alerts: int


class NetskopeDlpPolicyRow(BaseModel):
    policy: str
    alert_count: int
    last_7d: int
    previous_7d: int
    latest_event_at: datetime
    by_severity: list[NetskopeDlpBucket]
    by_action: list[NetskopeDlpBucket]


class NetskopeDlpPoliciesResponse(BaseModel):
    configured: bool
    window_days: int
    captured_at: datetime | None
    partial: bool | None
    total_policies: int
    unnamed_alerts: int
    policies: list[NetskopeDlpPolicyRow]
