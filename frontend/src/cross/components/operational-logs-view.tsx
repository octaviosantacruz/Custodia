import { useEffect, useState } from 'react';
import { Info, TriangleAlert, XCircle, Search } from 'lucide-react';
import { ApiError } from '../lib/api';
import { listOperationalLogs, type OperationalLogEntry } from '../lib/operational-logs-api';
import { dateTimeHint, formatDate, formatNumber } from '../lib/format';
import { StateBlock } from './state-block';
import { CompactSelect } from './compact-select';
import { TablePagination } from './table-pagination';
import { HelpHint } from './help-hint';
import { PageVolumeHistogram } from './page-volume-histogram';

const SOURCE_LABELS: Record<string, string> = {
  cyberark: 'CyberArk', identity_administration: 'Identity', sia: 'SIA', access: 'Access', netskope: 'Netskope', ingestion: 'Ingesta',
};

function sourceLabel(source: string): string { return SOURCE_LABELS[source] || source; }
function levelLabel(level: OperationalLogEntry['level']): string { return level === 'error' ? 'Error' : level === 'warning' ? 'Advertencia' : 'Info'; }

export function OperationalLogsView({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const [rows, setRows] = useState<OperationalLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [requestReady, setRequestReady] = useState(false);
  const pageSize = 50;
  const startQuery = (update: () => void) => { setRows([]); setTotal(0); setLoading(true); setError(''); update(); };

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setRequestReady(false);
    void listOperationalLogs(page, pageSize, q, level, source).then((result) => {
    if (!cancelled) { setRows(result.rows); setTotal(result.total); setRequestReady(true); }
    }).catch((caught) => {
      if (caught instanceof ApiError && caught.status === 401) { if (!cancelled) onUnauthorized?.(); return; }
      if (!cancelled) { setRows([]); setTotal(0); setError(caught instanceof Error ? caught.message : 'No se pudieron cargar los logs'); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onUnauthorized is only called on a 401; its identity must not refetch the page
  }, [page, q, level, source, reloadKey]);

  const icon = (entry: OperationalLogEntry) => entry.level === 'error' ? <XCircle size={15} /> : entry.level === 'warning' ? <TriangleAlert size={15} /> : <Info size={15} />;
  return <section className="activity-panel operational-logs-panel">
    <div className="activity-toolbar operational-logs-toolbar"><label className="search-box"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Buscar logs operativos" value={q} onChange={(event) => startQuery(() => { setQ(event.target.value); setPage(0); })} placeholder="Fuente, evento o mensaje" /></label><CompactSelect ariaLabel="Filtrar por nivel" value={level} onChange={(value) => startQuery(() => { setLevel(value); setPage(0); })} options={[{ value: '', label: 'Todos los niveles' }, { value: 'info', label: 'Info' }, { value: 'warning', label: 'Advertencias' }, { value: 'error', label: 'Errores' }]} /><CompactSelect ariaLabel="Filtrar por fuente" value={source} onChange={(value) => startQuery(() => { setSource(value); setPage(0); })} options={[{ value: '', label: 'Todas las fuentes' }, { value: 'cyberark', label: 'CyberArk' }, { value: 'netskope', label: 'Netskope' }, { value: 'identity_administration', label: 'Identity' }, { value: 'sia', label: 'SIA' }, { value: 'access', label: 'Access' }]} /></div>
      <div className="activity-meta"><span><Info size={14} /> Logs operativos · eventos de workers y sync</span><strong>{formatNumber(total)} eventos</strong><HelpHint label="Alcance y privacidad de los logs"><p>Vista segura para diagnóstico. No presenta el archivo crudo, tokens, headers ni payloads. El histograma resume sólo las filas de esta página y estos filtros.</p></HelpHint></div>
      <PageVolumeHistogram timestamps={rows.map((row) => row.occurred_at)} state={error ? 'error' : loading || !requestReady ? 'loading' : 'ready'} title="Volumen de esta página" help="Agrupa por día UTC los logs de la página cargada, con los filtros actuales. No infiere el volumen total de la ventana." />
    <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>Fecha</th><th>Nivel</th><th>Fuente</th><th>Evento</th><th>Detalle</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={5}><StateBlock variant="loading" title="Cargando logs operativos…" /></td></tr>
        : error ? <tr><td colSpan={5}><StateBlock variant="error" title="No se pudieron cargar los logs" hint={error} action={<button type="button" className="button subtle" onClick={() => setReloadKey((value) => value + 1)}>Reintentar</button>} /></td></tr>
          : rows.length ? rows.map((row) => <tr key={row.log_id}>
              <td><span className="cell-stack"><time className="cell-lead" dateTime={row.occurred_at} title={dateTimeHint(row.occurred_at)}>{formatDate(row.occurred_at)}</time></span></td>
              <td><span className={`operational-log-level ${row.level}`}>{icon(row)} {levelLabel(row.level)}</span></td>
              <td>{sourceLabel(row.source_system)}</td>
              <td><code>{row.event}</code></td>
              <td><span className="cell-stack"><span className="cell-lead">{row.message}</span><span className="cell-sub">{row.run_id || 'Evento general'}</span></span></td>
            </tr>)
            : <tr><td colSpan={5}><StateBlock variant={q || level || source ? 'no-results' : 'empty'} title={q || level || source ? 'Sin logs para estos filtros' : 'No hay logs operativos registrados'} /></td></tr>}
    </tbody></table></div>
     <TablePagination page={page} pageSize={pageSize} total={total} onPageChange={(nextPage) => {
       if (nextPage === page) return;
       startQuery(() => setPage(nextPage));
     }} />
  </section>;
}
