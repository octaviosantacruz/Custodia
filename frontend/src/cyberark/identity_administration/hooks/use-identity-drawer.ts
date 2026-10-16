import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchIdentityLayerFreshness, fetchIdentityRoleDetail, fetchIdentityUserDetail, fetchIdentityUserPamChain,
} from '../lib/identity-admin-api';

export type IdentityTarget = { kind: 'user' | 'role'; objectId: number; name: string };

/* Loads the single-source Identity Administration detail for a user or role.
   For a user it also loads the sanctioned PAM-chain bridge (roles -> Safes ->
   account counts of the PAM user with the same CyberArk Identity UUID); that
   fetch is independent so the identity section renders without waiting on it.
   No name/heuristic matching happens here — see integration-contracts.md. */
export function useIdentityDrawer() {
  const [target, setTarget] = useState<IdentityTarget | null>(null);

  const open = useCallback((next: IdentityTarget) => setTarget(next), []);
  const close = useCallback(() => setTarget(null), []);

  const userQuery = useQuery({
    queryKey: ['pam', 'identity-user-detail', target?.objectId],
    enabled: Boolean(target) && target?.kind === 'user',
    queryFn: ({ signal }) => fetchIdentityUserDetail(target!.objectId, signal),
  });
  const roleQuery = useQuery({
    queryKey: ['pam', 'identity-role-detail', target?.objectId],
    enabled: Boolean(target) && target?.kind === 'role',
    queryFn: ({ signal }) => fetchIdentityRoleDetail(target!.objectId, signal),
  });
  const pamChainQuery = useQuery({
    queryKey: ['pam', 'identity-user-pam-chain', target?.objectId],
    enabled: Boolean(target) && target?.kind === 'user',
    queryFn: ({ signal }) => fetchIdentityUserPamChain(target!.objectId, signal),
  });

  const freshnessQuery = useQuery({
    queryKey: ['pam', 'identity-layer-freshness'],
    enabled: Boolean(target),
    staleTime: 30_000,
    queryFn: ({ signal }) => fetchIdentityLayerFreshness(signal),
  });

  const activeQuery = target?.kind === 'role' ? roleQuery : userQuery;

  return {
    target,
    userDetail: userQuery.data ?? null,
    roleDetail: roleQuery.data ?? null,
    layerFreshness: freshnessQuery.data ?? [],
    pamChain: pamChainQuery.data ?? null,
    pamChainLoading: pamChainQuery.isLoading || pamChainQuery.isFetching,
    loading: activeQuery.isLoading || activeQuery.isFetching,
    error: activeQuery.error instanceof Error ? activeQuery.error.message : activeQuery.error ? 'No se pudo cargar el detalle de identidad' : '',
    open,
    close,
    reload: async () => { await activeQuery.refetch(); },
  };
}
