import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../lib/api';
import { fetchExecutiveAnalytics } from '../lib/connection-inventory-api';
import { t } from '../i18n/index.ts';

export function useExecutiveAnalytics({ refreshKey, includeInternal, onUnauthorized }: { refreshKey: number; includeInternal: boolean; onUnauthorized: () => void }) {
  const query = useQuery({
    queryKey: ['cross', 'executive-analytics', includeInternal, refreshKey],
    queryFn: ({ signal }) => fetchExecutiveAnalytics(includeInternal, signal),
  });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
  }, [onUnauthorized, query.error]);
  return {
    data: query.data ?? null,
    loading: query.isLoading || query.isFetching,
    error: query.error instanceof Error ? query.error.message : query.error ? t('No se pudo cargar la lectura ejecutiva') : '',
    reload: async () => { await query.refetch(); },
  };
}
