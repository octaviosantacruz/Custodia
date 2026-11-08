import { useEffect, useState } from 'react';
import { CircleAlert, Server, Search } from 'lucide-react';
import { ApiError } from '../lib/api';
import { listOperationalErrors, type OperationalErrorEntry } from '../lib/operational-errors-api';
import { dateTimeHint, formatDate, formatNumber } from '../lib/format';
import { StateBlock } from './state-block';
import { TablePagination } from './table-pagination';
import { HelpHint } from './help-hint';
import { PageVolumeHistogram } from './page-volume-histogram';
import './activity-table.css';
import { t } from '../i18n/index.ts';

export function OperationalErrorsView({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const [rows, setRows] = useState<OperationalErrorEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [requestReady, setRequestReady] = useState(false);
  const pageSize = 50;
  const startQuery = (update: () => void) => { setRows([]); setTotal(0); setLoading(true); setError(''); update(); };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setRequestReady(false);
    void listOperationalErrors(page, pageSize, q).then((result) => {
      if (!cancelled) { setRows(result.rows); setTotal(result.total); setRequestReady(true); }
    }).catch((caught) => {
      if (caught instanceof ApiError && caught.status === 401) { if (!cancelled) onUnauthorized?.(); return; }
      if (!cancelled) { setRows([]); setTotal(0); setError(caught instanceof Error ? caught.message : 'No se pudieron cargar los errores'); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onUnauthorized is only called on a 401; its identity must not refetch the page
  }, [page, q, reloadKey]);

  return <section className="activity-panel operational-errors-panel">
    <div className="activity-toolbar"><label className="search-box"><Search size={16} aria-hidden="true" /><input type="search" aria-label={t('Buscar errores por referencia, ruta o tipo')} value={q} onChange={(event) => startQuery(() => { setQ(event.target.value); setPage(0); })} placeholder={t('Referencia, ruta o tipo')} /></label></div>
      <div className="activity-meta"><span><Server size={14} /> {t('Errores internos · referencias sanitizadas')}</span><strong>{formatNumber(total)} eventos</strong><HelpHint label={t('Alcance y privacidad de los errores')}><p>{t('Se guardan referencias, ruta y tipo técnico. No se muestran ni persisten mensajes, trazas, headers, cuerpos o secretos. El histograma sólo resume la página cargada y su búsqueda.')}</p></HelpHint></div>
      <PageVolumeHistogram timestamps={rows.map((row) => row.occurred_at)} state={error ? 'error' : loading || !requestReady ? 'loading' : 'ready'} title={t('Volumen de esta página')} help="Agrupa por día UTC los errores de la página cargada y búsqueda actual. No representa el total del historial." />
    <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>{t('Fecha')}</th><th>{t('Referencia')}</th><th>{t('Solicitud')}</th><th>{t('Tipo')}</th><th>{t('Estado')}</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={5}><StateBlock variant="loading" title={t('Cargando errores del sistema…')} /></td></tr>
        : error ? <tr><td colSpan={5}><StateBlock variant="error" title={t('No se pudieron cargar los errores')} hint={error} action={<button type="button" className="button subtle" onClick={() => setReloadKey((value) => value + 1)}>{t('Reintentar')}</button>} /></td></tr>
          : rows.length ? rows.map((row) => <tr key={row.event_id}>
              <td><span className="cell-stack"><time className="cell-lead" dateTime={row.occurred_at} title={dateTimeHint(row.occurred_at)}>{formatDate(row.occurred_at)}</time></span></td>
              <td><code className="operational-error-reference">{row.request_id}</code></td>
              <td><span className="cell-stack"><strong className="cell-lead">{row.method}</strong><span className="cell-sub">{row.path}</span></span></td>
              <td>{row.error_kind}</td><td><span className="status-badge danger"><CircleAlert size={13} /> {row.status_code}</span></td>
            </tr>)
            : <tr><td colSpan={5}><StateBlock variant={q ? 'no-results' : 'empty'} title={q ? t('Sin errores para esta búsqueda') : t('No hay errores internos registrados')} hint={q ? t('Probá otra referencia o ruta.') : t('Los próximos errores no controlados aparecerán aquí con una referencia segura.')} /></td></tr>}
    </tbody></table></div>
     <TablePagination page={page} pageSize={pageSize} total={total} onPageChange={(nextPage) => {
       if (nextPage === page) return;
       startQuery(() => setPage(nextPage));
     }} />
  </section>;
}
