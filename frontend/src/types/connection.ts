import type { AccessConcentration } from './dashboard';

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

export type ConnectionSiaMatch = { object_id: number; display_name: string; source_id: string };
export type ConnectionInventoryRow = ConnectionInventoryImportRow & {
  inventory_id: number;
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
  filters: { environment: string; coverage: ConnectionCoverageFilter | '' };
  import: { import_id: string; file_name: string; row_count: number; imported_at: string } | null;
};
export type ConnectionInventoryImportPayload = { file_name: string; rows: ConnectionInventoryImportRow[] };

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
