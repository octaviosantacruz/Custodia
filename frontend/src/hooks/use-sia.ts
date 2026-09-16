import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchSiaPolicies } from '../lib/sia-api';
import { useDebouncedValue } from './use-debounced-value';
import type { SiaPolicyRow } from '../types/sia';

type UseSiaOptions = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
};

export function useSia({ authChecked, authenticated, onUnauthorized, onError, initialQuery = '' }: UseSiaOptions) {
  const [search, setSearchState] = useState(initialQuery);
  const [statusFilter, setStatusFilterState] = useState('');
  const [linkageFilter, setLinkageFilterState] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState<SiaPolicyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const debouncedSearch = useDebouncedValue(search, 300);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    // search resets page synchronously; skip the transitional request that
    // would otherwise fire with the previous debounced term while the new
    // one is still settling.
    if (search !== debouncedSearch) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError('');
    onError('');
    try {
      const data = await fetchSiaPolicies(debouncedSearch, page, statusFilter, linkageFilter);
      if (requestId !== requestIdRef.current) return;
      setPolicies(Array.isArray(data.rows) ? data.rows : []);
      setTotal(data.total || 0);
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      if (loadError instanceof ApiError && loadError.status === 401) {
        onUnauthorized();
        return;
      }
      setPolicies([]);
      setTotal(0);
      setLoadError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las políticas de SIA');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [search, debouncedSearch, page, statusFilter, linkageFilter, onError, onUnauthorized]);

  useEffect(() => {
    if (!authChecked || !authenticated) return;
    void load();
  }, [authChecked, authenticated, load]);

  useEffect(() => {
    setSearchState(initialQuery);
    setPage(0);
  }, [initialQuery]);

  const toggleExpanded = (objectId: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(objectId)) next.delete(objectId); else next.add(objectId);
      return next;
    });
  };

  const changePage = (nextPage: number) => {
    setPage(nextPage);
    setExpanded(new Set());
  };

  return {
    search, setSearch: (value: string) => { setSearchState(value); setPage(0); },
    statusFilter, setStatusFilter: (value: string) => { setStatusFilterState(value); setPage(0); },
    linkageFilter, setLinkageFilter: (value: string) => { setLinkageFilterState(value); setPage(0); },
    page, setPage: changePage,
    loading, policies, total, loadError,
    expanded, toggleExpanded,
    reload: load,
  };
}
