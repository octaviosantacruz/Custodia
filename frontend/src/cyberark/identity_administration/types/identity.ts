export type IdentityUserAttributes = {
  user_name: string;
  email: string;
  active: boolean | null;
  service_user: boolean;
  oauth_client: boolean | null;
  last_login_date: string;
  last_modified: string;
  record_source?: string;
};

// IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §4: a business-owned
// classification (email domain -> expected Okta federation), never a
// relationship CyberArk's API delivers. match_basis is always
// "email_domain_rule" so the UI never presents this as native evidence.
export type FederationResolutionStatus = 'matched' | 'missing_federation' | 'unsupported_domain' | 'missing_email' | 'ambiguous';

export type FederationResolution = {
  status: FederationResolutionStatus;
  match_basis: 'email_domain_rule';
  email_domain: string | null;
  federation_code: string | null;
  expected_name: string | null;
  object_id: number | null;
  source_id: string | null;
  display_name: string | null;
  active: boolean | null;
};

export type IdentityUserRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  attributes: IdentityUserAttributes;
  role_count: number;
  standard_seat_reconciled?: boolean;
  federation_resolution?: FederationResolution;
};


export type IdentityUserListResponse = {
  rows: IdentityUserRow[];
  total: number;
  limit: number;
  offset: number;
};

export type IdentityRoleAttributes = { last_modified: string; direct_member_count?: number; unresolved_member_count?: number; membership_status?: 'complete' | 'not_reported' };

export type IdentityRoleRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  attributes: IdentityRoleAttributes;
  member_count: number;
};

export type IdentityRoleListResponse = {
  rows: IdentityRoleRow[];
  total: number;
  limit: number;
  offset: number;
};

export type IdentityRoleRef = { object_id: number; display_name: string; source_id: string };

export type IdentityUserDetail = {
  user: IdentityUserRow & { first_seen_at: string; last_seen_at: string };
  roles: IdentityRoleRef[];
};

export type IdentityUserRef = { object_id: number; display_name: string; source_id: string };

export type IdentityRoleDetail = {
  role: IdentityRoleRow & { first_seen_at: string; last_seen_at: string };
  members: IdentityUserRef[];
};

export type IdentityMembershipNode = {
  object_id: number; source_id: string; display_name: string;
  kind: 'user' | 'role' | 'okta_group';
  membership_status: 'complete' | 'not_reported';
  unresolved_member_count: number; last_seen_at: string | null;
  direct_member_count?: number | null;
  unresolved_members?: { display_name: string; kind: 'user' | 'role' | 'unknown' }[];
  user_name?: string;
};
export type IdentityMembership = {
  root_id: number; nodes: IdentityMembershipNode[];
  edges: { parent_id: number; member_id: number }[]; truncated: boolean;
};

export type IdentityRoleMatchRef = { id: string; object_id: number | null; name: string; traversal?: IdentityRoleMatchRef[] };
export type IdentityRoleMatches = {
  same_direct_members: Array<{ roles: IdentityRoleMatchRef[]; direct_members: number }>;
  same_user_references: Array<{ roles: IdentityRoleMatchRef[]; referenced_accounts: number }>;
  roles_with_incomplete_user_paths: string[];
  permissions_status: 'not_collected';
  scope: string;
  source: { source_system: string; last_run_status: string | null; last_run_finished_at: string | null };
  complete: boolean;
  roles_analyzed: number;
  roles_excluded: number;
};

export type IdentityLayerFreshness = {
  stage: string;
  last_success_at: string | null;
  last_status: 'completed' | 'failed';
  last_attempt_at: string;
};
