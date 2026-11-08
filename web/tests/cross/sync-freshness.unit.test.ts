import assert from 'node:assert/strict';
import test from 'node:test';

import { staleTasksForSources, summarizeStageHistory } from '../../src/cross/lib/sync-freshness.ts';
import type { SyncStageHistoryRow, SyncTaskSchedule } from '../../src/cross/types/ingestion.ts';

function task(overrides: Partial<SyncTaskSchedule>): SyncTaskSchedule {
  return {
    task_key: 'netskope_dlp', source_system: 'netskope', source_file: 'netskope-api', configured: true, active: false,
    interval_minutes: 30, interval_source: 'environment_source', admin_override: null,
    last_success_at: '2026-10-04T10:00:00Z', last_attempt_at: null, last_status: 'completed', consecutive_failures: 0,
    freshness: 'stale', intervals_since_success: 5, stale_after_intervals: 3, next_scheduled_at: null, ...overrides,
  };
}

test('only stale, configured tasks of the workspace sources raise the banner', () => {
  const rows = [
    task({ task_key: 'a' }),
    task({ task_key: 'b', freshness: 'fresh' }),
    task({ task_key: 'c', freshness: 'unknown', last_success_at: null, intervals_since_success: null }),
    task({ task_key: 'd', configured: false }),
    task({ task_key: 'e', source_system: 'sia' }),
  ];
  assert.deepEqual(staleTasksForSources(rows, ['netskope']).map((row) => row.task_key), ['a']);
  assert.deepEqual(staleTasksForSources(rows, undefined), []);
  assert.deepEqual(staleTasksForSources(rows, ['access']), []);
});

test('stage history summarizes median duration and the latest row count of completed runs', () => {
  const row = (stage: string, status: 'completed' | 'failed', duration_ms: number, item_count: number | null): SyncStageHistoryRow =>
    ({ run_id: `${stage}${duration_ms}`, completed_at: '2026-10-04T10:00:00Z', stage, status, item_count, duration_ms });
  const summary = summarizeStageHistory([
    row('users', 'completed', 300, 83), row('users', 'failed', 9000, null), row('users', 'completed', 100, 80), row('users', 'completed', 200, 79),
    row('federations', 'failed', 50, null),
  ]);
  assert.deepEqual(summary.users, { runs: 4, failedRuns: 1, medianDurationMs: 200, lastItemCount: 83 });
  assert.deepEqual(summary.federations, { runs: 1, failedRuns: 1, medianDurationMs: 0, lastItemCount: null });
});
