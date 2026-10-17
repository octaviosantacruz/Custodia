import { DateTime } from '../../../cross/components/date-time';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../cross/lib/api';
import { usePamRefreshKey } from '../../shared/refresh-context';
import type { Account } from '../types/safe';

/** Accounts a complete sync no longer saw. CyberArk may keep them through the Safe's retention, which
 *  is what blocks deleting the Safe. The date is when Custodia detected it, not when it was deleted. */
export function RetiredAccountsSection({ safeNumber }: { safeNumber: number }) {
  const refreshKey = usePamRefreshKey();
  const query = useQuery({
    queryKey: ['pam', 'safe-retired-accounts', safeNumber, refreshKey],
    queryFn: ({ signal }) => api<{ rows: Account[]; total: number }>(`/safes/${safeNumber}/accounts?lifecycle=retired&limit=200`, { signal }),
    staleTime: 0,
  });
  if (query.isPending || query.isError || !query.data?.rows.length) return null;
  const { rows, total } = query.data;
  return <section className="retired-accounts" aria-label="Cuentas retiradas de la Safe">
    <h4>Retiradas, posible retención de CyberArk <span className="muted">({total})</span></h4>
    <div className="account-inline-list">
      <div className="account-inline-row account-inline-header retired-accounts-row" aria-hidden="true"><span>Nombre</span><span>Cuenta</span><span>Plataforma</span><span>Detectada</span></div>
      {rows.map((account) => <div className="account-inline-row retired-accounts-row" key={account.account_id}>
        <strong>{account.account_name}</strong>
        <span>{account.user_name || 'Sin usuario'}</span>
        <span>{account.platform_name || account.platform_id || 'Sin plataforma'}</span>
        <span><DateTime value={account.retired_detected_at ?? null} /></span>
      </div>)}
    </div>
  </section>;
}
