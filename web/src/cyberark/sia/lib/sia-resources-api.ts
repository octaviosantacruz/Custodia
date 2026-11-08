import { api } from '../../../cross/lib/api';
import type {
  SiaConnectorListResponse, SiaDatabaseAccountListResponse, SiaResourceListResponse,
} from '../types/sia';

export function fetchSiaConnectors(search: string, limit = 100, offset = 0, options?: RequestInit): Promise<SiaConnectorListResponse> {
  return api<SiaConnectorListResponse>(`/cmdb/sia-connectors?limit=${limit}&offset=${offset}&q=${encodeURIComponent(search)}`, options);
}

export function fetchSiaResources(
  search: string,
  limit = 100,
  offset = 0,
  resourceType = '',
  options?: RequestInit,
): Promise<SiaResourceListResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), q: search });
  if (resourceType) params.set('resource_type', resourceType);
  return api<SiaResourceListResponse>(`/cmdb/sia-resources?${params.toString()}`, options);
}

export function fetchSiaDatabaseAccounts(search: string, limit = 100, offset = 0, options?: RequestInit): Promise<SiaDatabaseAccountListResponse> {
  return api<SiaDatabaseAccountListResponse>(`/cmdb/sia-database-accounts?limit=${limit}&offset=${offset}&q=${encodeURIComponent(search)}`, options);
}
