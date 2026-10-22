import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { fetchUninventoriedAddresses } from '../lib/connection-inventory-api';
import { formatNumber } from '../lib/format';
import { StateBlock } from './state-block';

type Props = { includeInternal: boolean; canManage: boolean; refreshKey: number; onAdd: (address: string) => void };

export const UNINVENTORIED_QUERY_KEY = ['cross', 'uninventoried-addresses'] as const;

export function UninventoriedAddresses({ includeInternal, canManage, refreshKey, onAdd }: Props) {
  const query = useQuery({ queryKey: [...UNINVENTORIED_QUERY_KEY, includeInternal, refreshKey], queryFn: ({ signal }) => fetchUninventoriedAddresses(includeInternal, signal) });
  const data = query.data;

  if (query.isLoading) return <StateBlock variant="loading" title="Buscando direcciones sin inventariar…" />;
  if (query.error || !data) return <StateBlock variant="error" title="No se pudieron buscar las direcciones sin inventariar" hint={query.error instanceof Error ? query.error.message : undefined} action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>Reintentar</button>} />;

  return <section className="list-panel database-surface progress-panel">
    <div className="progress-trend-head">
      <div>
        <h2>Sin inventariar</h2>
        <p className="muted">Direcciones IPv4 que una cuenta de PAM o una política de SIA nombran y que ningún destino del inventario tiene. La comparación es exacta: no se listan hostnames ni rangos, y un destino retirado conserva su IP.</p>
      </div>
    </div>
    {data.total === 0
      ? <p className="muted progress-empty" role="status">Todas las direcciones observadas en PAM y SIA están en el inventario.</p>
      : <>
        <p className="muted progress-since" role="status">{formatNumber(data.total)} {data.total === 1 ? 'dirección' : 'direcciones'} sin inventariar{data.total > data.rows.length ? `; se muestran las primeras ${formatNumber(data.rows.length)}` : ''}. Las vistas en PAM y SIA a la vez van primero.</p>
        <div className="compact-table-wrap"><table className="compact-table progress-table">
          <caption className="sr-only">Direcciones sin inventariar</caption>
          <thead><tr><th>Dirección</th><th>Cuentas en PAM</th><th>Políticas en SIA</th>{canManage && <th><span className="sr-only">Acciones</span></th>}</tr></thead>
          <tbody>
            {data.rows.map((row) => <tr key={row.address}>
              <td><strong className="mono">{row.address}</strong></td>
              <td>{row.pam_accounts ? <><strong>{formatNumber(row.pam_accounts)}</strong><span className="table-subvalue">{formatNumber(row.pam_safes)} {row.pam_safes === 1 ? 'Safe' : 'Safes'}</span></> : <span className="muted">No aparece</span>}</td>
              <td>{row.sia_policies ? <><strong>{formatNumber(row.sia_policies)}</strong><span className="table-subvalue">{row.sia_policy_names.join(', ')}{row.sia_policies > row.sia_policy_names.length ? '…' : ''}</span></> : <span className="muted">No aparece</span>}</td>
              {canManage && <td><button type="button" className="button subtle" aria-label={`Dar de alta ${row.address}`} onClick={() => onAdd(row.address)}><Plus size={14} aria-hidden /> Dar de alta</button></td>}
            </tr>)}
          </tbody>
        </table></div>
      </>}
  </section>;
}
