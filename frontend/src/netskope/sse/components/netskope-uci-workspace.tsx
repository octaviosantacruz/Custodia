import { DateTime } from '../../../cross/components/date-time';
import { useState } from 'react';
import { ShieldHalf, Search } from 'lucide-react';
import { AgeCell } from '../../../cross/components/age-cell';
import { BarCell } from '../../../cross/components/bar-cell';
import { HelpHint } from '../../../cross/components/help-hint';
import { SummaryStats } from '../../../cross/components/summary-stats';
import { CompactSelect } from '../../../cross/components/compact-select';
import { StateBlock } from '../../../cross/components/state-block';
import { TablePagination } from '../../../cross/components/table-pagination';
import { barShare } from '../../../cross/lib/bar-share';
import { formatNumber } from '../../../cross/lib/format';
import { useNetskopePanel } from '../hooks/use-netskope-panel';
import { fetchNetskopeUci } from '../lib/netskope-api';
import {
  UCI_AGE_THRESHOLDS, UCI_CAPTION, UCI_CHANGE_EXPLANATION, UCI_EXPLANATION, UCI_SCALE, UCI_SCORE_LABEL, UCI_MAX_SCORE, UCI_PAGE_SIZE, UCI_RATING_FILTER_OPTIONS, UCI_RATING_LABELS, UCI_TITLE,
  filterUciRows, uciDelta, uciDeltaLabel, uciDeltaTone, uciIsTruncated, uciUserLabel,
  type UciRatingFilter,
} from '../lib/netskope-uci';
import './netskope-uci.css';

type Props = {
  refreshKey: number;
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
};

/* NSK-UBA-002: strict, read-only view (netskope:uba_read). It shows the last
   reading only; no series, anomalies or behavior detail are stored or shown. */
export function NetskopeUciWorkspace({ refreshKey, authChecked, authenticated, onUnauthorized }: Props) {
  const [rating, setRating] = useState<UciRatingFilter>('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const panel = useNetskopePanel({
    cacheKey: ['uci'],
    enabled: authChecked && authenticated,
    refreshKey,
    onUnauthorized,
    load: fetchNetskopeUci,
  });
  const data = panel.data;
  const rows = data?.rows ?? [];
  const visible = filterUciRows(rows, rating, query);
  const lastPage = Math.max(Math.ceil(visible.length / UCI_PAGE_SIZE) - 1, 0);
  const current = Math.min(page, lastPage);
  const pageRows = visible.slice(current * UCI_PAGE_SIZE, (current + 1) * UCI_PAGE_SIZE);

  return <section className="netskope-workspace" aria-label="Usuarios con señales de riesgo en Netskope">
    <section className="list-panel database-surface">
      <section className="netskope-uci" aria-labelledby="netskope-uci-title">
        <header className="netskope-uci-heading">
          <div className="section-title"><ShieldHalf size={17} aria-hidden="true" /><h2 id="netskope-uci-title">{UCI_TITLE}</h2><HelpHint label={UCI_TITLE}><p>UCI significa User Confidence Index (índice de confianza del usuario). {UCI_EXPLANATION} Es una señal para investigar, no una confirmación de que la cuenta esté comprometida.</p><p>{UCI_CAPTION}</p><p>{UCI_CHANGE_EXPLANATION}</p></HelpHint></div>
          <p>{UCI_EXPLANATION} <strong>{UCI_SCALE}</strong></p>
          {data ? <p className="netskope-uci-status">{data.captured_at ? <>Última captura: <DateTime value={data.captured_at} /></> : 'Sin captura todavía'}</p> : null}
        </header>
        {panel.loading && !data
          ? <StateBlock variant="loading" title="Cargando el índice de confianza…" />
          : panel.error && !data
          ? <StateBlock variant="error" title="No se pudo cargar el índice de confianza" hint={panel.error} action={<button type="button" className="button subtle" onClick={() => void panel.reload()}>Reintentar</button>} />
          : data && !data.configured
          ? <StateBlock variant="empty" title="El índice de confianza no está habilitado" hint="Un administrador debe habilitar la captura del índice de confianza de Netskope." />
          : data && !data.captured_at
          ? <StateBlock variant="empty" title="Sin captura del índice de confianza" hint="Todavía no hay una captura completa. Se completa en la próxima sincronización del índice de confianza." />
          : !data
          ? null
          : <>
            <SummaryStats ariaLabel="Resumen de confianza de usuarios" stats={[
              { key: 'poor', label: 'Confianza baja', value: formatNumber(data.by_rating.Poor) },
              { key: 'moderate', label: 'Confianza moderada', value: formatNumber(data.by_rating.Moderate) },
            ]} />
            {uciIsTruncated(data.total, rows.length)
              ? <p className="netskope-uci-note" role="status">Se muestran {formatNumber(rows.length)} de {formatNumber(data.total)} usuarios, de menor a mayor índice de confianza.</p>
              : null}
            <div className="netskope-uci-toolbar">
              <label className="search-box netskope-uci-search"><Search size={16} aria-hidden="true" />
                <input type="search" aria-label="Buscar usuario por nombre o correo" value={query} placeholder="Nombre o correo" onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
              </label>
              <div className="netskope-uci-rating">
                <span className="netskope-uci-label">Confianza</span>
                <CompactSelect
                  ariaLabel="Filtrar por confianza del usuario"
                  value={rating}
                  options={[...UCI_RATING_FILTER_OPTIONS]}
                  onChange={(value) => { setRating(value as UciRatingFilter); setPage(0); }}
                />
              </div>
            </div>
            {!rows.length
              ? <StateBlock variant="empty" title="Ningún usuario con confianza baja o moderada" hint="La última captura completa no listó usuarios con esas calificaciones." />
              : !visible.length
              ? <StateBlock variant="no-results" title="Sin usuarios que coincidan" action={<button type="button" className="button subtle" onClick={() => { setQuery(''); setRating(''); setPage(0); }}>Limpiar filtros</button>} />
              : <>
                <table className="netskope-uci-table">
                  <caption className="sr-only">{UCI_TITLE}. {UCI_CAPTION}</caption>
                  <thead><tr>
                    <th scope="col">Usuario</th>
                    <th scope="col">Confianza</th>
                    <th scope="col">{UCI_SCORE_LABEL}</th>
                    <th scope="col">Hace ~7 días</th>
                    <th scope="col">Variación</th>
                    <th scope="col">Lectura</th>
                  </tr></thead>
                  <tbody>
                    {pageRows.map((row) => {
                      const delta = uciDelta(row);
                      return <tr key={row.email}>
                        <th scope="row"><span className="cell-stack"><strong className="cell-lead">{uciUserLabel(row)}</strong>{row.name ? <small className="cell-sub">{row.email}</small> : null}</span></th>
                        <td><span className={`netskope-uci-chip is-${row.rating.toLowerCase()}`}>{UCI_RATING_LABELS[row.rating]}</span></td>
                        <td><BarCell label={formatNumber(row.score)} share={barShare(row.score, UCI_MAX_SCORE)} muted={row.rating === 'Moderate'} /></td>
                        <td>{row.previous_score === null ? 'Sin dato' : formatNumber(row.previous_score)}</td>
                        <td className={`netskope-uci-delta is-${uciDeltaTone(delta)}`}>{uciDeltaLabel(delta)}</td>
                        <td><AgeCell value={row.scored_at} thresholds={UCI_AGE_THRESHOLDS} /></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
                <TablePagination page={current} pageSize={UCI_PAGE_SIZE} total={visible.length} onPageChange={setPage} />
              </>}
            {panel.error
              ? <p className="netskope-uci-note" role="status">
                  No se pudo refrescar la captura; se muestra la anterior.
                  <button type="button" className="button subtle" onClick={() => void panel.reload()}>Reintentar</button>
                </p>
              : null}
          </>}
      </section>
    </section>
  </section>;
}
