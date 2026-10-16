import { api, download } from './api';
import type { ConnectionHistoryEvent, CoverageProgress, CoverageProgressResponse, StaleDestinationsResponse, UninventoriedAddressesResponse, WorkStatus, ConnectionDeviationFilter, ConnectionDeviations, PolicyCapability, SiaPolicyRow, ConnectionDestinationChanges, ConnectionDestinationValues, ConnectionCoverageFilter, ConnectionImportCounts, ConnectionImportPreview, ConnectionInventoryImportPayload, ConnectionInventoryResponse, ConnectionStatusFilter, ExecutiveAnalytics } from '../types/connection';

export function fetchConnectionInventory(search: string, page: number, includeInternal: boolean, environment = '', coverage: ConnectionCoverageFilter | '' = '', status: ConnectionStatusFilter = 'active', deviation: ConnectionDeviationFilter = '', workStatus: WorkStatus | '' = '', responsible = '', signal?: AbortSignal, limit = 50): Promise<ConnectionInventoryResponse> {
  const params = new URLSearchParams({ q: search, limit: String(limit), offset: String(page * limit), include_internal: String(includeInternal), environment, coverage, status, deviation, work_status: workStatus, responsible });
  return api<ConnectionInventoryResponse>(`/connection-inventory?${params}`, { signal });
}

export function fetchExecutiveAnalytics(includeInternal: boolean, signal?: AbortSignal): Promise<ExecutiveAnalytics> {
  return api<ExecutiveAnalytics>(`/analytics/executive?include_internal=${includeInternal}`, { signal });
}

export function previewConnectionImport(payload: ConnectionInventoryImportPayload): Promise<ConnectionImportPreview> {
  return api('/connection-inventory/import/preview', { method: 'POST', body: JSON.stringify(payload) });
}

export function exportConnectionInventory(): Promise<void> {
  return download('/connection-inventory/export.csv', 'dshub-destinos.csv');
}

export function importConnectionInventory(payload: ConnectionInventoryImportPayload): Promise<{ imported: boolean; import_id: string; row_count: number; mode: string; counts: ConnectionImportCounts }> {
  return api('/connection-inventory/import', { method: 'POST', body: JSON.stringify(payload) });
}

export function createConnectionDestination(values: ConnectionDestinationValues): Promise<{ inventory_id: number }> {
  return api('/connection-inventory', { method: 'POST', body: JSON.stringify(values) });
}

export function updateConnectionDestination(inventoryId: number, changes: ConnectionDestinationChanges): Promise<{ changed: number }> {
  return api(`/connection-inventory/${inventoryId}`, { method: 'PATCH', body: JSON.stringify(changes) });
}

export function bulkUpdateConnectionDestinations(inventoryIds: number[], changes: ConnectionDestinationChanges): Promise<{ changed: number }> {
  return api('/connection-inventory/bulk-update', { method: 'POST', body: JSON.stringify({ inventory_ids: inventoryIds, changes }) });
}

export function fetchConnectionDeviations(signal?: AbortSignal): Promise<ConnectionDeviations> {
  return api('/connection-inventory/deviations', { signal });
}

export async function fetchSiaPolicies(signal?: AbortSignal): Promise<SiaPolicyRow[]> {
  return (await api<{ rows: SiaPolicyRow[] }>('/connection-inventory/sia-policies', { signal })).rows;
}

export function saveSiaPolicyCapabilities(items: { policy_source_id: string; capability: PolicyCapability | null }[]): Promise<{ changed: number }> {
  return api('/connection-inventory/sia-policies', { method: 'PUT', body: JSON.stringify({ items }) });
}

export async function fetchConnectionHistory(inventoryId: number, signal?: AbortSignal): Promise<ConnectionHistoryEvent[]> {
  return (await api<{ rows: ConnectionHistoryEvent[] }>(`/connection-inventory/${inventoryId}/history`, { signal })).rows;
}

export function fetchCoverageProgress(signal?: AbortSignal): Promise<CoverageProgressResponse> {
  return api('/connection-inventory/progress', { signal });
}

export function takeCoverageSnapshot(): Promise<CoverageProgress> {
  return api('/connection-inventory/progress/snapshot', { method: 'POST', body: '{}' });
}

export function fetchStaleDestinations(days: number, signal?: AbortSignal): Promise<StaleDestinationsResponse> {
  return api(`/connection-inventory/stale?days=${days}`, { signal });
}

export function fetchUninventoriedAddresses(includeInternal: boolean, signal?: AbortSignal): Promise<UninventoriedAddressesResponse> {
  return api(`/connection-inventory/uninventoried?include_internal=${includeInternal}`, { signal });
}
