import { useEffect } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { errorDetailsFrom, type ErrorDetails } from '../../../cross/lib/error-details';

type Options<T> = {
  cacheKey: QueryKey;
  enabled: boolean;
  refreshKey?: number;
  load: (signal: AbortSignal) => Promise<T>;
  onUnauthorized: () => void;
};

/** One loaded panel: the operations view lifts these to share data between the
 * priority summary and the panel that renders the detail. */
export type NetskopePanelState<T> = {
  data: T | null;
  loading: boolean;
  error: string;
  errorInfo: ErrorDetails | null;
  reload: () => Promise<void>;
};

/* React Query deduplicates identical panels, cancels obsolete requests through
   its signal and retains a successful panel while another panel refreshes. */
export function useNetskopePanel<T>({ cacheKey, enabled, refreshKey = 0, load, onUnauthorized }: Options<T>): NetskopePanelState<T> {
  const query = useQuery({
    queryKey: ['netskope', ...cacheKey, refreshKey],
    enabled,
    queryFn: ({ signal }) => load(signal),
  });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
  }, [onUnauthorized, query.error]);
  const error = query.error instanceof Error ? query.error.message : query.error ? 'No se pudo cargar este panel' : '';
  return {
    data: query.data ?? null,
    loading: query.isLoading || query.isFetching,
    error,
    errorInfo: query.error ? errorDetailsFrom(query.error, 'No se pudo cargar este panel') : null,
    reload: async () => { await query.refetch(); },
  };
}
