import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchPamUserChain, fetchPamUsers } from '../lib/pam-chain-api';
import { useDebouncedValue } from './use-debounced-value';
import type { PamUserChain, PamUserRow } from '../types/pam';

type UsePamChainOptions = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  includeInternal: boolean;
  enabled?: boolean;
  initialQuery?: string;
};

export function usePamChain({ authChecked, authenticated, onUnauthorized, onError, includeInternal, enabled = true, initialQuery = '' }: UsePamChainOptions) {
  const [search, setSearchState] = useState(initialQuery);
  const [standardSeat, setStandardSeat] = useState<'' | 'reconciled' | 'unreconciled'>('');
  const [status, setStatus] = useState<'' | 'suspended' | 'disabled'>('');
  const [page, setPage] = useState(0);
  const [users, setUsers] = useState<PamUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedUser, setSelectedUser] = useState<PamUserRow | null>(null);
  const [chain, setChain] = useState<PamUserChain | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState('');
  const chainRequest = useRef(0);
  const listRequest = useRef(0);
  const debouncedSearch = useDebouncedValue(search, 300);

  const load = useCallback(async () => {
    if (search !== debouncedSearch) return;
    const requestId = ++listRequest.current;
    setLoading(true);
    setLoadError('');
    onError('');
    try {
      const data = await fetchPamUsers(debouncedSearch, page, includeInternal, standardSeat, status);
      if (requestId !== listRequest.current) return;
      setUsers(Array.isArray(data.rows) ? data.rows : []);
      setTotal(data.total || 0);
    } catch (failure) {
      if (requestId !== listRequest.current) return;
      if (failure instanceof ApiError && failure.status === 401) {
        onUnauthorized();
        return;
      }
      setUsers([]);
      setTotal(0);
      setLoadError(failure instanceof Error ? failure.message : 'No se pudieron cargar los usuarios PAM');
    } finally {
      if (requestId === listRequest.current) setLoading(false);
    }
  }, [includeInternal, onError, onUnauthorized, page, search, debouncedSearch, standardSeat, status]);

  useEffect(() => {
    if (!enabled || !authChecked || !authenticated) return;
    void load();
  }, [authChecked, authenticated, enabled, load]);

  useEffect(() => {
    setSearchState(initialQuery);
    setPage(0);
  }, [initialQuery]);

  const selectUser = async (user: PamUserRow) => {
    const requestId = ++chainRequest.current;
    setSelectedUser(user);
    setChain(null);
    setChainError('');
    setChainLoading(true);
    try {
      const nextChain = await fetchPamUserChain(user.object_id, includeInternal);
      if (requestId === chainRequest.current) setChain(nextChain);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        onUnauthorized();
      } else {
        if (requestId === chainRequest.current) setChainError(failure instanceof Error ? failure.message : 'No se pudo cargar la cadena PAM');
      }
    } finally {
      if (requestId === chainRequest.current) setChainLoading(false);
    }
  };

  return {
    search,
    setSearch: (value: string) => { setSearchState(value); setPage(0); },
    standardSeat,
    setStandardSeat: (value: '' | 'reconciled' | 'unreconciled') => { setStandardSeat(value); setPage(0); },
    status,
    setStatus: (value: '' | 'suspended' | 'disabled') => { setStatus(value); setPage(0); },
    page,
    setPage,
    users,
    total,
    loading,
    loadError,
    reload: load,
    selectedUser,
    chain,
    chainLoading,
    chainError,
    selectUser,
  };
}
