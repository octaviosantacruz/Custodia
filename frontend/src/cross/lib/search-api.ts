import { api } from './api';

export type SearchResult = {
  type: 'safe' | 'account' | 'pam_user' | 'pam_role' | 'sia_policy' | 'identity_user' | 'identity_role' | 'connection';
  label: string;
  detail: string;
  workspace: string;
  target: string | number;
  query: string;
};

export type InventorySearchResponse = {
  query: string;
  groups: Record<string, SearchResult[]>;
};

export function searchInventory(query: string, includeInternal = true): Promise<InventorySearchResponse> {
  const params = new URLSearchParams({ q: query, include_internal: String(includeInternal) });
  return api<InventorySearchResponse>(`/search?${params.toString()}`);
}
