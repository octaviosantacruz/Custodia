import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchIdentityRoleDetail, fetchIdentityRoles, fetchIdentityUserDetail, fetchIdentityUsers } from '../lib/identity-admin-api';
import { useDebouncedValue } from './use-debounced-value';
import type { IdentityRoleRow, IdentityUserRef, IdentityUserRow, IdentityRoleRef } from '../types/identity';

type UseIdentityAdminOptions = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialTab?: 'users' | 'roles';
  roleKind?: '' | 'role' | 'okta_group';
  initialQuery?: string;
};

export function useIdentityAdmin({ authChecked, authenticated, onUnauthorized, onError, initialTab = 'users', roleKind = '', initialQuery = '' }: UseIdentityAdminOptions) {
  const [tab, setTab] = useState<'users' | 'roles'>(initialTab);
  const [search, setSearch] = useState(initialQuery);
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | ''>('');
  const [standardSeat, setStandardSeat] = useState<'' | 'reconciled' | 'unreconciled'>('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const [users, setUsers] = useState<IdentityUserRow[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [roles, setRoles] = useState<IdentityRoleRow[]>([]);
  const [roleTotal, setRoleTotal] = useState(0);
  const [loadError, setLoadError] = useState('');

  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [rolesByUser, setRolesByUser] = useState<Record<number, IdentityRoleRef[]>>({});
  const [expandedRoles, setExpandedRoles] = useState<Set<number>>(new Set());
  const [membersByRole, setMembersByRole] = useState<Record<number, IdentityUserRef[]>>({});
  const [expandLoading, setExpandLoading] = useState<Set<number>>(new Set());
  const debouncedSearch = useDebouncedValue(search, 300);
  const requestIdRef = useRef(0);

  const handleError = useCallback((loadError: unknown, fallback: string) => {
    if (loadError instanceof ApiError && loadError.status === 401) {
      onUnauthorized();
      return;
    }
    onError(loadError instanceof Error ? loadError.message : fallback);
  }, [onError, onUnauthorized]);

  const load = useCallback(async () => {
    if (search !== debouncedSearch) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError('');
    onError('');
    try {
      if (tab === 'users') {
        const data = await fetchIdentityUsers(debouncedSearch, page, activeFilter, standardSeat);
        if (requestId !== requestIdRef.current) return;
        setUsers(Array.isArray(data.rows) ? data.rows : []);
        setUserTotal(data.total || 0);
      } else {
        const data = await fetchIdentityRoles(debouncedSearch, page, roleKind);
        if (requestId !== requestIdRef.current) return;
        setRoles(Array.isArray(data.rows) ? data.rows : []);
        setRoleTotal(data.total || 0);
      }
    } catch (loadFailure) {
      if (requestId !== requestIdRef.current) return;
      if (loadFailure instanceof ApiError && loadFailure.status === 401) {
        onUnauthorized();
        return;
      }
      if (tab === 'users') { setUsers([]); setUserTotal(0); } else { setRoles([]); setRoleTotal(0); }
      setLoadError(loadFailure instanceof Error ? loadFailure.message : 'No se pudo cargar Identity Administration');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [tab, search, debouncedSearch, page, activeFilter, standardSeat, roleKind, onError, onUnauthorized]);

  useEffect(() => {
    if (!authChecked || !authenticated) return;
    void load();
  }, [authChecked, authenticated, load]);

  useEffect(() => {
    setTab(initialTab);
    setSearch(initialQuery);
    setPage(0);
  }, [initialQuery, initialTab]);

  const toggleUserRoles = async (objectId: number) => {
    if (expandedUsers.has(objectId)) {
      setExpandedUsers((current) => { const next = new Set(current); next.delete(objectId); return next; });
      return;
    }
    setExpandedUsers((current) => new Set(current).add(objectId));
    if (rolesByUser[objectId]) return;
    setExpandLoading((current) => new Set(current).add(objectId));
    try {
      const detail = await fetchIdentityUserDetail(objectId);
      setRolesByUser((current) => ({ ...current, [objectId]: detail.roles }));
    } catch (loadError) {
      handleError(loadError, 'No se pudieron cargar los roles del usuario');
    } finally {
      setExpandLoading((current) => { const next = new Set(current); next.delete(objectId); return next; });
    }
  };

  const toggleRoleMembers = async (objectId: number) => {
    if (expandedRoles.has(objectId)) {
      setExpandedRoles((current) => { const next = new Set(current); next.delete(objectId); return next; });
      return;
    }
    setExpandedRoles((current) => new Set(current).add(objectId));
    if (membersByRole[objectId]) return;
    setExpandLoading((current) => new Set(current).add(objectId));
    try {
      const detail = await fetchIdentityRoleDetail(objectId);
      setMembersByRole((current) => ({ ...current, [objectId]: detail.members }));
    } catch (loadError) {
      handleError(loadError, 'No se pudieron cargar los miembros del rol');
    } finally {
      setExpandLoading((current) => { const next = new Set(current); next.delete(objectId); return next; });
    }
  };

  return {
    tab, setTab: (next: 'users' | 'roles') => { setTab(next); setPage(0); },
    search, setSearch: (value: string) => { setSearch(value); setPage(0); },
    activeFilter, setActiveFilter: (value: 'active' | 'inactive' | '') => { setActiveFilter(value); setPage(0); },
    standardSeat, setStandardSeat: (value: '' | 'reconciled' | 'unreconciled') => { setStandardSeat(value); setPage(0); },
    page, setPage: (nextPage: number) => { setPage(nextPage); setExpandedUsers(new Set()); setExpandedRoles(new Set()); },
    loading, loadError,
    users, userTotal,
    roles, roleTotal,
    expandedUsers, rolesByUser, toggleUserRoles,
    expandedRoles, membersByRole, toggleRoleMembers,
    expandLoading,
    reload: load,
  };
}
