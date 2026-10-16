import { useEffect, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { fetchIdentityRoles, fetchIdentityUserDetail, fetchIdentityUsers, type IdentityRoleKind, type IdentityRoleSort } from '../lib/identity-admin-api';
import { useDebouncedValue } from '../../../cross/hooks/use-debounced-value';
import { EMPTY_IDENTITY_USERS_CRITERIA, identityUsersCriteriaFromSearch, identityUsersQueryString } from '../lib/identity-users-url';
import type { IdentityRoleRef } from '../types/identity';
import { usePamRefreshKey } from '../../shared/refresh-context';

type UseIdentityAdminOptions = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialTab?: 'users' | 'roles';
  roleKind?: '' | 'role' | 'okta_group';
  initialQuery?: string;
  /** Restricts the role list to these object ids (member-match filter). */
  roleObjectIds?: number[] | null;
};

const initialCriteria = () => (typeof window === 'undefined' ? null : identityUsersCriteriaFromSearch(window.location.search));

export function useIdentityAdmin({ authChecked, authenticated, onUnauthorized, onError, initialTab = 'users', roleKind = '', initialQuery = '', roleObjectIds = null }: UseIdentityAdminOptions) {
  const refreshKey = usePamRefreshKey();
  const [tab, setTabState] = useState<'users' | 'roles'>(initialTab);
  // The URL is authoritative on entry when it carries criteria (reload or shared link); a navigation seed wins otherwise.
  const [entryCriteria] = useState(initialCriteria);
  const [search, setSearchState] = useState(initialQuery || entryCriteria?.search || '');
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | ''>(entryCriteria?.active ?? '');
  const [standardSeat, setStandardSeat] = useState<'' | 'reconciled' | 'unreconciled'>(entryCriteria?.standardSeat ?? '');
  const [kindFilter, setKindFilterState] = useState<IdentityRoleKind>('');
  const [roleSort, setRoleSortState] = useState<{ key: IdentityRoleSort; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });
  const [page, setPageState] = useState(0);
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [expandedRoles, setExpandedRoles] = useState<Set<number>>(new Set());
  const debouncedSearch = useDebouncedValue(search, 300);
  const enabled = authChecked && authenticated && search === debouncedSearch;

  const usersQuery = useQuery({
    queryKey: ['pam', 'identity-users', debouncedSearch, page, activeFilter, standardSeat, refreshKey],
    enabled: enabled && tab === 'users',
    queryFn: ({ signal }) => fetchIdentityUsers(debouncedSearch, page, activeFilter, standardSeat, signal),
  });
  const effectiveKind: IdentityRoleKind = roleKind || kindFilter;
  const rolesQuery = useQuery({
    queryKey: ['pam', 'identity-roles', debouncedSearch, page, effectiveKind, roleSort.key, roleSort.direction, roleObjectIds, refreshKey],
    enabled: enabled && tab === 'roles',
    queryFn: ({ signal }) => fetchIdentityRoles(debouncedSearch, page, effectiveKind, roleSort.key, roleSort.direction, roleObjectIds, signal),
  });
  const activeQuery = tab === 'users' ? usersQuery : rolesQuery;

  useEffect(() => {
    if (tab !== 'users') return;
    const query = identityUsersQueryString({ search, active: activeFilter, standardSeat });
    const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', next);
  }, [tab, search, activeFilter, standardSeat]);
  useEffect(() => {
    const restore = () => {
      const criteria = identityUsersCriteriaFromSearch(window.location.search) ?? EMPTY_IDENTITY_USERS_CRITERIA;
      setSearchState(criteria.search); setActiveFilter(criteria.active); setStandardSeat(criteria.standardSeat); setPageState(0);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (activeQuery.error instanceof ApiError && activeQuery.error.status === 401) { onUnauthorized(); return; }
    onError(activeQuery.error ? (activeQuery.error instanceof Error ? activeQuery.error.message : 'No se pudo cargar Identity Administration') : '');
  }, [activeQuery.error, onError, onUnauthorized]);

  const seededQuery = useRef(initialQuery);
  useEffect(() => {
    setTabState(initialTab);
    // A changed navigation seed replaces the search; on entry the state already came from the seed or the URL.
    if (seededQuery.current !== initialQuery) { seededQuery.current = initialQuery; setSearchState(initialQuery); }
    setPageState(0);
  }, [initialQuery, initialTab]);

  const expandedUserIds = [...expandedUsers];
  const userDetailQueries = useQueries({
    queries: expandedUserIds.map((objectId) => ({
      queryKey: ['pam', 'identity-user-detail', objectId],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchIdentityUserDetail(objectId, signal),
    })),
  });
  useEffect(() => {
    const authFailure = userDetailQueries.find((detail) => detail.error instanceof ApiError && detail.error.status === 401);
    if (authFailure) onUnauthorized();
  }, [userDetailQueries, onUnauthorized]);

  const rolesByUser: Record<number, IdentityRoleRef[]> = Object.fromEntries(
    expandedUserIds
      .map((objectId, index) => [objectId, userDetailQueries[index]?.data?.roles] as const)
      .filter((entry): entry is [number, IdentityRoleRef[]] => Boolean(entry[1])),
  );
  const expandLoading = new Set([
    ...expandedUserIds.filter((_, index) => userDetailQueries[index]?.isLoading || userDetailQueries[index]?.isFetching),
  ]);

  /** FE-AUD-001: a failed roles read is an error with retry, never "Sin roles asignados". */
  const rolesError = new Set(expandedUserIds.filter((_, index) => userDetailQueries[index]?.isError && !userDetailQueries[index]?.isFetching));
  const retryUserRoles = (objectId: number) => { void userDetailQueries[expandedUserIds.indexOf(objectId)]?.refetch(); };

  const toggleUserRoles = (objectId: number) => {
    setExpandedUsers((current) => {
      const next = new Set(current);
      if (next.has(objectId)) next.delete(objectId); else next.add(objectId);
      return next;
    });
  };
  const toggleRoleMembers = (objectId: number) => {
    setExpandedRoles((current) => {
      const next = new Set(current);
      if (next.has(objectId)) next.delete(objectId); else next.add(objectId);
      return next;
    });
  };

  return {
    tab, setTab: (next: 'users' | 'roles') => { setTabState(next); setPageState(0); },
    search, setSearch: (value: string) => { setSearchState(value); setPageState(0); },
    activeFilter, setActiveFilter: (value: 'active' | 'inactive' | '') => { setActiveFilter(value); setPageState(0); },
    standardSeat, setStandardSeat: (value: '' | 'reconciled' | 'unreconciled') => { setStandardSeat(value); setPageState(0); },
    kindFilter, setKindFilter: (value: IdentityRoleKind) => { setKindFilterState(value); setPageState(0); },
    roleSort,
    /** Same column toggles direction; a new column starts ascending (member counts start with the largest). */
    toggleRoleSort: (key: IdentityRoleSort) => {
      setRoleSortState((current) => current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'members' ? 'desc' : 'asc' });
      setPageState(0);
    },
    page, setPage: (nextPage: number) => { setPageState(nextPage); setExpandedUsers(new Set()); setExpandedRoles(new Set()); },
    loading: activeQuery.isLoading || activeQuery.isFetching,
    loadError: activeQuery.error instanceof Error ? activeQuery.error.message : activeQuery.error ? 'No se pudo cargar Identity Administration' : '',
    users: usersQuery.data?.rows ?? [], userTotal: usersQuery.data?.total ?? 0,
    roles: rolesQuery.data?.rows ?? [], roleTotal: rolesQuery.data?.total ?? 0,
    expandedUsers, rolesByUser, toggleUserRoles,
    expandedRoles, toggleRoleMembers,
    expandLoading, rolesError, retryUserRoles,
    reload: async () => { await activeQuery.refetch(); },
  };
}
