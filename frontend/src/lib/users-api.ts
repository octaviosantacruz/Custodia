import { api } from './api';

export type User = { actor_id: string; email: string; display_name: string; is_active: boolean; must_change_password: boolean; roles: string[] };

export type UserListFilters = { search: string; roleFilter: string; statusFilter: string; page: number; pageSize: number };

export async function listUsers(filters: UserListFilters): Promise<{ rows: User[]; total: number }> {
  const query = `q=${encodeURIComponent(filters.search)}&role=${filters.roleFilter}&status=${filters.statusFilter}&limit=${filters.pageSize}&offset=${filters.page * filters.pageSize}`;
  return api<{ rows: User[]; total: number }>('/auth/users?' + query);
}

export async function createUser(payload: { email: string; display_name: string; role_code: string }): Promise<{ temporary_password: string }> {
  return api('/auth/users', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateUser(actorId: string, changes: Record<string, unknown>): Promise<void> {
  await api('/auth/users/' + encodeURIComponent(actorId), { method: 'PATCH', body: JSON.stringify(changes) });
}

export async function deleteUser(actorId: string): Promise<void> {
  await api('/auth/users/' + encodeURIComponent(actorId), { method: 'DELETE' });
}

export async function reissueTempPassword(actorId: string): Promise<{ temporary_password: string }> {
  return api('/auth/users/' + encodeURIComponent(actorId) + '/reissue-temp-password', { method: 'POST' });
}
