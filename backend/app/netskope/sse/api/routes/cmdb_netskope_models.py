"""Stable response schemas for the Netskope CMDB surface (AUD-API-002).

The per-device DLP summary answers 410 Gone only and is excluded from the
schema (`include_in_schema=False`), so this file types the active routes.
NSK-DLP-001 publishes its own models in ``netskope_dlp_models.py``.

`attributes` stays an opaque JSON object on purpose: the Netskope field set is
owned by the ingestion mapping and differs between users and devices. The
device list resolves `observed_user` by exact username -> id/email equality
inside the same tenant; `observed_user_status` publishes matched/ambiguous/
unmatched so the UI never guesses a link. `counts`/`samples` in the changes
response are keyed by the seven change kinds the repository computes, and
`thresholds` publishes the bucket edges the SQL actually used.
"""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class NetskopeBucket(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str
    count: int
    # NSK-XMET-001: top-N buckets grouped by name carry the exact value the
    # drill must filter by (e.g. the user's source_id).
    filter_value: str | None = None


class NetskopeLabeledBucket(NetskopeBucket):
    label: str


class NetskopeBaselineRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: dict[str, Any]
    note: str | None = None
    updated_by: str
    updated_at: datetime


class NetskopeObservedUser(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # NSK-INV-002: the user's inventory id, so the device card can ask for that user's UEBA and ADEM data.
    object_id: int | None = None
    source_id: str
    display_name: str
    email: str | None = None


class NetskopeUserDeviceActivity(BaseModel):
    """NSK-XMET-003: newest observed event of the user's exact-matched devices."""
    device_count: int
    latest_device: str | None = None
    latest_event: datetime | None = None
    match_basis: list[Literal['source_id', 'email']] = []


class NetskopeSourceEvidence(BaseModel):
    source_fresh: bool
    source_status: str | None
    source_completed_at: datetime | None
    as_of: datetime


class NetskopeDeviceEvidence(NetskopeSourceEvidence):
    state: Literal["recent", "not_recent", "review", "unknown"]
    reason: str
    last_signal_at: datetime | None
    age_days: int | None
    recent_days: int
    review_days: int
    source_freshness_hours: int
    client_version: str
    os: str
    os_version: str
    last_seen_event: str


DeviceDiagnosis = Literal["undetermined", "uninstalled_reported", "replaced", "decommissioned", "in_use_not_reporting", "historical_record", "temporary_exception"]
DeviceReviewStatus = Literal["pending", "investigating", "ticket_open", "resolved"]


class NetskopeDeviceReviewEvidence(BaseModel):
    model_config = ConfigDict(extra="ignore")

    last_seen_event: str | None = None
    last_event_at: datetime | None = None
    age_days: int | None = None


class NetskopeDeviceReview(BaseModel):
    """NSK-DEVREV-001: the human decision about one device, apart from the synchronized data."""
    model_config = ConfigDict(extra="ignore")

    object_id: int
    diagnosis: DeviceDiagnosis
    status: DeviceReviewStatus
    effective_status: DeviceReviewStatus
    exception_expired: bool
    owner: str | None = None
    reference: str | None = None
    note: str | None = None
    exception_expires_at: datetime | None = None
    next_review_at: date | None = None
    evidence: NetskopeDeviceReviewEvidence
    decided_by: str
    decided_at: datetime
    reported_since_decision: bool = False


class NetskopeDeviceReviewBucket(BaseModel):
    key: DeviceDiagnosis
    count: int


class NetskopeDeviceReviewSuggestionBucket(BaseModel):
    key: Literal["uninstalled_reported", "replaced", "historical_record"]
    count: int


class NetskopeDeviceReviewSummaryResponse(BaseModel):
    candidates: int
    buckets: list[NetskopeDeviceReviewBucket]
    unclassified: int | None
    # Evaluation: null without a complete, recent sync. Each count opens exactly its devices.
    suggestions: list[NetskopeDeviceReviewSuggestionBucket] | None
    historical_days: int
    open_incidents: int
    expired_exceptions: int
    reported_again: int
    source_evidence: NetskopeSourceEvidence


class NetskopeObjectRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]
    first_seen_at: datetime
    last_seen_at: datetime
    observed_user_status: Literal['matched', 'ambiguous', 'unmatched']
    observed_user: NetskopeObservedUser | None = None
    device_activity: NetskopeUserDeviceActivity | None = None
    device_evidence: NetskopeDeviceEvidence | None = None
    review: NetskopeDeviceReview | None = None
    # NSK-DEVREV-002: what DS Hub would suggest for an unclassified device; null when it suggests nothing.
    review_suggestion: Literal["uninstalled_reported", "replaced", "historical_record"] | None = None


class NetskopeObjectsResponse(BaseModel):
    rows: list[NetskopeObjectRow]
    total: int
    limit: int
    offset: int
    search: str
    filters: dict[str, str]
    event_age: str
    change: str
    freshness: str
    activity_days: int = 0
    client_compliance: str
    os_compliance: str
    duplicate: str
    evidence_state: str = ""
    source_evidence: NetskopeSourceEvidence | None = None
    review_diagnosis: str = ""
    review_status: str = ""
    review_attention: str = ""
    review_suggestion: str = ""


class NetskopeDemPopTracing(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gslb: bool | None = None
    method: str | None = None
    period: int | None = None


class NetskopeDemSiteRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    revision: str | None = None
    date_create: str | None = None
    date_modify: str | None = None
    num_gateways: int | None = None
    num_runners: int | None = None
    pop_tracing: NetskopeDemPopTracing | None = None
    first_seen_at: datetime
    last_seen_at: datetime


class NetskopeDemSitesResponse(BaseModel):
    configured: bool
    rows: list[NetskopeDemSiteRow]
    total: int
    limit: int
    offset: int
    search: str
    last_observed_at: datetime | None = None


class NetskopeGroupRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    provisioner: str | None = None
    reported_members: int | None = None
    observed_members: int
    first_seen_at: datetime
    last_seen_at: datetime


class NetskopeGroupsResponse(BaseModel):
    configured: bool
    rows: list[NetskopeGroupRow]
    total: int
    limit: int
    offset: int
    search: str
    provisioner: str
    last_observed_at: datetime | None = None


class NetskopePolicyGroupRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    group_type: str | None = None
    can_be_edited_deleted: bool | None = None
    first_seen_at: datetime
    last_seen_at: datetime


class NetskopePolicyGroupsResponse(BaseModel):
    configured: bool
    rows: list[NetskopePolicyGroupRow]
    total: int
    last_observed_at: datetime | None = None


class NetskopeGroupMemberRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    email: str | None = None


class NetskopeGroupRef(BaseModel):
    id: str
    name: str


class NetskopeGroupMembersResponse(BaseModel):
    group: NetskopeGroupRef
    rows: list[NetskopeGroupMemberRow]
    total: int
    limit: int
    offset: int


class NetskopeExperiencePopsResponse(BaseModel):
    pops: list[str]
    total: int
    window_start: int
    window_end: int


class NetskopeMetricsResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    users_total: int
    # NSK-REF-001: the user total Netskope reports itself (users/counts); a reference, never a KPI input.
    users_reported_total: int | None = None
    users_reported_at: datetime | None = None
    accounts_reported_active: int | None = None
    accounts_reported_inactive: int | None = None
    groups_reported_total: int | None = None
    ous_reported_total: int | None = None
    users_repeated_rows: int | None = None
    # NSK-USR-001: users split by accounts[]; a user whose accounts[] was not read counts in neither.
    users_enabled: int | None = None
    users_disabled: int | None = None
    devices_total: int
    devices_last_event_dem: int = 0
    devices_with_observed_user: int
    last_observed_at: datetime | None = None
    devices_by_os: list[NetskopeBucket] | None = None
    devices_by_client: list[NetskopeBucket] | None = None
    devices_by_make: list[NetskopeBucket] | None = None
    devices_by_classification: list[NetskopeBucket] | None = None
    devices_by_user_status: list[NetskopeBucket] | None = None
    devices_by_company: list[NetskopeBucket] | None = None
    users_by_company: list[NetskopeBucket] | None = None
    devices_stale_30d: int | None = None
    # An evaluation: null without a complete, recent sync. The distribution is observation.
    # Present with devices_stale_30d: whether the inventory it read comes from a complete, recent sync.
    source_evidence: NetskopeSourceEvidence | None = None
    # NSK-XMET-001: cross user-device KPIs over the exact NSK-DEV-001 match.
    devices_observed_user_matched: int | None = None
    devices_observed_user_ambiguous: int | None = None
    devices_observed_user_unmatched: int | None = None
    devices_by_observed_user_status: list[NetskopeBucket] | None = None
    devices_active_total: int | None = None
    users_with_device_activity_7d: int | None = None
    users_with_device_activity_14d: int | None = None
    users_with_device_activity_30d: int | None = None
    users_without_observed_devices: int | None = None
    users_by_device_count: list[NetskopeBucket] | None = None
    users_by_recent_device_age: list[NetskopeBucket] | None = None
    coverage_risk_devices_by_user: list[NetskopeBucket] | None = None


class NetskopeAlertWindow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    days: int
    window_start: datetime
    window_end: datetime
    captured_at: datetime
    total: int | None
    availability: Literal["complete", "incomplete", "stale"]
    by_alert_type: list[NetskopeBucket]
    by_severity: list[NetskopeBucket]
    by_action: list[NetskopeBucket]


class NetskopeAlertsResponse(BaseModel):
    windows: list[NetskopeAlertWindow]
    configured: bool
    dlp_export_configured: bool


class NetskopeObservedPolicy(BaseModel):
    model_config = ConfigDict(extra="ignore")

    policy: str
    volume: int
    first_captured_at: datetime
    last_captured_at: datetime
    # NSK-POL-001: never derived from the global action dimension; always
    # "Sin dato" until a cross policy x action contract exists.
    dominant_action: str


class NetskopeObservedPolicyWindow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    days: int
    window_start: datetime
    window_end: datetime
    captured_at: datetime
    availability: Literal["complete", "stale"]
    policies: list[NetskopeObservedPolicy]


class NetskopeObservedPoliciesResponse(BaseModel):
    windows: list[NetskopeObservedPolicyWindow]
    configured: bool


class NetskopeRetiredActivityUser(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    source_id: str | None = None
    display_name: str | None = None
    email: str | None = None
    device_count: int
    latest_event: datetime | None = None
    latest_device: str | None = None


class NetskopeRetiredActivityResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    days: int
    total: int
    rows: list[NetskopeRetiredActivityUser]


class NetskopeDeviceFacetsResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    os: list[NetskopeBucket]
    client_version: list[NetskopeBucket]
    classification_status: list[NetskopeBucket]
    user_status: list[NetskopeBucket]
    company: list[NetskopeBucket]
    last_seen_event: list[NetskopeBucket]
    device_make: list[NetskopeBucket]
    device_model: list[NetskopeBucket]


class NetskopeFreshnessBucket(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str
    label: str
    count: int
    by_classification: list[NetskopeBucket]


class NetskopeDeviceFreshnessResponse(BaseModel):
    thresholds: dict[str, int]
    buckets: list[NetskopeFreshnessBucket]
    total: int
    # None when there is no complete, recent sync: the evaluation is unavailable, not zero.
    review_candidates: int | None
    source_evidence: NetskopeSourceEvidence


class NetskopeClientEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str
    count: int
    coverage_risk: bool


class NetskopeClientEventsResponse(BaseModel):
    events: list[NetskopeClientEvent]
    total: int
    coverage_risk_total: int
    coverage_risk_events: list[str]


class NetskopeChangeRun(BaseModel):
    model_config = ConfigDict(extra="ignore")

    source_run_id: UUID
    captured_at: datetime
    position: int
    devices: int


class NetskopeChangeSample(BaseModel):
    model_config = ConfigDict(extra="ignore")

    device_id: str
    hostname: str | None = None
    before_value: str | None = None
    after_value: str | None = None


class NetskopeDeviceChangesResponse(BaseModel):
    available: bool
    completed_runs: int
    latest_run: NetskopeChangeRun | None = None
    previous_run: NetskopeChangeRun | None = None
    counts: dict[str, int]
    samples: dict[str, list[NetskopeChangeSample]]


class NetskopeClientComplianceOs(BaseModel):
    model_config = ConfigDict(extra="ignore")

    os: str
    total: int
    current: int
    one_behind: int
    two_plus_behind: int
    unrecognized: int


class NetskopeClientComplianceResponse(BaseModel):
    configured: bool
    baseline: NetskopeBaselineRow | None = None
    buckets: list[NetskopeLabeledBucket]
    by_os: list[NetskopeClientComplianceOs]
    total: int


class NetskopeOsVersionBucket(BaseModel):
    model_config = ConfigDict(extra="ignore")

    os: str
    os_version: str
    count: int


class NetskopeOsCompliance(BaseModel):
    baseline: NetskopeBaselineRow
    buckets: list[NetskopeLabeledBucket]


class NetskopeFleetResponse(BaseModel):
    by_make: list[NetskopeBucket]
    by_model: list[NetskopeBucket]
    by_company: list[NetskopeBucket]
    by_os_version: list[NetskopeOsVersionBucket]
    total: int
    os_compliance: NetskopeOsCompliance | None = None


class NetskopeFleetCounts(BaseModel):
    devices: int
    signal_24h: int
    client_current: int
    client_evaluated: int
    os_supported: int
    os_evaluated: int
    on_prem: int
    location_reported: int


class NetskopeFleetGroup(NetskopeFleetCounts):
    key: str


class NetskopeFleetGroupsResponse(BaseModel):
    group_by: str
    client_baseline: bool
    os_baseline: bool
    summary: NetskopeFleetCounts
    groups: list[NetskopeFleetGroup]
    omitted_groups: int
    omitted_devices: int


class NetskopeDuplicateTop(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str
    devices: int
    distinct_other: int
    last_seen_at: datetime


class NetskopeDuplicateGroup(BaseModel):
    model_config = ConfigDict(extra="ignore")

    groups: int
    devices: int
    largest: int
    top: list[NetskopeDuplicateTop]


class NetskopeDuplicatesResponse(BaseModel):
    hostname: NetskopeDuplicateGroup
    username: NetskopeDuplicateGroup


class NetskopeSnapshot(BaseModel):
    model_config = ConfigDict(extra="ignore")

    snapshot_id: int
    source_run_id: UUID
    captured_at: datetime
    attributes: dict[str, Any]


class NetskopeDeviceHistoryResponse(BaseModel):
    device_id: str
    snapshots: list[NetskopeSnapshot]


class NetskopePostureFinding(BaseModel):
    """NSK-POSTURE-001: allowlisted fields of one device or user in a check sample."""
    object_id: int | None
    name: str
    user: str
    os: str
    client_version: str
    last_event: str
    score: int | None = None
    detected_at: datetime | None


class NetskopePostureCheck(BaseModel):
    id: str
    entity: Literal["device", "user"]
    severity: Literal["high", "medium", "low"]
    title: str
    description: str
    status: Literal["evaluated", "not_configured", "not_permitted"]
    count: int
    query: dict[str, str]
    findings: list[NetskopePostureFinding]


class NetskopePostureSourceEvidence(BaseModel):
    source_fresh: bool
    source_status: str | None
    source_completed_at: datetime | None
    as_of: datetime | None


class NetskopePostureResponse(BaseModel):
    checks: list[NetskopePostureCheck]
    source_evidence: NetskopePostureSourceEvidence
    uci_captured_at: datetime | None


class NetskopePresenceCount(BaseModel):
    key: str
    count: int


class NetskopePresenceGroup(BaseModel):
    key: str
    total: int
    statuses: dict[str, int]


class NetskopePresenceResponse(BaseModel):
    total: int
    reported: int
    statuses: list[NetskopePresenceCount]
    methods: list[NetskopePresenceCount]
    by_client_config: list[NetskopePresenceGroup]
    by_company: list[NetskopePresenceGroup]
    company_omitted_devices: int
    missing_label: str
    source_evidence: NetskopePostureSourceEvidence
