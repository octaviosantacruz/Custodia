import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { fetchSiaPolicies } from '../lib/sia-api';
import { useDebouncedValue } from '../../../cross/hooks/use-debounced-value';
import { usePamRefreshKey } from '../../shared/refresh-context';
import { t } from '../../../cross/i18n/index.ts';

type UseSiaOptions = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
};

export function useSia({ authChecked, authenticated, onUnauthorized, onError, initialQuery = '' }: UseSiaOptions) {
  const refreshKey = usePamRefreshKey();
  const [search, setSearchState] = useState(initialQuery);
  const [statusFilter, setStatusFilterState] = useState('');
  const [linkageFilter, setLinkageFilterState] = useState('');
  const [page, setPageState] = useState(0);
  const debouncedSearch = useDebouncedValue(search, 300);
  const enabled = authChecked && authenticated && search === debouncedSearch;

  const query = useQuery({
    queryKey: ['pam', 'sia-policies', debouncedSearch, page, statusFilter, linkageFilter, refreshKey],
    enabled,
    queryFn: ({ signal }) => fetchSiaPolicies(debouncedSearch, page, statusFilter, linkageFilter, signal),
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) { onUnauthorized(); return; }
    onError(query.error ? (query.error instanceof Error ? query.error.message : t('No se pudieron cargar las políticas de SIA')) : '');
  }, [query.error, onError, onUnauthorized]);

  useEffect(() => { setSearchState(initialQuery); setPageState(0); }, [initialQuery]);

  return {
    search, setSearch: (value: string) => { setSearchState(value); setPageState(0); },
    statusFilter, setStatusFilter: (value: string) => { setStatusFilterState(value); setPageState(0); },
    linkageFilter, setLinkageFilter: (value: string) => { setLinkageFilterState(value); setPageState(0); },
    page, setPage: setPageState,
    loading: query.isLoading || query.isFetching,
    policies: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    loadError: query.error instanceof Error ? query.error.message : query.error ? t('No se pudieron cargar las políticas de SIA') : '',
    reload: async () => { await query.refetch(); },
  };
}
