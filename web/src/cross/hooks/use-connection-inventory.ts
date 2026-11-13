import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../lib/api';
import { fetchConnectionDeviations, fetchConnectionInventory } from '../lib/connection-inventory-api';
import { useDebouncedValue } from './use-debounced-value';
import type { ConnectionCoverageFilter, ConnectionDeviationFilter, ConnectionStatusFilter, WorkStatus } from '../types/connection';
import { t } from '../i18n/index.ts';

export function useConnectionInventory({ refreshKey, authChecked, authenticated, includeInternal, initialSearch = '', initialEnvironment = '', initialCoverage = '', onUnauthorized, onError }: { refreshKey: number; authChecked: boolean; authenticated: boolean; includeInternal: boolean; initialSearch?: string; initialEnvironment?: string; initialCoverage?: ConnectionCoverageFilter | ''; onUnauthorized: () => void; onError: (message: string) => void }) {
  const [search, setSearchState] = useState(initialSearch);
  const [page, setPageState] = useState(0);
  const [environment, setEnvironmentState] = useState(initialEnvironment);
  const [coverage, setCoverageState] = useState<ConnectionCoverageFilter | ''>(initialCoverage);
  const [status, setStatusState] = useState<ConnectionStatusFilter>('active');
  const [deviation, setDeviationState] = useState<ConnectionDeviationFilter>('');
  const [workStatus, setWorkStatusState] = useState<WorkStatus | ''>('');
  const [responsible, setResponsibleState] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const enabled = authChecked && authenticated && search === debouncedSearch;

  const query = useQuery({
    queryKey: ['cross', 'connection-inventory', debouncedSearch, page, includeInternal, environment, coverage, status, deviation, workStatus, responsible, refreshKey],
    enabled,
    queryFn: ({ signal }) => fetchConnectionInventory(debouncedSearch, page, includeInternal, environment, coverage, status, deviation, workStatus, responsible, signal),
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) { onUnauthorized(); return; }
    onError(query.error ? (query.error instanceof Error ? query.error.message : t('No se pudieron cargar los activos y conexiones')) : '');
  }, [query.error, onError, onUnauthorized]);

  useEffect(() => {
    setSearchState(initialSearch);
    setEnvironmentState(initialEnvironment);
    setCoverageState(initialCoverage);
    setPageState(0);
  }, [initialCoverage, initialEnvironment, initialSearch]);

  return {
    search, setSearch: (value: string) => { setSearchState(value); setPageState(0); },
    environment, setEnvironment: (value: string) => { setEnvironmentState(value); setPageState(0); },
    coverage, setCoverage: (value: ConnectionCoverageFilter | '') => { setCoverageState(value); setPageState(0); },
    deviation, setDeviation: (value: ConnectionDeviationFilter) => { setDeviationState(value); setPageState(0); },
    workStatus, setWorkStatus: (value: WorkStatus | '') => { setWorkStatusState(value); setPageState(0); },
    responsible, setResponsible: (value: string) => { setResponsibleState(value); setPageState(0); },
    status, setStatus: (value: ConnectionStatusFilter) => { setStatusState(value); setPageState(0); },
    page, setPage: setPageState,
    filterArgs: { search: debouncedSearch, environment, coverage, status, deviation, workStatus, responsible, includeInternal },
    loading: query.isLoading || query.isFetching,
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    importInfo: query.data?.import ?? null,
    loadError: query.error instanceof Error ? query.error.message : query.error ? t('No se pudieron cargar los activos y conexiones') : '',
    reload: async () => { await query.refetch(); },
  };
}

/** Platform and DBA readings across the active destinations, and how many SIA policies are classified. */
export function useConnectionDeviations({ refreshKey, enabled }: { refreshKey: number; enabled: boolean }) {
  const query = useQuery({
    queryKey: ['cross', 'connection-deviations', refreshKey],
    enabled,
    queryFn: ({ signal }) => fetchConnectionDeviations(signal),
  });
  return { data: query.data ?? null, reload: async () => { await query.refetch(); } };
}
