import { groupSyncRunsByToolCycle, syncStatusLabel, syncToolLabel, type SyncRunForGrouping } from './sync-source.ts';

/* Notification summary: the latest sync cycle of each tool, as one short line
   (status and time). Object counts are left out on purpose: a cycle can include
   auxiliary runs that report 0 and read as "nothing synced". */

export type LatestToolCycle = {
  tool: string;
  label: string;
  statusLabel: string;
  tone: 'success' | 'warning' | 'running';
  at: string | null;
  detail: string;
};

function toneOf(status: string): LatestToolCycle['tone'] {
  if (status === 'completed') return 'success';
  return status === 'running' || status === 'queued' ? 'running' : 'warning';
}

export function latestCyclePerTool(runs: readonly SyncRunForGrouping[]): LatestToolCycle[] {
  const seen = new Set<string>();
  const cycles: LatestToolCycle[] = [];
  // Cycles come newest first, so the first one per tool is its latest.
  for (const group of groupSyncRunsByToolCycle(runs)) {
    const key = group.tool || 'other';
    if (seen.has(key)) continue;
    seen.add(key);
    const affected = group.affectedComponents.length;
    cycles.push({
      tool: key,
      label: syncToolLabel(group.tool),
      statusLabel: syncStatusLabel(group.status),
      tone: toneOf(group.status),
      at: group.latest_at,
      detail: affected ? `${affected} ${affected === 1 ? 'componente con aviso o fallo' : 'componentes con aviso o fallo'}` : '',
    });
  }
  return cycles;
}
