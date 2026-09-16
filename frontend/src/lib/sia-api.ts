import { api } from './api';
import type { SiaPolicyDetail, SiaPolicyListResponse } from '../types/sia';

export const SIA_PAGE_SIZE = 50;

export async function fetchSiaPolicies(search: string, page: number, statusFilter: string, linkageFilter: string): Promise<SiaPolicyListResponse> {
  return api<SiaPolicyListResponse>(
    `/cmdb/sia-policies?limit=${SIA_PAGE_SIZE}&offset=${page * SIA_PAGE_SIZE}&q=${encodeURIComponent(search)}&status=${encodeURIComponent(statusFilter)}&linkage_status=${encodeURIComponent(linkageFilter)}`,
  );
}

export async function fetchSiaPolicyDetail(objectId: number): Promise<SiaPolicyDetail> {
  return api<SiaPolicyDetail>(`/cmdb/sia-policies/${objectId}`);
}
