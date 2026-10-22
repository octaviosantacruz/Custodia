import { useQueries } from '@tanstack/react-query';
import { previewDashboardWidgets } from '../lib/dashboard-preferences-api';
import { chunkShortcutIds, toShortcutPreview, type ShortcutPreview } from '../lib/dashboard-shortcut-batching';
import { createDashboardShortcut, DASHBOARD_SHORTCUTS, type DashboardShortcutId } from '../lib/dashboard-metrics';

export type { ShortcutPreview };

/** Fetches the real current value/buckets for every catalog shortcut of a
 * kind, in batches, so the widget picker can preview real data instead of a
 * placeholder shape -- mirroring how the Netskope picker already reads
 * metrics that are loaded on the page. Unlike Netskope, PAM shortcuts have
 * no equivalent already-loaded aggregate, so this fetches once per kind and
 * relies on the query cache for the session (cleared only if `includeInternal`
 * changes, since that's part of the query key). */
export function useDashboardShortcutPreviews(kind: 'data' | 'chart' | null, includeInternal: boolean) {
  const ids = kind
    ? DASHBOARD_SHORTCUTS.filter((shortcut) => (kind === 'chart' ? shortcut.kind === 'chart' : shortcut.kind !== 'chart')).map((shortcut) => shortcut.id)
    : [];
  const chunks = chunkShortcutIds(ids);

  const queries = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['pam', 'dashboard-shortcut-preview', kind, includeInternal, chunk],
      enabled: Boolean(kind),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const stubs = chunk.map((id, index) => createDashboardShortcut(id, index));
        const response = await previewDashboardWidgets(stubs, signal, includeInternal);
        return chunk.map((id, index) => [id, response.widgets[index]] as const);
      },
    })),
  });

  const previews: Partial<Record<DashboardShortcutId, ShortcutPreview>> = {};
  queries.forEach((query) => {
    query.data?.forEach(([id, result]) => {
      if (result) previews[id] = toShortcutPreview(result);
    });
  });

  return { previews, loading: queries.some((query) => query.isLoading || query.isFetching) };
}
