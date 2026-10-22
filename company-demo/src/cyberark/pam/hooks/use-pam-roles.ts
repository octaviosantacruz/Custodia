import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { fetchPamRoleDetail, fetchPamRoles } from '../lib/pam-roles-api';
import { useDebouncedValue } from '../../../cross/hooks/use-debounced-value';
import { usePamRefreshKey } from '../../shared/refresh-context';
import { roleDetailEnabled, type PamIdentityKind } from '../lib/pam-identity-classification';
import type { PamRoleDetail } from '../types/pam';

const PAGE_SIZE = 50;

type UsePamRolesOptions = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  includeInternal?: boolean;
  initialKind?: PamIdentityKind | '';
  initialQuery?: string;
};

export function usePamRoles({ authChecked, authenticated, onUnauthorized, onError, includeInternal = true, initialKind = '', initialQuery = '' }: UsePamRolesOptions) {
  const refreshKey = usePamRefreshKey();
  const [search, setSearchState] = useState(initialQuery);
  const [kind, setKindState] = useState<PamIdentityKind | ''>(initialKind);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const debouncedSearch = useDebouncedValue(search, 300);
  const enabled = authChecked && authenticated && search === debouncedSearch;

  const query = useInfiniteQuery({
    queryKey: ['pam', 'roles', debouncedSearch, kind, includeInternal, refreshKey],
    enabled,
    staleTime: 0,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchPamRoles(debouncedSearch, pageParam, kind, includeInternal, signal),
    getNextPageParam: (lastPage, pages) => pages.length * PAGE_SIZE < (lastPage.total || 0) ? pages.length : undefined,
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) { onUnauthorized(); return; }
    onError(query.error ? (query.error instanceof Error ? query.error.message : 'No se pudieron cargar los roles PAM') : '');
  }, [query.error, onError, onUnauthorized]);

  useEffect(() => { setExpanded(new Set()); }, [initialQuery]);

  const pages = query.data?.pages ?? [];
  const roles = pages.flatMap((page) => Array.isArray(page.rows) ? page.rows : []);
  const total = pages.at(-1)?.total ?? 0;
  const page = Math.max(pages.length - 1, 0);

  const expandedIds = [...expanded];
  const detailQueries = useQueries({
    queries: expandedIds.map((objectId) => ({
      queryKey: ['pam', 'role-detail', objectId, includeInternal],
      enabled: roleDetailEnabled(kind),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchPamRoleDetail(objectId, includeInternal, signal),
    })),
  });
  useEffect(() => {
    const authFailure = detailQueries.find((detail) => detail.error instanceof ApiError && detail.error.status === 401);
    if (authFailure) onUnauthorized();
  }, [detailQueries, onUnauthorized]);

  const details: Record<number, PamRoleDetail> = Object.fromEntries(
    expandedIds
      .map((objectId, index) => [objectId, detailQueries[index]?.data] as const)
      .filter((entry): entry is [number, PamRoleDetail] => Boolean(entry[1])),
  );
  const detailLoading = new Set(expandedIds.filter((_, index) => detailQueries[index]?.isLoading || detailQueries[index]?.isFetching));
  const detailErrors: Record<number, string> = Object.fromEntries(
    expandedIds
      .map((objectId, index) => [objectId, detailQueries[index]?.error] as const)
      .filter((entry): entry is [number, Error] => Boolean(entry[1]))
      .map(([objectId, error]) => [objectId, error instanceof Error ? error.message : 'No se pudo cargar el detalle del rol']),
  );

  const toggleExpanded = (objectId: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(objectId)) next.delete(objectId); else next.add(objectId);
      return next;
    });
  };

  return {
    search, setSearch: (value: string) => setSearchState(value),
    kind, setKind: (value: PamIdentityKind | '') => setKindState(value),
    page,
    setPage: (updater: number | ((current: number) => number)) => {
      const next = typeof updater === 'function' ? updater(page) : updater;
      if (next > page) void query.fetchNextPage();
    },
    loading: query.isLoading || query.isFetching,
    roles, total, hasMore: roles.length < total,
    loadError: query.error instanceof Error ? query.error.message : query.error ? 'No se pudieron cargar los roles PAM' : '',
    expanded, details, detailLoading, detailErrors, toggleExpanded,
    loadDetail: toggleExpanded,
    reload: async () => { await query.refetch(); },
  };
}
