import { dateTimeHint, formatDate, formatNumber } from '../lib/format';
import { syncStatusLabel } from '../lib/sync-source';
import type { TimelineRow } from '../lib/sync-timeline';
import './sync-runs-timeline.css';
import { t } from '../i18n/index.ts';

/** One strip per tool: the latest cycles at a glance, so a degradation shows
 *  without reading every row below. Status is also written as text. */
export function SyncRunsTimeline({ rows }: { rows: TimelineRow[] }) {
  if (!rows.length) return null;
  return <section className="sync-timeline" aria-label={t('Últimos ciclos por herramienta')}>
    {rows.map((row) => <div className="sync-timeline-row" key={row.tool}>
      <strong className="sync-timeline-label">{row.label}</strong>
      <ol className="sync-timeline-cells" aria-label={`Últimos ${formatNumber(row.cells.length)} ciclos de ${row.label}, del más antiguo al más reciente`}>
        {row.cells.map((cell, index) => <li key={`${cell.at}-${index}`} className={`sync-timeline-cell is-${cell.status}`} title={`${syncStatusLabel(cell.status)} · ${formatDate(cell.at)} · ${dateTimeHint(cell.at)}`}>
          <span className="sr-only">{syncStatusLabel(cell.status)}, {formatDate(cell.at)}</span>
        </li>)}
      </ol>
      <span className={row.problems ? 'sync-timeline-summary has-problems' : 'sync-timeline-summary'}>
        {row.problems ? `${formatNumber(row.problems)} con aviso o fallo` : 'Sin avisos'}
      </span>
    </div>)}
    <p className="sync-timeline-legend" aria-hidden="true">
      <span><i className="is-completed" />{t('Completo')}</span><span><i className="is-partial" />{t('Con avisos')}</span><span><i className="is-failed" />{t('Fallido')}</span>
      <span>Cada cuadro es un ciclo; el más reciente está a la derecha.</span>
    </p>
  </section>;
}
