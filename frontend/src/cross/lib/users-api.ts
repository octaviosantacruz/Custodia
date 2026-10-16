import { api } from './api';

/** ACCESS-UI-001: 'oidc' roles come from the identity's Okta groups; 'manual' ones were assigned in DS Hub. */
export type RoleAssignment = { role_code: string; source: 'oidc' | 'manual' };
export type User = { actor_id: string; email: string; display_name: string; is_active: boolean; must_change_password: boolean; roles: string[]; role_assignments?: RoleAssignment[]; auth_source: 'local' | 'oidc'; last_login_at: string | null; observed_groups?: string[] | null; groups_observed_at?: string | null };
export type Person = { key: string; email: string; display_name: string; identities: User[] };

export type UserListFilters = { search: string; roleFilter: string; statusFilter: string; page: number; pageSize: number };

export async function listPeople(filters: UserListFilters): Promise<{ rows: Person[]; total: number }> {
  const query = `q=${encodeURIComponent(filters.search)}&role=${filters.roleFilter}&status=${filters.statusFilter}&limit=${filters.pageSize}&offset=${filters.page * filters.pageSize}`;
  return api<{ rows: Person[]; total: number }>('/auth/people?' + query);
}

export async function createUser(payload: { email: string; display_name: string; role_code: string }): Promise<{ temporary_password: string }> {
  return api('/auth/users', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateUser(actorId: string, changes: Record<string, unknown>): Promise<void> {
  await api('/auth/users/' + encodeURIComponent(actorId), { method: 'PATCH', body: JSON.stringify(changes) });
}

export async function grantUserRole(actorId: string, roleCode: string): Promise<void> {
  await api('/auth/users/' + encodeURIComponent(actorId) + '/roles', { method: 'POST', body: JSON.stringify({ role_code: roleCode }) });
}

export async function revokeUserRole(actorId: string, roleCode: string): Promise<void> {
  await api('/auth/users/' + encodeURIComponent(actorId) + '/roles/' + encodeURIComponent(roleCode), { method: 'DELETE' });
}

/** Older responses without role_assignments: an Okta identity's roles are Okta's. */
export function roleAssignments(user: User): RoleAssignment[] {
  return user.role_assignments ?? user.roles.map((role_code) => ({ role_code, source: user.auth_source === 'oidc' ? 'oidc' : 'manual' }));
}

export async function deleteUser(actorId: string): Promise<void> {
  await api('/auth/users/' + encodeURIComponent(actorId), { method: 'DELETE' });
}

export async function reissueTempPassword(actorId: string): Promise<{ temporary_password: string }> {
  return api('/auth/users/' + encodeURIComponent(actorId) + '/reissue-temp-password', { method: 'POST' });
}

/** ACCESS-REVIEW-001: one row per role assignment with the signals of a periodic access review. */
export type AccessReviewFlag = 'inactive_account' | 'manual_old' | 'stale_login';
export type AccessReviewRow = {
  actor_id: string; email: string; display_name: string; is_active: boolean; auth_source: 'local' | 'oidc'; last_login_at: string | null;
  role_code: string; role_name: string; source: 'oidc' | 'manual'; granted_at: string | null; granted_by: string | null; flags: AccessReviewFlag[];
};
export type AccessReviewSummary = { assignments: number; attention: number; inactive_account: number; manual_old: number; stale_login: number };
export type AccessReviewResponse = { rows: AccessReviewRow[]; total: number; limit: number; offset: number; days: number; summary: AccessReviewSummary };
export type AccessReviewFilter = '' | 'attention' | AccessReviewFlag;

export function fetchAccessReview(filters: { search: string; flag: AccessReviewFilter; days: number; page: number; pageSize: number }, signal?: AbortSignal): Promise<AccessReviewResponse> {
  const query = `q=${encodeURIComponent(filters.search)}&flag=${filters.flag}&days=${filters.days}&limit=${filters.pageSize}&offset=${filters.page * filters.pageSize}`;
  return api('/auth/access-review?' + query, { signal });
}
