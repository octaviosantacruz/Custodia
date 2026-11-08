import type { DashboardShortcutId, DashboardWidget } from './dashboard-metrics.ts';

export type ShortcutPreview = Pick<DashboardWidget, 'value' | 'value_format' | 'data_status' | 'covered_count' | 'total_count' | 'total_accounts' | 'compliant_accounts' | 'measured_at' | 'buckets' | 'chart_data'>;

/** Evaluation fields a picker preview carries into a block added from it. The
 * coverage cards decide "No calculable" from covered_count/total_count, so
 * dropping them here made a freshly added card read as not calculable. */
export function toShortcutPreview(result: DashboardWidget): ShortcutPreview {
  return {
    value: result.value, value_format: result.value_format, data_status: result.data_status,
    covered_count: result.covered_count, total_count: result.total_count,
    total_accounts: result.total_accounts, compliant_accounts: result.compliant_accounts, measured_at: result.measured_at,
    buckets: result.buckets, chart_data: result.chart_data,
  };
}

/** The preview route caps a single call at 6 widgets of the same kind (the
 * same limit a saved view has), so the shortcut catalog -- 16 data
 * shortcuts, 10 chart shortcuts -- is split into sequential chunks. Kept in
 * its own dependency-free module (no api.ts/react) so it stays testable
 * under plain Node, unlike the hook that calls it. */
export function chunkShortcutIds(ids: readonly DashboardShortcutId[], size = 6): DashboardShortcutId[][] {
  const chunks: DashboardShortcutId[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}
