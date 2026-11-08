import type { AnalyticsBucket } from '../../../cross/types/analytics';

export type ClassificationStatus = 'pending' | 'assigned' | 'review';
export type WorkflowStatus = 'pending' | 'in_progress' | 'blocked' | 'resolved' | 'retired' | 'retention_hold';
export type DatabaseView = 'table' | 'summary';
export type SafeHealthFilter = '' | 'missing_cpm' | 'no_accounts' | 'olac_disabled' | 'retention_unconfigured' | 'manage_safe_concentration';
export type AccountPlatformStatus = '' | 'with_platform' | 'without_platform' | 'partial_platform';

export type AccountPlatformCoverage = {
  accounts_active: number;
  accounts_with_platform: number;
  accounts_without_platform: number;
  accounts_with_partial_platform: number;
  platforms_observed: number;
  safes_without_accounts: number;
};

export type AccountManagementSummary = {
  accounts_active: number;
  automatic_enabled: number;
  automatic_disabled: number;
  management_unknown: number;
  status_success: number;
  status_failure: number;
  status_in_process: number;
  status_unknown: number;
  changed_30d: number;
  changed_90d: number;
  changed_365d: number;
  changed_older: number;
  changed_unknown: number;
};

export type AccountManagementStatus = 'success' | 'failure' | 'in_process';

export type SafeRow = {
  safe_number: number;
  safe_name: string;
  safe_url_id: string;
  location: string | null;
  member_count: number;
  account_count: number;
  cpm_configured: boolean;
  olac_enabled: boolean | null;
  number_of_days_retention?: number | null;
  number_of_versions_retention?: number | null;
  retired_account_count?: number;
  last_account_retired_at?: string | null;
  retention_configured: boolean;
  manage_safe_principal_count: number;
  account_type_counts: Record<string, number>;
  internal_name: string | null;
  business_unit_id: number | null;
  responsible_id: number | null;
  classification_status: ClassificationStatus;
  inventory_scope: 'pending' | 'business' | 'internal';
  account_type_classification: 'nominal' | 'no_nominal' | 'internal' | null;
  data_quality_status: 'pending' | 'clean' | 'obsolete' | 'duplicate';
  scope_hint: 'possible_internal_accounts_safe' | null;
  business_unit_name: string | null;
  responsible_name: string | null;
  workflow_status: WorkflowStatus;
  next_action: string | null;
};

export type SafeClassificationCounts = { assigned: number; review: number; pending: number };

export type SafeListResponse = {
  rows: SafeRow[];
  total: number;
  classification_counts: SafeClassificationCounts;
  limit: number;
  offset: number;
};

export type Account = {
  safe_number: number;
  safe_name: string;
  account_id: string;
  account_name: string;
  user_name: string | null;
  address: string | null;
  platform_id: string | null;
  platform_name: string | null;
  lifecycle_status: 'active' | 'retired';
  last_seen_at: string;
  retired_detected_at?: string | null;
  attributes: Record<string, string | boolean | null> & {
    automatic_management_enabled?: boolean | null;
    management_status?: AccountManagementStatus | null;
    secret_modified_at?: string | null;
  };
  inventory_account_type: 'nominal' | 'no_nominal' | 'internal' | null;
};

export type SafeDetail = SafeRow & {
  creator_name: string | null;
  description: string | null;
  managing_cpm: string | null;
  number_of_versions_retention: number | null;
  number_of_days_retention: number | null;
  auto_purge_enabled: boolean | null;
  creation_time: string | null;
  last_modification_time: string | null;
  business_unit_id: number | null;
  responsible_id: number | null;
  notes: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
};

export type Member = {
  member_id: string;
  member_name: string;
  member_type: string;
  membership_expiration_date: string | null;
  is_predefined_user: boolean | null;
  is_read_only: boolean | null;
  permissions: Record<string, boolean>;
};

export type Catalogs = {
  business_units: { business_unit_id: number; unit_code: string; unit_name: string; is_active?: boolean }[];
  responsibles: { responsible_id: number; display_name: string; email: string; is_active?: boolean }[];
  account_types: { key: string; count: number; safes: number }[];
};

export type { AnalyticsBucket };

export type Analytics = {
  workflow_status: AnalyticsBucket[];
  next_actions: AnalyticsBucket[];
  account_types: AnalyticsBucket[];
  business_units: AnalyticsBucket[];
  responsibles: AnalyticsBucket[];
};

export type MetadataForm = {
  internal_name: string;
  business_unit_id: number | '';
  responsible_id: number | '';
  classification_status: ClassificationStatus;
  inventory_scope: 'pending' | 'business' | 'internal';
  data_quality_status: 'pending' | 'clean' | 'obsolete' | 'duplicate';
  workflow_status: WorkflowStatus;
  next_action: string;
  assigned_by: string;
  notes: string;
};

export type RetiredSafeRow = {
  safe_number: number;
  safe_name: string;
  /* The API allows null when CyberArk reported no URL ID for the Safe. */
  safe_url_id: string | null;
  retired_at: string | null;
  retired_member_count: number;
};

export type RetiredCandidates = {
  rows: RetiredSafeRow[];
  total: number;
  deletion_enabled: boolean;
};
