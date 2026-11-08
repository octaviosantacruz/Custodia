
export type ConcentrationEntry = { name: string; safe_count: number };
export type AccessConcentration = {
  users: ConcentrationEntry[];
  roles: ConcentrationEntry[];
  totals: { users: number; roles: number; safes: number };
};

export type WorkStatus = 'pending' | 'in_progress' | 'onboarded' | 'blocked' | 'not_applicable';

export type ConnectionInventoryImportRow = {
  source_row_number: number;
  instance_name: string;
  environment: string;
  private_ip: string;
  port: number | null;
  ca_sia: boolean | null;
  ca_dba: boolean | null;
  zsp_implemented: boolean | null;
  access_available: boolean | null;
  description: string;
  /** Only a file that carries these columns overrides what people set in the inventory. */
  work_status?: WorkStatus | null;
  responsible?: string | null;
  note?: string | null;
};

export type ConnectionSafeMatch = {
  safe_number: number;
  safe_name: string;
  account_id: string;
  account_name: string;
  address: string | null;
  platform_name: string | null;
  platform_id: string | null;
};

export type PolicyCapability = 'platform' | 'dba' | 'other';
export type CapabilityResult = 'match' | 'missing' | 'undeclared' | 'unclassified' | 'unknown';
export type ConnectionSiaMatch = { object_id: number; display_name: string; source_id: string; capability: PolicyCapability | null };
export type ConnectionInventoryRow = ConnectionInventoryImportRow & {
  inventory_id: number;
  lifecycle_status: 'active' | 'retired';
  retired_at: string | null;
  platform_result: CapabilityResult | null;
  dba_result: CapabilityResult | null;
  work_status: WorkStatus;
  responsible: string;
  note: string;
  import_id: string;
  file_name: string;
  row_count: number;
  imported_at: string;
  safe_matches: ConnectionSafeMatch[];
  sia_matches: ConnectionSiaMatch[];
  safe_match_count: number;
  sia_match_count: number;
  import?: { import_id: string; file_name: string; row_count: number; imported_at: string };
};
export type ConnectionInventoryResponse = {
  rows: ConnectionInventoryRow[];
  total: number;
  limit: number;
  offset: number;
  search: string;
  filters: { environment: string; coverage: ConnectionCoverageFilter | ''; status: ConnectionStatusFilter; deviation: ConnectionDeviationFilter; work_status: WorkStatus | ''; responsible: string };
  import: { import_id: string; file_name: string; row_count: number; imported_at: string } | null;
};
export type ConnectionImportMode = 'update' | 'replace';
export type ConnectionInventoryImportPayload = { file_name: string; rows: ConnectionInventoryImportRow[]; mode: ConnectionImportMode };
export type ConnectionStatusFilter = 'active' | 'retired' | 'all';
export type ConnectionImportCounts = { incoming: number; new: number; changed: number; unchanged: number; missing: number; already_retired: number };
export type ConnectionImportSample = { private_ip: string; port: number | null; instance_name: string; fields: string[]; reactivated: boolean };
export type ConnectionImportPreview = {
  mode: ConnectionImportMode;
  counts: ConnectionImportCounts;
  samples: { new: ConnectionImportSample[]; changed: ConnectionImportSample[]; missing: ConnectionImportSample[] };
  errors: { row: number; message: string }[];
};

export type ConnectionCoverageFilter = 'both' | 'pam_only' | 'sia_only' | 'none';
export type ConnectionCoverageTotals = {
  total: number;
  both: number;
  pam_only: number;
  sia_only: number;
  none: number;
  zsp_implemented: number;
  zsp_pending: number;
  zsp_unknown: number;
};
export type ConnectionCoverageEnvironment = ConnectionCoverageTotals & { environment: string };
export type ExecutiveAnalytics = {
  connection_coverage: {
    totals: ConnectionCoverageTotals;
    by_environment: ConnectionCoverageEnvironment[];
    import: { import_id: string; file_name: string; row_count: number; imported_at: string } | null;
  };
  access_concentration: AccessConcentration;
};

export type ConnectionDestinationValues = Omit<ConnectionInventoryImportRow, 'source_row_number'>;
/** Only the fields sent change; `null` on a flag clears it to "sin dato". */
export type ConnectionDestinationChanges = Partial<ConnectionDestinationValues> & { lifecycle_status?: 'active' | 'retired' };

export type ConnectionDeviationFilter = '' | 'platform' | 'dba' | 'any';
export type CapabilityReadings = Record<CapabilityResult, number>;
export type ConnectionDeviations = {
  platform: CapabilityReadings; dba: CapabilityReadings; policies: { total: number; classified: number };
  work: Record<WorkStatus, number>; responsibles: { responsible: string; total: number }[];
};
export type ConnectionHistoryEvent = { actor_id: string; action: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; created_at: string };
export type SiaPolicyRow = {
  source_id: string; display_name: string; status: string; capability: PolicyCapability | null;
  suggested: 'platform' | 'dba' | null; destinations: number; classified_by: string | null; classified_at: string | null;
};

export type CoverageBlock = { n: number; platform: CapabilityReadings; dba: CapabilityReadings; work: Record<WorkStatus, number> };
export type CoverageProgress = { total: CoverageBlock; by_environment: (CoverageBlock & { environment: string })[]; by_responsible: (CoverageBlock & { responsible: string })[] };
export type CoveragePoint = CoverageBlock & { snapshot_date: string; captured_at: string };
export type CoverageProgressResponse = { current: CoverageProgress; series: CoveragePoint[] };

export type StaleDestination = {
  inventory_id: number; instance_name: string; environment: string; private_ip: string; port: number | null;
  work_status: WorkStatus; responsible: string; last_change: string | null; idle_since: string; idle_days: number;
};
export type StaleDestinationsResponse = { days: number; total: number; rows: StaleDestination[] };

export type UninventoriedAddress = { address: string; pam_accounts: number; pam_safes: number; sia_policies: number; sia_policy_names: string[] };
export type UninventoriedAddressesResponse = { total: number; rows: UninventoriedAddress[] };
