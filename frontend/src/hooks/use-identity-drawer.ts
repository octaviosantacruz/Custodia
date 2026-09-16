import { useCallback, useEffect, useState } from 'react';
import {
  fetchIdentityRoleDetail, fetchIdentityUserDetail, fetchIdentityUserPamChain,
} from '../lib/identity-admin-api';
import type { IdentityRoleDetail, IdentityUserDetail } from '../types/identity';
import type { IdentityPamChain } from '../types/pam';

export type IdentityTarget = { kind: 'user' | 'role'; objectId: number; name: string };

/* Loads the single-source Identity Administration detail for a user or role.
   For a user it also loads the sanctioned PAM-chain bridge (roles -> Safes ->
   account counts of the PAM user with the same CyberArk Identity UUID); that
   fetch is independent so the identity section renders without waiting on it.
   No name/heuristic matching happens here — see integration-contracts.md. */
export function useIdentityDrawer() {
  const [target, setTarget] = useState<IdentityTarget | null>(null);
  const [userDetail, setUserDetail] = useState<IdentityUserDetail | null>(null);
  const [roleDetail, setRoleDetail] = useState<IdentityRoleDetail | null>(null);
  const [pamChain, setPamChain] = useState<IdentityPamChain | null>(null);
  const [pamChainLoading, setPamChainLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const open = useCallback((next: IdentityTarget) => setTarget(next), []);
  const close = useCallback(() => setTarget(null), []);

  const load = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    setError('');
    setUserDetail(null);
    setRoleDetail(null);
    setPamChain(null);
    try {
      if (target.kind === 'user') {
        setUserDetail(await fetchIdentityUserDetail(target.objectId));
      } else {
        setRoleDetail(await fetchIdentityRoleDetail(target.objectId));
      }
    } catch (loadFailure) {
      setError(loadFailure instanceof Error ? loadFailure.message : 'No se pudo cargar el detalle de identidad');
    } finally {
      setLoading(false);
    }
  }, [target]);

  const loadPamChain = useCallback(async () => {
    if (!target || target.kind !== 'user') return;
    setPamChainLoading(true);
    try {
      setPamChain(await fetchIdentityUserPamChain(target.objectId));
    } catch {
      setPamChain(null);
    } finally {
      setPamChainLoading(false);
    }
  }, [target]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadPamChain(); }, [loadPamChain]);

  return { target, userDetail, roleDetail, pamChain, pamChainLoading, loading, error, open, close, reload: load };
}
