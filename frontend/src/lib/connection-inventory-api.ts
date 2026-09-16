import { api } from './api';
import type { ConnectionCoverageFilter, ConnectionInventoryImportPayload, ConnectionInventoryResponse, ExecutiveAnalytics } from '../types/connection';

export function fetchConnectionInventory(search: string, page: number, includeInternal: boolean, environment = '', coverage: ConnectionCoverageFilter | '' = ''): Promise<ConnectionInventoryResponse> {
  const params = new URLSearchParams({ q: search, limit: '50', offset: String(page * 50), include_internal: String(includeInternal), environment, coverage });
  return api<ConnectionInventoryResponse>(`/connection-inventory?${params}`);
}

export function fetchExecutiveAnalytics(includeInternal: boolean): Promise<ExecutiveAnalytics> {
  return api<ExecutiveAnalytics>(`/analytics/executive?include_internal=${includeInternal}`);
}

export function importConnectionInventory(payload: ConnectionInventoryImportPayload): Promise<{ imported: boolean; import_id: string; row_count: number }> {
  return api('/connection-inventory/import', { method: 'POST', body: JSON.stringify(payload) });
}
