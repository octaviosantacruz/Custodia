import { api } from './api';
import type { PamRoleDetail, PamRoleListResponse } from '../types/pam';
import type { PamIdentityKind } from './pam-identity-classification';

export const PAM_ROLE_PAGE_SIZE = 50;

export async function fetchPamRoles(search: string, page: number, kind: PamIdentityKind | '', includeInternal = true): Promise<PamRoleListResponse> {
  return api<PamRoleListResponse>(
    `/cmdb/pam-roles?limit=${PAM_ROLE_PAGE_SIZE}&offset=${page * PAM_ROLE_PAGE_SIZE}&q=${encodeURIComponent(search)}&kind=${encodeURIComponent(kind)}&include_internal=${includeInternal}`,
  );
}

export async function fetchPamRoleDetail(objectId: number, includeInternal = true): Promise<PamRoleDetail> {
  return api<PamRoleDetail>(`/cmdb/pam-roles/${objectId}?include_internal=${includeInternal}`);
}
