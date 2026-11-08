import { DateTime } from '../../../cross/components/date-time';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StateBlock } from '../../../cross/components/state-block';
import { LoadMore } from '../../../cross/components/load-more';
import { formatNumber } from '../../../cross/lib/format';
import { usePamRefreshKey } from '../../shared/refresh-context';
import { fetchRetiredSafes } from '../lib/retired-safes-api';
import { RETIRED_PAGE_SIZE, hasMoreRetired, nextRetiredLimit, retiredLimitNote } from '../lib/retired-safes';
import './retired-safes-list.css';
import { t } from '../../../cross/i18n/index.ts';

/**
 * Read-only list of Safes that stopped appearing after a complete sync run.
 * There are no bulk, delete or classification actions: the only request is a
 * GET to `/api/lifecycle/retired` and the backend always reports
 * `deletion_enabled: false`.
 */
export function RetiredSafesList() {
  const refreshKey = usePamRefreshKey();
  const [limit, setLimit] = useState(RETIRED_PAGE_SIZE);
  const query = useQuery({
    queryKey: ['pam', 'retired-safes', limit, refreshKey],
    queryFn: ({ signal }) => fetchRetiredSafes(limit, { signal }),
    staleTime: 0,
    /* Keep the already-loaded rows visible while a larger limit is fetched;
       "Cargar 50 más" must append, not blank the table. */
    placeholderData: (previous) => previous,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const capNote = retiredLimitNote(rows.length, total);

  return <section className="list-panel database-surface retired-safes-panel" aria-label={t('Safes retiradas')}>
    <header className="retired-safes-heading"><span className="retired-safes-kicker">{t('SOLO LECTURA')}</span></header>
    {query.isPending
      ? <StateBlock variant="loading" title={t('Cargando Safes retiradas…')} />
      : query.isError
        ? <StateBlock
            variant="error"
            title={t('No se pudieron cargar las Safes retiradas')}
            hint={query.error instanceof Error ? query.error.message : 'Reintentá la consulta.'}
            action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>{t('Reintentar')}</button>}
          />
        : rows.length === 0
          ? <StateBlock variant="empty" title={t('No hay Safes retiradas')} hint="Ninguna Safe dejó de aparecer en una corrida completa de sincronización." />
          : <>
            <div className="compact-table-wrap retired-safes-table-wrap">
              <table className="compact-table retired-safes-table">
                <caption className="sr-only">{t('Safes retiradas: nombre, fecha de retiro y miembros retirados')}</caption>
                <thead><tr>
                  <th scope="col">{t('Safe')}</th>
                  <th scope="col">{t('Fecha de retiro')}</th>
                  <th scope="col">{t('Miembros retirados')}</th>
                </tr></thead>
                <tbody>
                  {rows.map((row) => <tr key={row.safe_number}>
                    <td>
                      <span className="retired-safes-identity">
                        <strong>{row.safe_name}</strong>
                        <small>#{row.safe_number}{row.safe_url_id ? ` / ${row.safe_url_id}` : ''}</small>
                      </span>
                    </td>
                    <td>{row.retired_at ? <DateTime value={row.retired_at} /> : 'Sin dato'}</td>
                    <td>{formatNumber(row.retired_member_count)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {total > 0 ? (hasMoreRetired(rows.length, total)
              ? <LoadMore
                  loaded={rows.length}
                  total={total}
                  pageSize={RETIRED_PAGE_SIZE}
                  loading={query.isFetching}
                  onLoadMore={() => setLimit(nextRetiredLimit(rows.length, total))}
                />
              : <div className="load-more-footer" aria-live="polite">
                  <span>Mostrando {formatNumber(Math.min(rows.length, total))} de {formatNumber(total)}</span>
                </div>) : null}
            {capNote ? <p className="retired-safes-cap-note">{capNote}</p> : null}
          </>}
  </section>;
}
