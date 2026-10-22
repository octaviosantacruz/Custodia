import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { errorDetailsFrom, type ErrorDetails } from '../../../cross/lib/error-details';
import { fetchNetskopeDeviceFacets, fetchNetskopeDevices, fetchNetskopeUsers, NETSKOPE_PAGE_SIZE } from '../lib/netskope-api';
import { EMPTY_NETSKOPE_DEVICE_QUERY, EMPTY_NETSKOPE_USERS_FILTERS, netskopeDevicesQuery, netskopeInventoryLocation } from '../lib/netskope-device-filters';
import { useDebouncedValue } from '../../../cross/hooks/use-debounced-value';
import type { NetskopeDeviceFilterKey, NetskopeDeviceQuery, NetskopeListResponse, NetskopeRow, NetskopeUsersFilters } from '../types/netskope';

type Options = { authChecked: boolean; authenticated: boolean; view: NetskopeView; refreshKey?: number; onUnauthorized: () => void; onError: (message: string) => void };
export type NetskopeView = 'metrics' | 'operations' | 'inventory' | 'users' | 'devices';

const LIST_VIEWS: readonly NetskopeView[] = ['users', 'devices'];

function queryError(error: unknown, fallback: string): { message: string; details: ErrorDetails | null } {
  if (!error) return { message: '', details: null };
  return {
    message: error instanceof Error ? error.message : fallback,
    details: errorDetailsFrom(error, fallback),
  };
}

/** Pages and facets live in the application cache; input state stays
 * local because it belongs to the operator interaction, not the resource. */
export function useNetskopeInventory({ authChecked, authenticated, view, refreshKey = 0, onUnauthorized, onError }: Options) {
  const [search, setSearch] = useState(() => view === 'devices' ? netskopeInventoryLocation(window.location.search, window.location.pathname).search : '');
  const [deviceQuery, setDeviceQuery] = useState<NetskopeDeviceQuery>(() => view === 'devices' ? netskopeInventoryLocation(window.location.search, window.location.pathname).query : EMPTY_NETSKOPE_DEVICE_QUERY);
  const [usersFilters, setUsersFilters] = useState<NetskopeUsersFilters>(EMPTY_NETSKOPE_USERS_FILTERS);
  const debouncedSearch = useDebouncedValue(search, 300);
  const previousView = useRef<NetskopeView>(view);
  const listEnabled = authChecked && authenticated && LIST_VIEWS.includes(view) && search === debouncedSearch;

  useEffect(() => {
    const restore = () => {
      if (!['/netskope/inventory', '/netskope/devices', '/netskope/chains'].includes(window.location.pathname)) return;
      const incoming = netskopeInventoryLocation(window.location.search, window.location.pathname);
      setSearch(incoming.search);
      setDeviceQuery(incoming.query);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (view !== 'devices') return;
    // On entry, history is authoritative when it contains saved criteria.
    // The shell's layout update may flush this effect before popstate reaches
    // our listener; never replace that incoming URL with the old view's state.
    if (previousView.current !== view && window.location.search) {
      const incoming = netskopeInventoryLocation(window.location.search, window.location.pathname);
      setSearch(incoming.search);
      setDeviceQuery(incoming.query);
      return;
    }
    const params = new URLSearchParams(netskopeDevicesQuery(search, 0, deviceQuery.filters, deviceQuery.eventAge, deviceQuery.change, deviceQuery.clientCompliance, deviceQuery.osCompliance, deviceQuery.duplicate, deviceQuery.freshness, deviceQuery.coverageRisk, deviceQuery));
    params.delete('limit'); params.delete('offset');
    if (!search) params.delete('q');
    const pathname = window.location.pathname === '/netskope/chains' ? '/netskope/inventory' : window.location.pathname;
    window.history.replaceState(window.history.state, '', `${pathname}${params.size ? `?${params}` : ''}${window.location.hash}`);
  }, [view, search, deviceQuery]);

  // A change between compatibility list routes clears the other route's
  // criteria. A drill comes from a non-list view, so its incoming filter
  // intentionally survives.
  useEffect(() => {
    const previous = previousView.current;
    previousView.current = view;
    if (!LIST_VIEWS.includes(previous) || previous === view || (view === 'devices' && window.location.search)) return;
    setSearch('');
    setDeviceQuery(EMPTY_NETSKOPE_DEVICE_QUERY);
    setUsersFilters(EMPTY_NETSKOPE_USERS_FILTERS);
  }, [view]);

  const list = useInfiniteQuery({
    queryKey: ['netskope', 'inventory', view, debouncedSearch, deviceQuery, usersFilters, refreshKey],
    enabled: listEnabled,
    // A filter change must verify the current inventory even if the operator
    // returns to a recently-used query key; cached pages remain visible while
    // that request is in flight.
    staleTime: 0,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => view === 'users'
      ? fetchNetskopeUsers(debouncedSearch, pageParam, usersFilters, signal)
      : fetchNetskopeDevices(debouncedSearch, pageParam, deviceQuery, signal),
    getNextPageParam: (lastPage: NetskopeListResponse, pages) => pages.length * NETSKOPE_PAGE_SIZE < lastPage.total ? pages.length : undefined,
  });
  const facets = useQuery({
    queryKey: ['netskope', 'device-facets', refreshKey],
    enabled: authChecked && authenticated && view === 'devices',
    queryFn: ({ signal }) => fetchNetskopeDeviceFacets(signal),
  });

  useEffect(() => {
    if (list.error instanceof ApiError && list.error.status === 401) onUnauthorized();
    else if (list.error) onError(queryError(list.error, 'No se pudo cargar Netskope').message);
  }, [list.error, onError, onUnauthorized]);

  const listError = queryError(list.error, 'No se pudo cargar Netskope');
  const pages = list.data?.pages ?? [];
  const rows: NetskopeRow[] = listEnabled ? pages.flatMap((page) => Array.isArray(page.rows) ? page.rows : []) : [];
  const total = listEnabled ? (pages.at(-1)?.total ?? 0) : 0;

  return {
    search,
    setSearch,
    deviceQuery,
    usersFilters,
    facets: facets.data ?? null,
    updateDeviceQuery: (patch: Partial<Omit<NetskopeDeviceQuery, 'filters'>>) => setDeviceQuery((current) => ({ ...current, ...patch })),
    setDeviceFilter: (key: NetskopeDeviceFilterKey, value: string) => setDeviceQuery((current) => ({ ...current, filters: { ...current.filters, [key]: value } })),
    applyDeviceQuery: (query: NetskopeDeviceQuery) => { setSearch(''); setDeviceQuery(query); },
    clearDeviceFilters: () => setDeviceQuery(EMPTY_NETSKOPE_DEVICE_QUERY),
    applyUsersFilters: (filters: NetskopeUsersFilters) => setUsersFilters(filters),
    updateUsersFilters: (patch: Partial<NetskopeUsersFilters>) => setUsersFilters((current) => ({ ...current, ...patch })),
    clearUsersFilters: () => setUsersFilters(EMPTY_NETSKOPE_USERS_FILTERS),
    loadMore: () => { void list.fetchNextPage(); },
    rows,
    total,
    sourceEvidence: listEnabled ? pages.at(-1)?.source_evidence ?? null : null,
    loading: list.isLoading || list.isFetching,
    loadError: listError.message,
    loadErrorInfo: listError.details,
    reload: async () => { await list.refetch(); },
  };
}
