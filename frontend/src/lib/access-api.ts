import { api } from './api';
import type { AccessAssetListResponse } from '../types/access';

export function fetchAccessAssets(
  search: string,
  limit = 100,
  offset = 0,
  assetType = '',
  options?: RequestInit,
): Promise<AccessAssetListResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), q: search });
  if (assetType) params.set('asset_type', assetType);
  return api<AccessAssetListResponse>(`/cmdb/access-assets?${params.toString()}`, options);
}
