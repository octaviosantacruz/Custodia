export type IdentityUserAttributes = {
  user_name: string;
  email: string;
  active: boolean;
  service_user: boolean;
  oauth_client: boolean;
  last_login_date: string;
  last_modified: string;
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

export type IdentityRoleAttributes = { last_modified: string };

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

export type IdentityFederationAttributes = {
  federation_type: string;
  active: boolean;
  role: string;
  usage: string;
};

export type IdentityFederationRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  attributes: IdentityFederationAttributes;
};

export type IdentityFederationListResponse = { rows: IdentityFederationRow[]; total: number; limit: number; offset: number; search: string };
