import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { fetchPamCleanupSignals } from '../lib/pam-technical-catalogs-api';
import { usePamRefreshKey } from '../../shared/refresh-context';
import { t } from '../../../cross/i18n/index.ts';

type UsePamCleanupSignalsOptions = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
};

export function usePamCleanupSignals({ authChecked, authenticated, onUnauthorized }: UsePamCleanupSignalsOptions) {
  const refreshKey = usePamRefreshKey();
  const query = useQuery({
    queryKey: ['pam', 'cleanup-signals', refreshKey],
    enabled: authChecked && authenticated,
    staleTime: 0,
    queryFn: ({ signal }) => fetchPamCleanupSignals({ signal }),
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
  }, [onUnauthorized, query.error]);

  return {
    data: query.data,
    loading: query.isLoading || query.isFetching,
    error: query.error instanceof Error
      ? query.error.message
      : query.error ? t('No se pudieron cargar las señales de limpieza PAM') : '',
  };
}
