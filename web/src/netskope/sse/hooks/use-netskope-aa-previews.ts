import { useQueries } from '@tanstack/react-query';
import { fetchNetskopeAaChart } from '../lib/netskope-api';
import { NETSKOPE_AA_PREFIX } from '../lib/netskope-dashboard';
import type { NetskopeMetricBucket } from '../types/netskope';

/** Real data for the Advanced Analytics tiles the picker currently shows. It shares the
 * chart cards' query key, so adding a block reuses what the preview already loaded, and
 * the server holds a five-minute cache per chart. */
export function useNetskopeAaPreviews(widgetIds: readonly string[], enabled: boolean, refreshKey = 0): Record<string, NetskopeMetricBucket[]> {
  const ids = widgetIds.filter((id) => id.startsWith(NETSKOPE_AA_PREFIX));
  const queries = useQueries({
    queries: ids.map((id) => {
      const key = id.slice(NETSKOPE_AA_PREFIX.length);
      return {
        queryKey: ['netskope', 'aa', 'chart', key, refreshKey],
        enabled,
        retry: false,
        queryFn: ({ signal }: { signal: AbortSignal }) => fetchNetskopeAaChart(key, signal),
      };
    }),
  });
  return Object.fromEntries(ids.flatMap((id, index) => {
    const buckets = queries[index]?.data?.buckets;
    return buckets ? [[id, buckets] as const] : [];
  }));
}
