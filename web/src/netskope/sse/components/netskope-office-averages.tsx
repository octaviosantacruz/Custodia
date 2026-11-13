import { useState } from 'react';
import type { NetskopeOfficeWeek } from '../types/netskope';
import { formatNumber } from '../../../cross/lib/format';
import { weekRange } from '../lib/netskope-office';
import { t } from '../../../cross/i18n/index.ts';

const WIDTH = 640;
const HEIGHT = 170;
const TOP = 14;
const BOTTOM = 26;
const LEFT = 30;
const RIGHT = 70;
const PLOT_W = WIDTH - LEFT - RIGHT;
const PLOT_H = HEIGHT - TOP - BOTTOM;
const SERIES = [
  { key: 'office_avg', label: t('En la oficina'), className: 'is-office' },
  { key: 'remote_avg', label: t('En remoto (mismas personas)'), className: 'is-remote' },
] as const;

type Point = { x: number; y: number; value: number };

/** Weekly average score in the office vs remote for the same people; an unmeasured week is a gap, never a zero. */
export function NetskopeOfficeAverages({ series }: { series: NetskopeOfficeWeek[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const values = series.flatMap((week) => SERIES.map(({ key }) => week[key])).filter((value): value is number => value !== null);
  const low = values.length ? Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10) : 0;
  const step = PLOT_W / Math.max(1, series.length);
  const x = (index: number) => LEFT + step * index + step / 2;
  const y = (value: number) => TOP + PLOT_H - ((value - low) / (100 - low)) * PLOT_H;
  const segments = (key: typeof SERIES[number]['key']) => {
    // Consecutive measured weeks form one segment; a null week breaks the line.
    const runs: Point[][] = [];
    let run: Point[] = [];
    series.forEach((week, index) => {
      const value = week[key];
      if (value === null) { if (run.length) runs.push(run); run = []; return; }
      run.push({ x: x(index), y: y(value), value });
    });
    if (run.length) runs.push(run);
    return runs;
  };
  const activeWeek = active === null ? null : series[active];
  return <figure className="nsk-office-trend nsk-office-averages">
    <figcaption>
      <span className="nsk-office-trend-legend" aria-label={t('Leyenda')}>
        {SERIES.map((item) => <span key={item.key}><i className={`nsk-office-line-swatch ${item.className}`} aria-hidden />{item.label}</span>)}
      </span>
      <button type="button" className="button subtle" aria-pressed={table} onClick={() => setTable((value) => !value)}>{table ? t('Ver gráfico') : t('Ver como tabla')}</button>
    </figcaption>
    {!values.length ? <p className="nsk-attention-explanation">{t('Todavía no hay semanas con puntaje medido.')}</p>
      : table ? <div className="compact-table-wrap"><table className="compact-table">
        <caption className="sr-only">{t('Puntaje promedio semanal en la oficina y en remoto')}</caption>
        <thead><tr><th scope="col">{t('Semana')}</th><th scope="col">{t('En la oficina')}</th><th scope="col">{t('En remoto')}</th><th scope="col">{t('Días medidos')}</th></tr></thead>
        <tbody>{series.map((week) => <tr key={week.week_start}>
          <th scope="row">{weekRange(week.week_start)}</th>
          <td>{week.office_avg === null ? <span className="nsk-attention-empty">{t('Sin medición')}</span> : formatNumber(week.office_avg)}</td>
          <td>{week.remote_avg === null ? <span className="nsk-attention-empty">{t('Sin dato')}</span> : formatNumber(week.remote_avg)}</td>
          <td>{t('{days_measured} de 7', { days_measured: week.days_measured })}</td>
        </tr>)}</tbody>
      </table></div>
      : <div className="nsk-office-trend-plot" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t('Puntaje promedio semanal en la oficina y en remoto')}>
          {[low, Math.round((low + 100) / 2), 100].map((tick) => <g key={tick}>
            <line className="nsk-office-grid" x1={LEFT} x2={LEFT + PLOT_W} y1={y(tick)} y2={y(tick)} />
            <text className="nsk-office-tick" x={LEFT - 6} y={y(tick) + 4} textAnchor="end">{tick}</text>
          </g>)}
          {active !== null ? <line className="nsk-office-crosshair" x1={x(active)} x2={x(active)} y1={TOP} y2={TOP + PLOT_H} /> : null}
          {SERIES.map((item) => <g key={item.key} className={`nsk-office-series ${item.className}`}>
            {segments(item.key).map((run, index) => <polyline key={index} points={run.map((point) => `${point.x},${point.y}`).join(' ')} />)}
            {segments(item.key).flat().map((point) => <circle key={point.x} cx={point.x} cy={point.y} r={4} />)}
          </g>)}
          {(() => {
            // Direct label on each series' last measured week; when both end within 12px, the higher value
            // goes above and the lower below so they never overlap.
            const ends = SERIES.map((item) => ({ item, last: segments(item.key).flat().at(-1) }));
            const [first, second] = ends;
            const close = first.last && second.last && Math.abs(first.last.y - second.last.y) < 12;
            return ends.map(({ item, last }, index) => {
              if (!last) return null;
              const other = ends[1 - index].last;
              const shift = close && other ? (last.value >= other.value ? -7 : 9) : 4;
              return <text key={item.key} className={`nsk-office-direct ${item.className}`} x={last.x + 8} y={last.y + shift}>{formatNumber(last.value)}</text>;
            });
          })()}
          {series.map((week, index) => <g key={week.week_start} tabIndex={0} role="img" className="nsk-office-week"
            aria-label={week.office_avg === null ? `Semana del ${weekRange(week.week_start)}: sin medición` : `Semana del ${weekRange(week.week_start)}: oficina ${formatNumber(week.office_avg)}${week.remote_avg === null ? '' : `, remoto ${formatNumber(week.remote_avg)}`}`}
            onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
            <rect className="nsk-office-hit" x={LEFT + step * index} y={0} width={step} height={HEIGHT} />
            <text className="nsk-office-tick" x={x(index)} y={HEIGHT - 8} textAnchor="middle">{weekRange(week.week_start)}</text>
          </g>)}
        </svg>
        {activeWeek ? <div className={`nsk-office-tooltip${(active ?? 0) >= series.length / 2 ? ' is-left' : ''}`} role="tooltip" style={{ left: `${(x(active ?? 0) / WIDTH) * 100}%` }}>
          <strong>{t('Semana del {week_start}', { week_start: weekRange(activeWeek.week_start) })}</strong>
          {activeWeek.office_avg === null ? <span>{t('Sin medición')}</span> : <>
            <span><i className="nsk-office-line-swatch is-office" aria-hidden />{t('En la oficina {office_avg}', { office_avg: formatNumber(activeWeek.office_avg) })}</span>
            <span><i className="nsk-office-line-swatch is-remote" aria-hidden />En remoto {activeWeek.remote_avg === null ? t('sin dato') : formatNumber(activeWeek.remote_avg)}</span>
          </>}
          <span>{t('{days_measured} de 7 días medidos', { days_measured: activeWeek.days_measured })}</span>
        </div> : null}
      </div>}
  </figure>;
}
