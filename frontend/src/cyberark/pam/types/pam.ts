import type { SiaPolicyReference } from '../../sia/types/sia';
export type {
  IdentityPamChain,
  IdentityPamChainPlatform,
  IdentityPamChainPsm,
  IdentityPamChainRole,
  IdentityPamChainSafe,
  PamUserChain,
} from '../../../cross/types/identity-pam-chain';

export type PamRoleUser = { object_id: number; display_name: string; source_id: string };
export type PamRoleSafe = { object_id: number; display_name: string; source_id: string; account_count: number };
export type PamRoleRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  attributes: Record<string, string>;
  member_count: number;
  safe_count: number;
  account_count: number;
  sia_reference_count: number;
  role_examples?: PamRoleUser[];
};
export type PamRoleListResponse = { rows: PamRoleRow[]; total: number; limit: number; offset: number };
export type PamRoleDetail = {
  role: PamRoleRow & { first_seen_at: string; last_seen_at: string };
  users: PamRoleUser[];
  safes: PamRoleSafe[];
  sia_references: SiaPolicyReference[];
  sia_match_type: 'display_name_reference_only';
};

export type PamPlatformPsm = { object_id: number; display_name: string; source_id: string };
export type PamPlatformRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  system_type: string;
  active: boolean;
  allowed_safes_pattern: string;
  safe_count: number;
  account_count: number;
  psms: PamPlatformPsm[];
};
export type PamPlatformListResponse = { rows: PamPlatformRow[]; total: number; limit: number; offset: number; search: string };
export type PamConnectorPlatform = { object_id: number; display_name: string; source_id: string };
export type PamConnectorRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  address: string;
  platform_count: number;
  platforms: PamConnectorPlatform[];
};
export type PamConnectorListResponse = { rows: PamConnectorRow[]; total: number; limit: number; offset: number; search: string };

// PSM-001: session connector-type catalog (e.g. PSM-RDP, PSM-SSH). Distinct
// from PamConnectorRow, which is actually the PSM *server* inventory.
export type PsmConnectorTypeRow = { object_id: number; display_name: string; source_id: string };
export type PsmConnectorTypeListResponse = { rows: PsmConnectorTypeRow[]; total: number; limit: number; offset: number; search: string };

// SYS-001: PAM component health (Portal/CPM/PSM). No host inventory.
export type PamComponentRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  description: string;
  total_count: number;
  connected_count: number;
  instance_versions: string[];
  latest_logon_at: number | null;
  all_instances_logged_on: boolean;
};
export type PamComponentListResponse = { rows: PamComponentRow[] };

// PLAT-003: dependent / grouped / rotational-group platform catalogs.
export type PlatformDependentRow = {
  object_id: number; display_name: string; source_id: string;
  platform_base_id: string; platform_base_type: string; linked_target_platforms: number;
};
export type PlatformGroupRow = { object_id: number; display_name: string; source_id: string; active: boolean };
export type PlatformCatalogsResponse = {
  dependents: PlatformDependentRow[];
  groups: PlatformGroupRow[];
  rotational_groups: PlatformGroupRow[];
};

// PLAT-002: CPM/workflow policy for CyberArk's "target platform" catalog.
// Its own object type -- its ID/Name space does not reliably match the
// regular platform's PlatformID, so it is never merged onto PamPlatformRow.
export type PlatformTargetRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  platform_base_id: string;
  dual_control_required: boolean;
  otp_required: boolean;
  reason_required: boolean;
  exclusive_access_required: boolean;
  credentials_change_automatic: boolean;
  credentials_change_interval_days: number | null;
  credentials_verify_automatic: boolean;
  credentials_verify_interval_days: number | null;
  credentials_reconcile_automatic: boolean;
  psm_server_id: string;
};
export type PlatformTargetListResponse = { rows: PlatformTargetRow[]; total: number; limit: number; offset: number; search: string };

export type PamCleanupPeerGroup = {
  object_id: number;
  display_name: string;
  source_id: string;
  safe_count: number;
};

export type PamCleanupSignalItem = {
  object_id: number;
  display_name: string;
  source_id: string;
  reason: string;
  is_factory: boolean;
  factory_label: string | null;
  member_count: number | null;
  safe_count: number | null;
  peer_groups: PamCleanupPeerGroup[];
  inventory_scope: 'pending' | 'business' | 'internal' | null;
  account_type_classification: 'nominal' | 'no_nominal' | 'internal' | null;
  classification_status: 'pending' | 'assigned' | 'review' | null;
};

export type PamCleanupInventoryRun = {
  run_id: string;
  source_system: 'cyberark';
  source_file: 'cyberark-api' | 'cyberark-psm-api';
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
  enqueued_at: string;
  started_at: string;
  completed_at: string | null;
  inventory_refreshed: boolean;
};

export type PamCleanupInventoryEvidence = {
  family: 'pam_inventory' | 'psm_catalog';
  latest_attempt: PamCleanupInventoryRun | null;
  last_completed_inventory: PamCleanupInventoryRun | null;
};

export type PamCleanupSignal = {
  count: number;
  denominator: number;
  items: PamCleanupSignalItem[];
  computed_at: string;
  inventory_runs: PamCleanupInventoryEvidence[];
};

export type PamCleanupSignalsResponse = {
  empty_groups: PamCleanupSignal;
  identical_member_groups: PamCleanupSignal;
  redundant_groups_with_access_peer: PamCleanupSignal;
  orphan_psm: PamCleanupSignal;
  platforms_without_accounts: PamCleanupSignal;
  safes_without_active_users: PamCleanupSignal;
};

export type PamUserRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  role_count: number;
  standard_seat_reconciled: boolean;
  enabled: boolean;
  suspended: boolean;
};
export type PamUserListResponse = {
  rows: PamUserRow[];
  total: number;
  limit: number;
  offset: number;
  search: string;
  status?: string;
};
