import { api } from './api';
import type { PamUserChain, PamUserListResponse } from '../types/pam';

export const PAM_USER_PAGE_SIZE = 50;

export function fetchPamUsers(
  search: string,
  page: number,
  includeInternal = true,
  standardSeat: '' | 'reconciled' | 'unreconciled' = '',
  status: '' | 'suspended' | 'disabled' = '',
): Promise<PamUserListResponse> {
  return api<PamUserListResponse>(
    `/cmdb/pam-users?limit=${PAM_USER_PAGE_SIZE}&offset=${page * PAM_USER_PAGE_SIZE}&q=${encodeURIComponent(search)}&include_internal=${includeInternal}&standard_seat=${standardSeat}&status=${status}`,
  );
}

export function fetchPamUserChain(objectId: number, includeInternal = true): Promise<PamUserChain> {
  return api<PamUserChain>(`/cmdb/pam-users/${objectId}/chain?include_internal=${includeInternal}`);
}
