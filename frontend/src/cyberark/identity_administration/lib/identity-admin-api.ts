import { api } from '../../../cross/lib/api';
import type {
  IdentityLayerFreshness, IdentityRoleDetail, IdentityRoleListResponse, IdentityUserDetail,
  IdentityUserListResponse,
  IdentityRoleMatches,
} from '../types/identity';
import type { IdentityPamChain } from '../../../cross/types/identity-pam-chain';

export const IDENTITY_ADMIN_PAGE_SIZE = 50;

export async function fetchIdentityUsers(
  search: string,
  page: number,
  activeFilter: 'active' | 'inactive' | '',
  standardSeat: '' | 'reconciled' | 'unreconciled' = '',
  signal?: AbortSignal,
): Promise<IdentityUserListResponse> {
  return api<IdentityUserListResponse>(
    `/cmdb/identity-users?limit=${IDENTITY_ADMIN_PAGE_SIZE}&offset=${page * IDENTITY_ADMIN_PAGE_SIZE}&q=${encodeURIComponent(search)}&active=${activeFilter}&standard_seat=${standardSeat}`,
    { signal },
  );
}

export async function fetchIdentityUserDetail(objectId: number, signal?: AbortSignal): Promise<IdentityUserDetail> {
  return api<IdentityUserDetail>(`/cmdb/identity-users/${objectId}`, { signal });
}

export async function fetchIdentityUserPamChain(objectId: number, signal?: AbortSignal): Promise<IdentityPamChain> {
  return api<IdentityPamChain>(`/cmdb/identity-users/${objectId}/pam-chain`, { signal });
}

export type IdentityRoleKind = '' | 'role' | 'okta_group';
export type IdentityRoleSort = 'name' | 'members' | 'modified';

export async function fetchIdentityRoles(
  search: string, page: number, kind: IdentityRoleKind = '', sort: IdentityRoleSort = 'name', direction: 'asc' | 'desc' = 'asc', objectIds: number[] | null = null, signal?: AbortSignal,
): Promise<IdentityRoleListResponse> {
  const only = objectIds && objectIds.length ? `&object_ids=${objectIds.join(',')}` : '';
  return api<IdentityRoleListResponse>(
    `/cmdb/identity-roles?limit=${IDENTITY_ADMIN_PAGE_SIZE}&offset=${page * IDENTITY_ADMIN_PAGE_SIZE}&q=${encodeURIComponent(search)}&kind=${kind}&sort=${sort}&direction=${direction}${only}`,
    { signal },
  );
}

export async function fetchIdentityRoleDetail(objectId: number, signal?: AbortSignal): Promise<IdentityRoleDetail> {
  return api<IdentityRoleDetail>(`/cmdb/identity-roles/${objectId}`, { signal });
}

export async function fetchIdentityMembership(objectId: number, signal?: AbortSignal) {
  return api<import('../types/identity').IdentityMembership>(`/cmdb/identity-roles/${objectId}/membership`, { signal });
}

export async function fetchIdentityRoleMatches(signal?: AbortSignal): Promise<IdentityRoleMatches> {
  return api<IdentityRoleMatches>('/cmdb/identity-roles/member-matches', { signal });
}

export async function fetchIdentityLayerFreshness(signal?: AbortSignal): Promise<IdentityLayerFreshness[]> {
  const data = await api<{ rows: IdentityLayerFreshness[] }>('/ingestion/sources/identity_administration/stages/latest', { signal });
  return Array.isArray(data?.rows) ? data.rows : [];
}
