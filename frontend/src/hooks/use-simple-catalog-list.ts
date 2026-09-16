import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { useDebouncedValue } from './use-debounced-value';

export type CatalogListResponse<T> = { rows: T[]; total: number };

export type CatalogFetcher<T> = (
  search: string,
  limit: number,
  offset: number,
  options: { signal: AbortSignal },
) => Promise<CatalogListResponse<T>>;

type UseSimpleCatalogListOptions<T> = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  fetcher: CatalogFetcher<T>;
  errorFallback: string;
  initialQuery?: string;
  pageSize?: number;
};

/* Shared data-fetching shape for the "simple catalog" workspaces (Access
   assets, SIA resources/database accounts, Identity federations, AIM
   applications): search + paginated rows + loading/error/401 handling,
   with the search term debounced so a request only fires once typing
   settles, not once per keystroke.

   `fetcher` must be a stable reference (a module-level export, or a
   useCallback in the caller) since it's a dependency of the fetch effect;
   every call site here passes a plain imported function, so this holds. */
export function useSimpleCatalogList<T>({
  authChecked, authenticated, onUnauthorized, onError, fetcher, errorFallback, initialQuery = '', pageSize = 100,
}: UseSimpleCatalogListOptions<T>) {
  const [search, setSearchState] = useState(initialQuery);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const debouncedSearch = useDebouncedValue(search, 300);
  // Belt-and-suspenders alongside the AbortController below: the signal
  // reliably cancels the underlying fetch, but this monotonic id (the same
  // pattern used in use-sia.ts/use-identity-admin.ts/use-pam-chain.ts/
  // use-pam-roles.ts/use-connection-inventory.ts) guards state updates
  // directly against any response that resolves after a newer request has
  // already started, regardless of whether a given fetcher actually honors
  // AbortSignal.
  const requestIdRef = useRef(0);

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPage(0);
  }, []);

  useEffect(() => {
    if (!authChecked || !authenticated) return;
    // setSearch resets page synchronously (so the UI reflects "back to page
    // 0" immediately), but that alone would re-run this effect once with
    // the *previous* debounced term before the debounce settles. Skip that
    // wasted intermediate request; the effect reruns for real once
    // debouncedSearch catches up to the actual search box value.
    if (search !== debouncedSearch) return;
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      if (page === 0) setError('');
      onError('');
      try {
        const response = await fetcher(debouncedSearch, pageSize, page * pageSize, { signal: controller.signal });
        if (requestId !== requestIdRef.current) return;
        const nextRows = Array.isArray(response.rows) ? response.rows : [];
        setRows((current) => (page === 0 ? nextRows : [...current, ...nextRows]));
        setTotal(response.total || 0);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (requestId !== requestIdRef.current) return;
        if (failure instanceof ApiError && failure.status === 401) onUnauthorized();
        else setError(failure instanceof Error ? failure.message : errorFallback);
      } finally {
        if (!controller.signal.aborted && requestId === requestIdRef.current) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, authenticated, onError, onUnauthorized, page, reloadTick, search, debouncedSearch, fetcher, pageSize, errorFallback]);

  const loadMore = useCallback(() => setPage((current) => current + 1), []);
  const retry = useCallback(() => setReloadTick((tick) => tick + 1), []);

  return { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize };
}
