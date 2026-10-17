import type { ChartMode } from '../../../cross/lib/chart-mode';
export type NetskopeRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  attributes: Record<string, string | number | boolean | null>;
  first_seen_at: string;
  last_seen_at: string;
  observed_user_status?: 'matched' | 'unmatched' | 'ambiguous';
  observed_user?: NetskopeObservedUser | null;
  /* NSK-XMET-003: only present when the users list is filtered by activity. */
  device_activity?: { device_count: number; latest_device: string | null; latest_event: string | null; match_basis: Array<'source_id' | 'email'> } | null;
  device_evidence?: NetskopeDeviceEvidence | null;
  /* NSK-DEVREV-001: the human decision, or null while nobody classified the device. */
  review?: NetskopeDeviceReview | null;
  /* NSK-DEVREV-002: what Custodia suggests for an unclassified device; a suggestion is never a decision. */
  review_suggestion?: NetskopeReviewSuggestion | null;
};

export type NetskopeReviewSuggestion = 'uninstalled_reported' | 'replaced' | 'historical_record';
export type NetskopeReviewAttention = 'open_incident' | 'expired_exception' | 'reported_again';

export type NetskopeReviewDiagnosis = 'undetermined' | 'uninstalled_reported' | 'replaced' | 'decommissioned' | 'in_use_not_reporting' | 'historical_record' | 'temporary_exception';
export type NetskopeReviewStatus = 'pending' | 'investigating' | 'ticket_open' | 'resolved';
export type NetskopeDeviceReview = {
  object_id: number; diagnosis: NetskopeReviewDiagnosis; status: NetskopeReviewStatus;
  /** A lapsed temporary exception reads pending again whatever its stored status. */
  effective_status: NetskopeReviewStatus; exception_expired: boolean;
  owner: string | null; reference: string | null; note: string | null;
  exception_expires_at: string | null; next_review_at: string | null;
  evidence: { last_seen_event: string | null; last_event_at: string | null; age_days: number | null };
  decided_by: string; decided_at: string; reported_since_decision: boolean;
};
export type NetskopeDeviceReviewSummary = {
  candidates: number; buckets: Array<{ key: NetskopeReviewDiagnosis; count: number }>;
  /** An evaluation: null without a complete, recent sync. */
  unclassified: number | null;
  /** An evaluation: null without a complete, recent sync. Each count opens exactly its devices. */
  suggestions: Array<{ key: NetskopeReviewSuggestion; count: number }> | null;
  historical_days: number;
  open_incidents: number; expired_exceptions: number; reported_again: number;
  source_evidence: NetskopeSourceEvidence;
};

export type NetskopeSourceEvidence = { source_fresh: boolean; source_status: string | null; source_completed_at: string | null; as_of: string };
export type NetskopeDeviceEvidence = NetskopeSourceEvidence & {
  state: 'recent' | 'not_recent' | 'review' | 'unknown'; reason: string;
  last_signal_at: string | null; age_days: number | null;
  recent_days: number; review_days: number; source_freshness_hours: number;
  client_version: string; os: string; os_version: string; last_seen_event: string;
};

export type NetskopeExperienceWindow = { window_start: number; window_end: number; source: 'netskope_adem' };
export type NetskopeExperienceDevices = NetskopeExperienceWindow & {
  devices: { device_id: string; device_name: string | null; device_os: string | null }[];
};
export type NetskopeExperienceScoreComponent = 'device' | 'network' | 'app';
export type NetskopeExperienceDeviceScore = {
  device_id: string; inventory_device_id: number | null; device_name: string | null; device_os: string | null;
  exp_score: number | null; device_score: number | null; network_score: number | null; app_score: number | null;
};
export type NetskopeExperienceScore = NetskopeExperienceWindow & {
  score: number | null; weakest: NetskopeExperienceScoreComponent | null;
  devices: NetskopeExperienceDeviceScore[]; devices_total: number;
};
export type NetskopeExperienceDetail = NetskopeExperienceWindow & {
  device_id: string; pop: string | null; last_activity: number | null;
  activity_status: 'in_window' | 'outside_window' | 'unknown';
};

export type NetskopeListResponse = {
  rows: NetskopeRow[];
  total: number;
  limit: number;
  offset: number;
  search: string;
  filters?: Partial<NetskopeDeviceFilters>;
  source_evidence?: NetskopeSourceEvidence | null;
};

/* Exact-match device filters; values are the same buckets the metrics
   charts group by, including the literal 'Sin dato' for missing values.
   NSK-XMET-001 adds the observed-user drills: the status of the exact
   NSK-DEV-001 match and the resolved user's source_id. */
export type NetskopeDeviceFilterKey = 'os' | 'client_version' | 'classification_status' | 'user_status' | 'company' | 'last_seen_event' | 'device_make' | 'device_model' | 'hostname' | 'username' | 'observed_user_status' | 'observed_user' | 'onprem_status' | 'client_config';
export type NetskopeDeviceFilters = Record<NetskopeDeviceFilterKey, string>;
export type NetskopeRetiredActivityUser = { object_id: number; source_id: string | null; display_name: string | null; email: string | null; device_count: number; latest_event: string | null; latest_device: string | null };
export type NetskopeRetiredActivity = { days: number; total: number; rows: NetskopeRetiredActivityUser[] };
export type NetskopeDeviceFacets = Record<NetskopeDeviceFilterKey, NetskopeMetricBucket[]>;

export type NetskopeEventAge = '' | 'lt_24h' | 'd1_7' | 'd7_30' | 'gt_30d' | 'unknown';

/* NSK-XMET-001: user-side drills for the cross KPIs; the users list has no
   attribute filters, only these two aggregate criteria. */
export type NetskopeUsersDeviceCountFilter = '' | '0' | '1' | '2plus';
export type NetskopeUserActivityDays = 7 | 14 | 30;
/** NSK-USR-001: the console's split by accounts[]; `unknown` is a user whose accounts[] was not read. */
export type NetskopeAccountStatus = '' | 'enabled' | 'disabled' | 'unknown';

export type NetskopeUsersFilters = { deviceCount: NetskopeUsersDeviceCountFilter; recentDeviceAge: NetskopeEventAge; activityDays: NetskopeUserActivityDays | 0; accountStatus?: NetskopeAccountStatus };

/* Everything the devices table can be narrowed by; a metrics panel drills
   into the table by setting a subset of these. */
export type NetskopeDeviceChangeKind = 'added' | 'removed' | 'upgraded' | 'downgraded' | 'version_changed' | 'os_changed' | 'classification_changed';
export type NetskopeListableChange = '' | Exclude<NetskopeDeviceChangeKind, 'removed'>;

export type NetskopeClientCompliance = '' | 'current' | 'one_behind' | 'two_plus_behind' | 'unrecognized';
export type NetskopeOsCompliance = '' | 'supported' | 'below_minimum' | 'no_baseline' | 'unrecognized';

export type NetskopeDeviceQuery = {
  eventAge: NetskopeEventAge; freshness: 'recent' | 'all'; change: NetskopeListableChange;
  clientCompliance: NetskopeClientCompliance; osCompliance: NetskopeOsCompliance; duplicate: NetskopeDuplicateKind; coverageRisk: '' | '1'; filters: NetskopeDeviceFilters;
  evidenceState?: '' | NetskopeDeviceEvidence['state'];
  reviewDiagnosis?: '' | NetskopeReviewDiagnosis; reviewStatus?: '' | NetskopeReviewStatus;
  reviewAttention?: '' | NetskopeReviewAttention; reviewSuggestion?: '' | NetskopeReviewSuggestion | 'none';
  observedUserId?: number; deviceObjectId?: number;
};

export type NetskopeDuplicateKind = '' | 'hostname' | 'username';

export type NetskopeObservedUser = { object_id?: number | null; source_id: string; display_name: string; email: string | null };

export type NetskopeFreshnessBucket = {
  key: Exclude<NetskopeEventAge, ''>;
  label: string;
  count: number;
  by_classification: NetskopeMetricBucket[];
};

export type NetskopeDeviceFreshness = {
  thresholds: { recent_hours: number; week_days: number; stale_days: number };
  buckets: NetskopeFreshnessBucket[];
  total: number;
  /** null when there is no complete, recent sync: the evaluation is unavailable, not zero. */
  review_candidates: number | null;
  source_evidence: NetskopeSourceEvidence;
};

export type NetskopeMetrics = {
  users_total: number;
  /** Optional only for rolling-deploy compatibility with an older backend. */
  users_with_device_activity_7d?: number;
  users_with_device_activity_14d?: number;
  users_with_device_activity_30d?: number;
  devices_total: number;
  /** Recent devices whose last event is a DEM heartbeat; the rest report tunnel/system events. */
  devices_last_event_dem?: number;
  devices_with_observed_user: number;
  /** Devices whose last event is older than 30 days (NSK-HB-001); optional like every selection-only field. */
  /** NSK-REF-001: the user total Netskope itself reports (users/counts); a reference beside users_total, never a KPI input. */
  users_reported_total?: number | null;
  users_reported_at?: string | null;
  accounts_reported_active?: number | null;
  accounts_reported_inactive?: number | null;
  groups_reported_total?: number | null;
  ous_reported_total?: number | null;
  users_repeated_rows?: number | null;
  /** NSK-USR-001: users split by accounts[]; a user whose accounts[] was not read counts in neither. */
  users_enabled?: number | null;
  users_disabled?: number | null;
  devices_stale_30d?: number;
  /** NSK-DEVREV-001: an evaluation, null without a complete, recent sync. */
  /** The same population split by the human diagnosis (observation). Keys are diagnosis codes. */
  /** Present with devices_stale_30d: whether the inventory it read comes from a complete, recent sync. */
  source_evidence?: NetskopeSourceEvidence | null;
  last_observed_at: string | null;
  devices_by_os: NetskopeMetricBucket[];
  devices_by_client: NetskopeMetricBucket[];
  devices_by_make: NetskopeMetricBucket[];
  devices_by_classification: NetskopeMetricBucket[];
  devices_by_user_status: NetskopeMetricBucket[];
  devices_by_company: NetskopeMetricBucket[];
  users_by_company: NetskopeMetricBucket[];
  /* NSK-XMET-001: cross user-device KPIs over the exact NSK-DEV-001 match. */
  devices_observed_user_matched: number;
  devices_observed_user_ambiguous: number;
  devices_observed_user_unmatched: number;
  devices_by_observed_user_status: NetskopeMetricBucket[];
  devices_active_total: number;
  users_without_observed_devices: number;
  users_by_device_count: NetskopeMetricBucket[];
  users_by_recent_device_age: NetskopeMetricBucket[];
  coverage_risk_devices_by_user: NetskopeMetricBucket[];
};

/** Selection responses omit data whose SQL was not requested. */
export type NetskopeSelectedMetrics = Pick<NetskopeMetrics,
  'users_total' | 'devices_total' | 'devices_with_observed_user' | 'last_observed_at'
> & Partial<NetskopeMetrics>;

export type NetskopeMetricBucket = {
  key: string;
  count: number;
  filter_value?: string;
};

export type NetskopeDataWidgetId =
  | 'users_total'
  | 'users_recent_activity'
  | 'devices_total'
  | 'devices_stale_30d'
  | 'devices_with_observed_user'
  | 'devices_observed_user_matched'
  | 'devices_observed_user_unmatched'
  | 'users_without_observed_devices'
  | 'alerts_7d'
  | 'alerts_30d'
  | 'alerts_90d';

export type NetskopeChartWidgetId =
  | 'devices_by_os'
  | 'devices_by_client'
  | 'devices_by_make'
  | 'devices_by_classification'
  | 'devices_by_user_status'
  | 'devices_by_company'
  | 'users_by_company'
  | 'devices_by_observed_user_status'
  | 'users_by_device_count'
  | 'users_by_recent_device_age'
  | 'coverage_risk_devices_by_user'
  | 'alerts_by_severity'
  /** A chart declared in the tenant's Advanced Analytics map (`aa_<key>`). */
  | `aa_${string}`;

export type NetskopeWidgetSize = 'sm' | 'md' | 'lg';

export type NetskopeWidgetFilterKey = 'os' | 'company' | 'classification_status';

export type NetskopeWidgetFilters = Partial<Record<NetskopeWidgetFilterKey, string>>;

export type NetskopeWidgetInstance = {
  id: NetskopeDataWidgetId | NetskopeChartWidgetId;
  size: NetskopeWidgetSize;
  filters?: NetskopeWidgetFilters;
  /** Donut or bars for a category chart; absent means the donut. */
  style?: ChartMode | null;
};

export type NetskopeDashboardPreferences = {
  widgets: NetskopeWidgetInstance[];
  data_widgets: NetskopeDataWidgetId[];
  chart_widgets: NetskopeChartWidgetId[];
  is_default: boolean;
};

export type NetskopeClientEvents = {
  events: Array<NetskopeMetricBucket & { coverage_risk: boolean }>;
  total: number;
  coverage_risk_total: number;
  coverage_risk_events: string[];
};

export type NetskopeChangeRun = { source_run_id: string; captured_at: string; position: number; devices: number };

export type NetskopeDeviceChanges = {
  available: boolean;
  completed_runs: number;
  latest_run: NetskopeChangeRun | null;
  previous_run: NetskopeChangeRun | null;
  counts: Record<NetskopeDeviceChangeKind, number>;
  samples: Record<NetskopeDeviceChangeKind, Array<{ device_id: string; hostname: string | null; before_value: string | null; after_value: string | null }>>;
};

export type NetskopeBaselineRecord<T> = { value: T; note: string | null; updated_by: string; updated_at: string };
export type NetskopeBaselines = {
  client_golden_releases: NetskopeBaselineRecord<{ releases: string[] }> | null;
  os_minimum_versions: NetskopeBaselineRecord<{ minimums: Record<string, string> }> | null;
};

export type NetskopeComplianceBucket<K extends string> = { key: K; label: string; count: number };

export type NetskopeClientComplianceReport = {
  configured: boolean;
  baseline: NetskopeBaselines['client_golden_releases'];
  buckets: NetskopeComplianceBucket<Exclude<NetskopeClientCompliance, ''>>[];
  by_os: Array<{ os: string; total: number } & Record<Exclude<NetskopeClientCompliance, ''>, number>>;
  total: number;
};

export type NetskopeFleet = {
  total: number;
  by_make: NetskopeMetricBucket[];
  by_model: NetskopeMetricBucket[];
  by_company: NetskopeMetricBucket[];
  by_os_version: Array<{ os: string; os_version: string; count: number }>;
  os_compliance: null | { baseline: NonNullable<NetskopeBaselines['os_minimum_versions']>; buckets: NetskopeComplianceBucket<Exclude<NetskopeOsCompliance, ''>>[] };
};

export type NetskopeAlertAggregate = { key: string; count: number };
export type NetskopeAlertWindow = {
  days: 7 | 30 | 90;
  window_start: string;
  window_end: string;
  captured_at: string;
  total: number | null;
  availability: 'complete' | 'incomplete' | 'stale';
  by_alert_type: NetskopeAlertAggregate[];
  by_severity: NetskopeAlertAggregate[];
  by_action: NetskopeAlertAggregate[];
};
export type NetskopeAlertAggregates = { configured: boolean; dlp_export_configured: boolean; windows: NetskopeAlertWindow[] };

export type NetskopeDuplicateGroup = { key: string; devices: number; distinct_other: number; last_seen_at: string | null };
export type NetskopeDuplicates = Record<Exclude<NetskopeDuplicateKind, ''>, { groups: number; devices: number; largest: number; top: NetskopeDuplicateGroup[] }>;

/* NSK-DLP-001: minimal DLP alerts. The response never carries file name,
   content, hash, URL, IP or the event's email/name; the resolved user comes
   from the Netskope inventory by exact opaque-ID equality. */
export type NetskopeDlpResolvedUser = { object_id: number; display_name: string; email: string | null };
export type NetskopeDlpAlertRow = {
  incident_id: string;
  event_timestamp: string;
  status: string;
  severity: string;
  policy: string;
  action: string;
  user_id: string;
  user: NetskopeDlpResolvedUser | null;
};
export type NetskopeDlpAlerts = {
  rows: NetskopeDlpAlertRow[];
  total: number;
  limit: number;
  offset: number;
  severity: string;
  status: string;
  action: string;
  policy: string;
  resolution: string;
  user_id: string;
};
export type NetskopeDlpPolicyRow = {
  policy: string;
  alert_count: number;
  last_7d: number;
  previous_7d: number;
  latest_event_at: string;
  by_severity: NetskopeMetricBucket[];
  by_action: NetskopeMetricBucket[];
};
export type NetskopeDlpPolicies = {
  configured: boolean;
  window_days: number;
  captured_at: string | null;
  partial: boolean | null;
  total_policies: number;
  unnamed_alerts: number;
  policies: NetskopeDlpPolicyRow[];
};
export type NetskopeDlpStatus = {
  configured: boolean;
  captured_at: string | null;
  coverage_start: string | null;
  coverage_end: string | null;
  partial: boolean | null;
  scanned_events: number;
  captured_alerts: number;
};
export type NetskopeDlpQuery = { policy: string };


export type NetskopeAaChartSummary = { id: `aa_${string}`; title: string; unit: string; period: string };

export type NetskopeAaChart = {
  source: 'advanced_analytics';
  key: string;
  title: string;
  unit: string;
  period: string;
  state: 'ready' | 'empty';
  buckets: NetskopeMetricBucket[];
  total: number | null;
  fetched_at: string;
  cache_expires_at: string;
};

export type NetskopeAaSeverity = {
  source: 'advanced_analytics';
  state: 'ready' | 'empty' | 'not_configured' | 'pending_validation';
  window_days: number | null;
  timezone: string | null;
  scope: 'all_alerts' | 'dlp' | null;
  unit: 'events' | 'incidents' | null;
  buckets: NetskopeMetricBucket[];
  total: number | null;
  fetched_at: string | null;
  cache_expires_at: string | null;
};

/* NSK-UBA-002: latest UCI per user (Poor/Moderate only), behind netskope:uba_read. */
export type NetskopeUciRating = 'Poor' | 'Moderate';
export type NetskopeUciRow = {
  email: string;
  user_id: string | null;
  name: string | null;
  rating: NetskopeUciRating;
  score: number;
  previous_score: number | null;
  scored_at: string;
};
export type NetskopeUciResponse = {
  configured: boolean;
  rows: NetskopeUciRow[];
  total: number;
  by_rating: Record<NetskopeUciRating, number>;
  captured_at: string | null;
};

export type NetskopeUciCounts = { users: number; poor: number; moderate: number };
export type NetskopeUciCompany = NetskopeUciCounts & { company: string; previous: NetskopeUciCounts | null };
export type NetskopeUciCompaniesResponse = { companies: NetskopeUciCompany[]; omitted_users: number; previous_week: string | null };

export type NetskopeAnomalySeverity = 'high' | 'medium' | 'low' | 'informational' | 'unknown';
export type NetskopeAnomaly = {
  severity: NetskopeAnomalySeverity; scenario: string | null; sub_scenario: string | null; rule: string | null;
  activity: string | null; app: string | null; score: number | null; time: string | null;
};
export type NetskopeAnomalies = {
  total: number; returned: number; truncated: boolean; window_days: number;
  by_severity: Record<NetskopeAnomalySeverity, number>;
  by_scenario: { scenario: string | null; sub_scenario: string | null; count: number }[];
  top_rules: { rule: string; count: number }[];
  recent: NetskopeAnomaly[];
};

export type NetskopeAttentionRow = {
  email: string; name: string | null; user_id: string | null;
  uci_rating: NetskopeUciRating | null; uci_score: number | null; uci_previous: number | null;
  adem_score: number | null; reasons: ('uci' | 'adem')[];
};
export type NetskopeAttention = { rows: NetskopeAttentionRow[]; adem_available: boolean };

/* NSK-POSTURE-001: checks evaluated at read time; each count is its inventory drill. */
export type NetskopePostureSeverity = 'high' | 'medium' | 'low';
export type NetskopePostureFinding = {
  object_id: number | null;
  name: string;
  user: string;
  os: string;
  client_version: string;
  last_event: string;
  score?: number | null;
  detected_at: string | null;
};
export type NetskopePostureCheck = {
  id: string;
  entity: 'device' | 'user';
  severity: NetskopePostureSeverity;
  title: string;
  description: string;
  status: 'evaluated' | 'not_configured' | 'not_permitted';
  count: number;
  query: Record<string, string>;
  findings: NetskopePostureFinding[];
};
export type NetskopePostureResponse = {
  checks: NetskopePostureCheck[];
  source_evidence: { source_fresh: boolean; source_status: string | null; source_completed_at: string | null; as_of: string | null };
  uci_captured_at: string | null;
};

/* NSK-EXP-ONPREM-001: Netskope's own On-Premises Detection, counted over recent active devices. */
export type NetskopePresenceCount = { key: string; count: number };
export type NetskopePresenceGroup = { key: string; total: number; statuses: Record<string, number> };
export type NetskopePresenceResponse = {
  total: number;
  reported: number;
  statuses: NetskopePresenceCount[];
  methods: NetskopePresenceCount[];
  by_client_config: NetskopePresenceGroup[];
  by_company: NetskopePresenceGroup[];
  company_omitted_devices: number;
  missing_label: string;
  source_evidence: { source_fresh: boolean; source_status: string | null; source_completed_at: string | null; as_of: string | null };
};

/* NSK-FLEET-001: grouped fleet reading for Equipos. Counts are over active devices with an event in 7 days. */
export type NetskopeFleetGroupBy = 'company' | 'os' | 'client_config' | 'device_make';
export type NetskopeFleetCounts = {
  devices: number; signal_24h: number;
  client_current: number; client_evaluated: number;
  os_supported: number; os_evaluated: number;
  on_prem: number; location_reported: number;
};
export type NetskopeFleetGroups = {
  group_by: NetskopeFleetGroupBy;
  client_baseline: boolean;
  os_baseline: boolean;
  summary: NetskopeFleetCounts;
  groups: Array<NetskopeFleetCounts & { key: string }>;
  omitted_groups: number;
  omitted_devices: number;
};

/* NSK-RBAC-001: Netskope administrators, their roles and each role's permissions, behind netskope:admin_inventory_read. */
export type NetskopeAdminRecordType = 'USER' | 'SERVICE_ACCOUNT';
export type NetskopeAdminRow = {
  id: string; name: string; active: boolean | null; is_locked: boolean | null; record_type: string | null;
  last_login: string | null; mfa_enabled: boolean | null; role_id: string | null; role_name: string | null;
};
export type NetskopeAdminsResponse = {
  configured: boolean; rows: NetskopeAdminRow[]; total: number; filtered_total: number; active: number;
  active_without_role: number; service_accounts: number; active_people_without_mfa: number; last_observed_at: string | null;
};
export type NetskopeAdminRoleRow = {
  id: string; name: string; reported_user_count: number | null; last_edited: string | null; api_groups_total: number | null;
  admins: number; read_groups: number; write_groups: number; admin_groups: number; last_seen_at: string;
};
export type NetskopeAdminRolesResponse = { configured: boolean; rows: NetskopeAdminRoleRow[]; total: number; last_observed_at: string | null };
export type NetskopeRolePermission = { group_id: number; group: string; permission: string; pages: string[] };
export type NetskopeRoleAdmin = { id: string; name: string; active: boolean | null; record_type: string | null };
export type NetskopeAdminRoleDetail = {
  id: string; name: string; last_edited: string | null; api_groups_total: number | null;
  permissions: NetskopeRolePermission[]; admins: NetskopeRoleAdmin[];
};
export type NetskopeAdminsQuery = { search: string; recordType: '' | NetskopeAdminRecordType; state: '' | 'active' | 'inactive'; role: '' | 'none'; page: number };
