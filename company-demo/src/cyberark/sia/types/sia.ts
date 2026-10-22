export type SiaPolicyAttributes = {
  status: string;
  description: string;
  platforms: string[];
  rule_names: string[];
  policy_type: string;
  granted_users: string[];
  granted_groups: string[];
  granted_roles: string[];
  ip_rules: unknown[];
  fqdn_rules: unknown[];
  logical_names: unknown[];
};

export type SiaPolicyPersonMatch = { object_id: number; display_name: string };
export type SiaPolicyPersonResolution = {
  status: 'matched' | 'ambiguous' | 'unmatched';
  match?: SiaPolicyPersonMatch;
};
export type SiaPolicyGranteeLink = {
  value: string;
  identity?: SiaPolicyPersonResolution;
  pam?: SiaPolicyPersonResolution;
};

export type SiaPolicyRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  attributes: SiaPolicyAttributes;
  grantee_links?: SiaPolicyGranteeLink[];
  linked_safes?: {
    safe_number: number;
    safe_name: string;
    matched_ips: string[];
    accounts?: { account_id: string; account_name: string; address: string | null; platform_name: string | null; platform_id: string | null }[];
  }[];
  linked_ip_count?: number;
  linkage_status?: 'linked' | 'multiple' | 'unlinked';
};

export type SiaPolicyListResponse = {
  rows: SiaPolicyRow[];
  total: number;
  limit: number;
  offset: number;
};

export type SiaPolicyReference = { object_id: number; display_name: string; source_id: string; attributes: SiaPolicyAttributes };

export type SiaConnectorAttributes = {
  status: string;
  status_code: string;
  version: string;
  is_latest_version: boolean;
  os: string;
  host_type: string;
  region: string;
  workspace_id: string;
  active_sessions_count: number | null;
};

export type SiaConnectorRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  attributes: SiaConnectorAttributes;
};

export type SiaConnectorListResponse = { rows: SiaConnectorRow[]; total: number; limit: number; offset: number; search: string };

export type SiaResourceAttributes = {
  resource_type: string;
  os_type: string;
  location_type: string;
  discovery_engine: string;
  scanned_on: string;
};

export type SiaResourceRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  attributes: SiaResourceAttributes;
};

export type SiaResourceListResponse = { rows: SiaResourceRow[]; total: number; limit: number; offset: number; search: string; resource_type: string };

export type SiaDatabaseAccountAttributes = {
  store_type: string;
  platform: string;
  port: number | null;
  database: string;
  created_at: string;
  modified_at: string;
};

export type SiaDatabaseAccountRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  attributes: SiaDatabaseAccountAttributes;
};

export type SiaDatabaseAccountListResponse = { rows: SiaDatabaseAccountRow[]; total: number; limit: number; offset: number; search: string };
