import { api } from './api';
import type { IngestionRun } from '../types/ingestion';
import type { AccessConcentration, InventoryFreshness } from '../types/dashboard';

export async function fetchIngestionRuns(limit = 12): Promise<IngestionRun[]> {
  const data = await api<{ rows: IngestionRun[] }>(`/ingestion/runs?limit=${limit}`);
  return data.rows;
}

export async function fetchAccessConcentration(limit = 10): Promise<AccessConcentration> {
  return api<AccessConcentration>(`/analytics/concentration?limit=${limit}`);
}

export async function fetchInventoryFreshness(): Promise<InventoryFreshness> {
  return api<InventoryFreshness>('/analytics/freshness');
}
