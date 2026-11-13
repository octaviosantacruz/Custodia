import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchStaleDestinations } from '../lib/connection-inventory-api';
import { workLabel, workTone } from '../lib/connection-work';
import { dateTimeHint, formatDate, formatNumber } from '../lib/format';
import { CompactSelect } from './compact-select';
import { StatusBadge } from './semantic';
import { StateBlock } from './state-block';
import { t } from '../i18n/index.ts';

const DAY_OPTIONS = [7, 14, 30, 60].map((days) => ({ value: String(days), label: t('{days} días', { days: days }) }));

export function StaleDestinations({ refreshKey }: { refreshKey: number }) {
  const [days, setDays] = useState(14);
  const query = useQuery({ queryKey: ['cross', 'stale-destinations', days, refreshKey], queryFn: ({ signal }) => fetchStaleDestinations(days, signal) });
  const data = query.data;

  return <section className="list-panel database-surface progress-panel">
    <div className="progress-trend-head">
      <div>
        <h2>{t('Sin movimiento')}</h2>
        <p className="muted">{t('Destinos pendientes, en curso o bloqueados cuyo estado de trabajo no cambió en el plazo elegido. Si nunca se tocó, cuenta desde que entró al inventario.')}</p>
      </div>
      <CompactSelect ariaLabel={t('Plazo sin movimiento')} value={String(days)} onChange={(value) => setDays(Number(value))} options={DAY_OPTIONS} />
    </div>
    {query.isLoading && <StateBlock variant="loading" title={t('Buscando destinos sin movimiento…')} />}
    {query.error && <StateBlock variant="error" title={t('No se pudieron buscar los destinos sin movimiento')} hint={query.error instanceof Error ? query.error.message : undefined} action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>{t('Reintentar')}</button>} />}
    {data && data.total === 0 && <p className="muted progress-empty" role="status">{t('Ningún destino lleva más de {days} días sin movimiento.', { days: days })}</p>}
    {data && data.total > 0 && <>
      <p className="muted progress-since" role="status">{t('{total} {llevan} más de {days} días sin movimiento{rows}.', { total: formatNumber(data.total), llevan: data.total === 1 ? t('destino lleva') : t('destinos llevan'), days: days, rows: data.total > data.rows.length ? t('; se muestran los {rows} más antiguos', { rows: formatNumber(data.rows.length) }) : '' })}</p>
      <div className="compact-table-wrap"><table className="compact-table progress-table">
        <caption className="sr-only">{t('Destinos sin movimiento')}</caption>
        <thead><tr><th>{t('Destino')}</th><th>{t('Ambiente')}</th><th>{t('Estado')}</th><th>{t('Responsable')}</th><th>{t('Sin cambios')}</th></tr></thead>
        <tbody>
          {data.rows.map((row) => <tr key={row.inventory_id}>
            <td><strong>{row.instance_name}</strong><span className="table-subvalue">{row.private_ip}{row.port ? `:${row.port}` : ''}</span></td>
            <td>{row.environment || t('Sin ambiente')}</td>
            <td><StatusBadge tone={workTone(row.work_status)}>{workLabel(row.work_status)}</StatusBadge></td>
            <td>{row.responsible}</td>
            <td><strong>{t('{idle_days} días', { idle_days: formatNumber(row.idle_days) })}</strong><span className="table-subvalue"><time dateTime={row.idle_since} title={dateTimeHint(row.idle_since)}>{row.last_change ? t('Último cambio {idle_since}', { idle_since: formatDate(row.idle_since) }) : t('En el inventario desde {idle_since}', { idle_since: formatDate(row.idle_since) })}</time></span></td>
          </tr>)}
        </tbody>
      </table></div>
    </>}
  </section>;
}
