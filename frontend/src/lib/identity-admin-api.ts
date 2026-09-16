import { api } from './api';
import type {
  IdentityFederationListResponse, IdentityRoleDetail, IdentityRoleListResponse, IdentityUserDetail,
  IdentityUserListResponse,
} from '../types/identity';
import type { IdentityPamChain } from '../types/pam';

export const IDENTITY_ADMIN_PAGE_SIZE = 50;

export async function fetchIdentityUsers(
  search: string,
  page: number,
  activeFilter: 'active' | 'inactive' | '',
  standardSeat: '' | 'reconciled' | 'unreconciled' = '',
): Promise<IdentityUserListResponse> {
  return api<IdentityUserListResponse>(
    `/cmdb/identity-users?limit=${IDENTITY_ADMIN_PAGE_SIZE}&offset=${page * IDENTITY_ADMIN_PAGE_SIZE}&q=${encodeURIComponent(search)}&active=${activeFilter}&standard_seat=${standardSeat}`,
  );
}

export async function fetchIdentityUserDetail(objectId: number): Promise<IdentityUserDetail> {
  return api<IdentityUserDetail>(`/cmdb/identity-users/${objectId}`);
}

export async function fetchIdentityUserPamChain(objectId: number): Promise<IdentityPamChain> {
  return api<IdentityPamChain>(`/cmdb/identity-users/${objectId}/pam-chain`);
}

export async function fetchIdentityRoles(
  search: string, page: number, kind: '' | 'role' | 'okta_group' = '',
): Promise<IdentityRoleListResponse> {
  return api<IdentityRoleListResponse>(
    `/cmdb/identity-roles?limit=${IDENTITY_ADMIN_PAGE_SIZE}&offset=${page * IDENTITY_ADMIN_PAGE_SIZE}&q=${encodeURIComponent(search)}&kind=${kind}`,
  );
}

export async function fetchIdentityRoleDetail(objectId: number): Promise<IdentityRoleDetail> {
  return api<IdentityRoleDetail>(`/cmdb/identity-roles/${objectId}`);
}

export async function fetchIdentityFederations(search: string, limit = 100, offset = 0, options?: RequestInit): Promise<IdentityFederationListResponse> {
  return api<IdentityFederationListResponse>(`/cmdb/identity-federations?limit=${limit}&offset=${offset}&q=${encodeURIComponent(search)}`, options);
}
