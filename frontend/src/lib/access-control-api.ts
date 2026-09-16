import { api } from './api';

export type AccessPermission = {
  permission_code: string;
  domain_code: string;
  resource_code: string;
  action_code: string;
  description: string;
  lifecycle_status: 'active' | 'planned';
  system_managed: boolean;
};

export type AccessRole = {
  role_code: string;
  display_name: string;
  description: string;
  domain_code: string | null;
  lifecycle_status: 'active' | 'planned';
  system_managed: boolean;
  role_kind: 'direct' | 'composite';
  permission_codes: string[];
  level_refs: CustomRoleLevelRef[];
  user_count: number;
};

export type AccessLevel = {
  level_code: string;
  display_name: string;
  base_role_code: string;
  lifecycle_status: 'active' | 'planned';
  permission_codes: string[];
};

export type AccessDomain = {
  domain_code: string;
  display_name: string;
  lifecycle_status: 'active' | 'planned';
  sort_order: number;
  levels: AccessLevel[];
};

export type CustomRoleLevelRef = {
  domain_code: string;
  level_code: string;
  level_display_name?: string;
  base_role_code?: string;
};

export type CustomRoleDraft = {
  role_code: string;
  display_name: string;
  description: string;
  level_refs: Array<Pick<CustomRoleLevelRef, 'domain_code' | 'level_code'>>;
};

export type CustomRoleWarning = {
  code: 'duplicate_combination';
  matching_role_code: string;
  matching_role_name: string;
};

export type CustomRoleResult = {
  role_code: string;
  warning: CustomRoleWarning | null;
};

export type RoleDraft = {
  role_code: string;
  display_name: string;
  description: string;
  domain_code: string;
  permission_codes: string[];
};

export async function listAccessRoles(): Promise<{ rows: AccessRole[] }> {
  return api('/access/roles');
}

export async function listAccessPermissions(): Promise<{ rows: AccessPermission[] }> {
  return api('/access/permissions');
}

export async function listAccessDomains(): Promise<{ rows: AccessDomain[] }> {
  return api('/access/domains');
}

export async function createAccessRole(payload: RoleDraft): Promise<void> {
  await api('/access/roles', { method: 'POST', body: JSON.stringify(payload) });
}

export type PermissionDraft = {
  permission_code: string;
  domain_code: string;
  resource_code: string;
  action_code: string;
  description: string;
};

export async function createAccessPermission(payload: PermissionDraft): Promise<void> {
  await api('/access/permissions', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateAccessRole(roleCode: string, payload: Omit<RoleDraft, 'role_code'>): Promise<void> {
  await api('/access/roles/' + encodeURIComponent(roleCode), { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function createCompositeAccessRole(payload: CustomRoleDraft): Promise<CustomRoleResult> {
  return api('/access/roles/composite', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateCompositeAccessRole(roleCode: string, payload: Omit<CustomRoleDraft, 'role_code'>): Promise<CustomRoleResult> {
  return api('/access/roles/' + encodeURIComponent(roleCode) + '/composite', { method: 'PATCH', body: JSON.stringify(payload) });
}
