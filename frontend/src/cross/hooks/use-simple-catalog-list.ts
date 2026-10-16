import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
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
  refreshKey: number;
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  resourceKey: string;
  fetcher: CatalogFetcher<T>;
  errorFallback: string;
  initialQuery?: string;
  pageSize?: number;
};

/** Shared React Query pagination for simple read-only catalog workspaces.
 * Every resource has an explicit key, so one catalog never invalidates another. */
export function useSimpleCatalogList<T>({
  refreshKey, authChecked, authenticated, onUnauthorized, onError, resourceKey, fetcher, errorFallback, initialQuery = '', pageSize = 100,
}: UseSimpleCatalogListOptions<T>) {
  const [search, setSearchState] = useState(initialQuery);
  const debouncedSearch = useDebouncedValue(search, 300);
  const enabled = authChecked && authenticated && search === debouncedSearch;
  const query = useInfiniteQuery({
    queryKey: ['catalog', resourceKey, debouncedSearch, pageSize, refreshKey],
    enabled,
    staleTime: 0,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetcher(debouncedSearch, pageSize, pageParam * pageSize, { signal }),
    getNextPageParam: (lastPage, pages) => pages.length * pageSize < lastPage.total ? pages.length : undefined,
  });
  useEffect(() => {
    if (!query.error) return;
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
    else onError(query.error instanceof Error ? query.error.message : errorFallback);
  }, [errorFallback, onError, onUnauthorized, query.error]);
  // These catalogs report failures through the App-level toast, so a load
  // start must clear the previous message: otherwise a successful retry stays
  // hidden behind a stale error. This matches the pre-React-Query behavior.
  useEffect(() => {
    if (query.isFetching) onError('');
  }, [onError, query.isFetching]);
  const pages = query.data?.pages ?? [];
  return {
    search,
    setSearch: setSearchState,
    rows: pages.flatMap((page) => Array.isArray(page.rows) ? page.rows : []),
    total: pages.at(-1)?.total ?? 0,
    loading: query.isLoading || query.isFetching,
    error: query.error instanceof Error ? query.error.message : query.error ? errorFallback : '',
    loadMore: () => { void query.fetchNextPage(); },
    retry: async () => { await query.refetch(); },
    pageSize,
  };
}
