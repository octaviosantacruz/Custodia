import { api } from './api';
import type { IngestionRun, SyncStage, SyncStageHistoryRow, SyncTaskSchedule } from '../types/ingestion';

export const INGESTION_RUNS_QUERY_KEY = ['ingestion', 'runs', 50] as const;

export async function fetchIngestionRuns(limit = 12, signal?: AbortSignal): Promise<IngestionRun[]> {
  const data = await api<{ rows: IngestionRun[] }>(`/ingestion/runs?limit=${limit}`, { signal });
  return data.rows;
}

export async function fetchIngestionRun(runId: string): Promise<IngestionRun> {
  return api<IngestionRun>(`/ingestion/runs/${encodeURIComponent(runId)}`);
}

export async function fetchSyncStages(runId: string, signal?: AbortSignal): Promise<SyncStage[]> {
  const data = await api<{ rows: SyncStage[] }>(`/ingestion/runs/${encodeURIComponent(runId)}/stages`, { signal });
  return Array.isArray(data?.rows) ? data.rows : [];
}

export async function fetchSyncStageHistory(source: string, signal?: AbortSignal): Promise<SyncStageHistoryRow[]> {
  const data = await api<{ rows: SyncStageHistoryRow[] }>(`/ingestion/sources/${encodeURIComponent(source)}/stages/history`, { signal });
  return Array.isArray(data?.rows) ? data.rows : [];
}

export async function fetchSyncTaskSchedules(signal?: AbortSignal): Promise<SyncTaskSchedule[]> {
  const data = await api<{ rows: SyncTaskSchedule[] }>('/ingestion/schedules', { signal });
  return Array.isArray(data?.rows) ? data.rows : [];
}

export async function updateSyncTaskSchedule(taskKey: string, intervalMinutes: number | null): Promise<void> {
  await api(`/ingestion/schedules/${encodeURIComponent(taskKey)}`, {
    method: 'PUT', body: JSON.stringify({ interval_minutes: intervalMinutes }),
  });
}

export async function runSyncTask(taskKey: string): Promise<{ run_id: string; status: string }> {
  return api(`/ingestion/schedules/${encodeURIComponent(taskKey)}/runs`, { method: 'POST', body: '{}' });
}
