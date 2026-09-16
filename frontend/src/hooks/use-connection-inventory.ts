import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchConnectionInventory } from '../lib/connection-inventory-api';
import { useDebouncedValue } from './use-debounced-value';
import type { ConnectionCoverageFilter, ConnectionInventoryRow } from '../types/connection';

export function useConnectionInventory({ authChecked, authenticated, includeInternal, initialSearch = '', initialEnvironment = '', initialCoverage = '', onUnauthorized, onError }: { authChecked: boolean; authenticated: boolean; includeInternal: boolean; initialSearch?: string; initialEnvironment?: string; initialCoverage?: ConnectionCoverageFilter | ''; onUnauthorized: () => void; onError: (message: string) => void }) {
  const [search, setSearchState] = useState(initialSearch);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ConnectionInventoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [importInfo, setImportInfo] = useState<ConnectionInventoryRow['import'] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [environment, setEnvironmentState] = useState(initialEnvironment);
  const [coverage, setCoverageState] = useState<ConnectionCoverageFilter | ''>(initialCoverage);
  const debouncedSearch = useDebouncedValue(search, 300);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (search !== debouncedSearch) return;
    const requestId = ++requestIdRef.current;
    setLoading(true); setLoadError(''); onError('');
    try {
      const data = await fetchConnectionInventory(debouncedSearch, page, includeInternal, environment, coverage);
      if (requestId !== requestIdRef.current) return;
      setRows(Array.isArray(data.rows) ? data.rows : []); setTotal(data.total || 0); setImportInfo(data.import || null);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      if (error instanceof ApiError && error.status === 401) { onUnauthorized(); return; }
      setRows([]); setTotal(0); setImportInfo(null); setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los activos y conexiones');
    } finally { if (requestId === requestIdRef.current) setLoading(false); }
  }, [coverage, environment, includeInternal, onError, onUnauthorized, page, search, debouncedSearch]);

  useEffect(() => { if (authChecked && authenticated) void load(); }, [authChecked, authenticated, load]);
  useEffect(() => {
    setSearchState(initialSearch);
    setEnvironmentState(initialEnvironment);
    setCoverageState(initialCoverage);
    setPage(0);
  }, [initialCoverage, initialEnvironment, initialSearch]);

  return {
    search, setSearch: (value: string) => { setSearchState(value); setPage(0); },
    environment, setEnvironment: (value: string) => { setEnvironmentState(value); setPage(0); },
    coverage, setCoverage: (value: ConnectionCoverageFilter | '') => { setCoverageState(value); setPage(0); },
    page, setPage, loading, rows, total, importInfo, loadError, reload: load,
  };
}
