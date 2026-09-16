import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchPamRoleDetail, fetchPamRoles } from '../lib/pam-roles-api';
import { useDebouncedValue } from './use-debounced-value';
import type { PamIdentityKind } from '../lib/pam-identity-classification';
import type { PamRoleDetail, PamRoleRow } from '../types/pam';

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
  const [search, setSearchState] = useState(initialQuery);
  const [kind, setKindState] = useState<PamIdentityKind | ''>(initialKind);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<PamRoleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [details, setDetails] = useState<Record<number, PamRoleDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Set<number>>(new Set());
  const [detailErrors, setDetailErrors] = useState<Record<number, string>>({});
  const debouncedSearch = useDebouncedValue(search, 300);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (search !== debouncedSearch) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError('');
    onError('');
    try {
      const data = await fetchPamRoles(debouncedSearch, page, kind, includeInternal);
      if (requestId !== requestIdRef.current) return;
      const nextRows = Array.isArray(data.rows) ? data.rows : [];
      setRoles((current) => {
        if (page === 0) return nextRows;
        const knownIds = new Set(current.map((role) => role.object_id));
        return [...current, ...nextRows.filter((role) => !knownIds.has(role.object_id))];
      });
      setTotal(data.total || 0);
    } catch (loadFailure) {
      if (requestId !== requestIdRef.current) return;
      if (loadFailure instanceof ApiError && loadFailure.status === 401) {
        onUnauthorized();
        return;
      }
      if (page === 0) setRoles([]);
      if (page === 0) setTotal(0);
      setLoadError(loadFailure instanceof Error ? loadFailure.message : 'No se pudieron cargar los roles PAM');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [includeInternal, initialKind, kind, onError, onUnauthorized, page, search, debouncedSearch]);

  useEffect(() => {
    if (!authChecked || !authenticated) return;
    void load();
  }, [authChecked, authenticated, load]);

  useEffect(() => {
    setSearchState(initialQuery);
    setPage(0);
    setRoles([]);
    setExpanded(new Set());
  }, [initialQuery]);

  const loadDetail = async (objectId: number) => {
    if (detailLoading.has(objectId)) return;
    setDetailLoading((current) => new Set(current).add(objectId));
    setDetailErrors((current) => { const next = { ...current }; delete next[objectId]; return next; });
    try {
      const detail = await fetchPamRoleDetail(objectId, includeInternal);
      setDetails((current) => ({ ...current, [objectId]: detail }));
    } catch (loadFailure) {
      if (loadFailure instanceof ApiError && loadFailure.status === 401) {
        onUnauthorized();
      } else {
        setDetailErrors((current) => ({ ...current, [objectId]: loadFailure instanceof Error ? loadFailure.message : 'No se pudo cargar el detalle del rol' }));
      }
    } finally {
      setDetailLoading((current) => { const next = new Set(current); next.delete(objectId); return next; });
    }
  };

  const toggleExpanded = async (objectId: number) => {
    if (expanded.has(objectId)) {
      setExpanded((current) => { const next = new Set(current); next.delete(objectId); return next; });
      return;
    }
    setExpanded((current) => new Set(current).add(objectId));
    if (initialKind === 'user') return;
    if (details[objectId] || detailLoading.has(objectId)) return;
    await loadDetail(objectId);
  };

  return {
    search, setSearch: (value: string) => { setSearchState(value); setPage(0); setRoles([]); },
    kind, setKind: (value: PamIdentityKind | '') => { setKindState(value); setPage(0); setRoles([]); },
    page, setPage, loading, roles, total, hasMore: roles.length < total, loadError,
    expanded, details, detailLoading, detailErrors, toggleExpanded, loadDetail, reload: load,
  };
}
