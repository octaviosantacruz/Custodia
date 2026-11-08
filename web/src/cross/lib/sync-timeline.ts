import { syncToolLabel, type SyncRunGroup } from './sync-source.ts';

/* Per-tool strip of the latest sync cycles, oldest to newest. The status of a
   cycle is the one the grouped list already shows; nothing is recomputed. */

export const SYNC_TIMELINE_CYCLES = 24;

export type TimelineCell = { status: string; at: string | null };
export type TimelineRow = { tool: string; label: string; cells: TimelineCell[]; problems: number };

const PROBLEM_STATUSES = new Set(['failed', 'partial']);

export function buildSyncTimeline(
  groups: ReadonlyArray<Pick<SyncRunGroup<never>, 'tool' | 'status' | 'latest_at'>>,
  limit: number = SYNC_TIMELINE_CYCLES,
): TimelineRow[] {
  const byTool = new Map<string, TimelineCell[]>();
  // `groups` arrive newest first: keep the newest `limit` per tool, then flip.
  for (const group of groups) {
    const key = group.tool || 'other';
    const cells = byTool.get(key) ?? [];
    if (cells.length < limit) cells.push({ status: group.status, at: group.latest_at });
    byTool.set(key, cells);
  }
  return [...byTool.entries()].map(([tool, cells]) => ({
    tool,
    label: syncToolLabel(tool === 'other' ? null : tool as Parameters<typeof syncToolLabel>[0]),
    cells: [...cells].reverse(),
    problems: cells.filter((cell) => PROBLEM_STATUSES.has(cell.status)).length,
  }));
}
