import type { SyncStageHistoryRow, SyncTaskSchedule } from '../types/ingestion';

/** Tasks of the given sources that the backend reports as stale. SYNC-OBS-001:
 *  only recorded evidence counts. A task with no run history, disabled or not
 *  configured is `unknown` and never produces a banner (nor a "fresh" claim). */
export function staleTasksForSources(rows: readonly SyncTaskSchedule[], sources: readonly string[] | undefined): SyncTaskSchedule[] {
  if (!sources?.length) return [];
  return rows.filter((row) => row.configured && row.freshness === 'stale' && sources.includes(row.source_system));
}

export type StageHistorySummary = { runs: number; failedRuns: number; medianDurationMs: number; lastItemCount: number | null };

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Per-layer summary of the recent runs (rows arrive newest first). Duration
 *  uses completed runs only; a failed layer has no meaningful duration or rows. */
export function summarizeStageHistory(rows: readonly SyncStageHistoryRow[]): Record<string, StageHistorySummary> {
  const byStage: Record<string, SyncStageHistoryRow[]> = {};
  for (const row of rows) (byStage[row.stage] ||= []).push(row);
  return Object.fromEntries(Object.entries(byStage).map(([stage, items]) => {
    const completed = items.filter((item) => item.status === 'completed');
    return [stage, {
      runs: items.length,
      failedRuns: items.length - completed.length,
      medianDurationMs: completed.length ? median(completed.map((item) => item.duration_ms)) : 0,
      lastItemCount: completed.length ? completed[0].item_count : null,
    }];
  }));
}
