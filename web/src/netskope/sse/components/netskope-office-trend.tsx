import { useState } from 'react';
import type { NetskopeOfficeWeek } from '../types/netskope';
import { formatNumber } from '../../../cross/lib/format';
import { weekRange } from '../lib/netskope-office';
import { t } from '../../../cross/i18n/index.ts';

const WIDTH = 640;
const HEIGHT = 190;
const TOP = 26;
const BOTTOM = 40;
const PLOT = HEIGHT - TOP - BOTTOM;
const BAR = 30;
const GAP = 2;

/** A bar flat on the baseline with a 4px rounded data end (top), or square when another segment sits on it. */
function barPath(x: number, top: number, height: number, rounded: boolean) {
  const r = rounded ? Math.min(4, height, BAR / 2) : 0;
  return `M${x},${top + height}V${top + r}${r ? `Q${x},${top} ${x + r},${top}` : ''}H${x + BAR - r}${r ? `Q${x + BAR},${top} ${x + BAR},${top + r}` : ''}V${top + height}Z`;
}

const flagged = (week: NetskopeOfficeWeek) => (week.poor ?? 0) + (week.fair ?? 0);
const weekSummary = (week: NetskopeOfficeWeek) => week.measured === null
  ? `Semana del ${weekRange(week.week_start)}: sin medición`
  : `Semana del ${weekRange(week.week_start)}: ${formatNumber(flagged(week))} de ${formatNumber(week.measured)} personas medidas con rendimiento malo o regular en la oficina (malo ${formatNumber(week.poor ?? 0)}, regular ${formatNumber(week.fair ?? 0)}); peor en oficina que en remoto ${formatNumber(week.worse_in_office ?? 0)}; ${week.days_measured} de 7 días medidos.`;

/** Weekly count of people with a poor or fair office experience, stacked by band, over the people measured. */
export function NetskopeOfficeTrend({ series }: { series: NetskopeOfficeWeek[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...series.map(flagged));
  const step = WIDTH / series.length;
  const y = (value: number) => (value / max) * PLOT;
  const activeWeek = active === null ? null : series[active];
  return <figure className="nsk-office-trend">
    <figcaption>
      <span className="nsk-office-trend-legend" aria-label={t('Leyenda')}>
        <span><i className="nsk-office-swatch is-poor" aria-hidden />{t('Malo')}</span>
        <span><i className="nsk-office-swatch is-fair" aria-hidden />{t('Regular')}</span>
      </span>
      <button type="button" className="button subtle" aria-pressed={table} onClick={() => setTable((value) => !value)}>{table ? t('Ver gráfico') : t('Ver como tabla')}</button>
    </figcaption>
    {table ? <div className="compact-table-wrap"><table className="compact-table">
      <caption className="sr-only">{t('Evolución semanal del rendimiento en la oficina')}</caption>
      <thead><tr><th scope="col">{t('Semana')}</th><th scope="col">{t('Malo')}</th><th scope="col">{t('Regular')}</th><th scope="col">{t('Personas medidas')}</th><th scope="col">{t('Peor en oficina')}</th><th scope="col">{t('Días medidos')}</th></tr></thead>
      <tbody>{series.map((week) => <tr key={week.week_start}>
        <th scope="row">{weekRange(week.week_start)}</th>
        {week.measured === null
          ? <td colSpan={4} className="nsk-attention-empty">{t('Sin medición')}</td>
          : <><td>{formatNumber(week.poor ?? 0)}</td><td>{formatNumber(week.fair ?? 0)}</td><td>{formatNumber(week.measured)}</td><td>{formatNumber(week.worse_in_office ?? 0)}</td></>}
        <td>{week.days_measured} de 7</td>
      </tr>)}</tbody>
    </table></div>
      : <div className="nsk-office-trend-plot" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t('Evolución semanal: personas con rendimiento malo o regular en la oficina')}>
          <line className="nsk-office-axis" x1={0} x2={WIDTH} y1={TOP + PLOT} y2={TOP + PLOT} />
          {series.map((week, index) => {
            const center = step * index + step / 2;
            const x = center - BAR / 2;
            const poor = y(week.poor ?? 0);
            const fair = y(week.fair ?? 0);
            const base = TOP + PLOT;
            const unmeasured = week.measured === null;
            return <g key={week.week_start} className={`nsk-office-week${active === index ? ' is-active' : ''}`} tabIndex={0} role="img" aria-label={weekSummary(week)}
              onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
              <rect className="nsk-office-hit" x={step * index} y={0} width={step} height={HEIGHT} />
              {unmeasured
                ? <rect className="nsk-office-empty" x={x} y={TOP + PLOT - 24} width={BAR} height={24} rx={4} />
                : <>
                  {poor > 0 ? <path className="nsk-office-bar is-poor" d={barPath(x, base - poor, poor, fair === 0)} /> : null}
                  {fair > 0 ? <path className="nsk-office-bar is-fair" d={barPath(x, base - poor - fair - (poor > 0 ? GAP : 0), fair, true)} /> : null}
                </>}
              <text className="nsk-office-value" x={center} y={unmeasured ? TOP + PLOT - 30 : base - poor - fair - (poor > 0 && fair > 0 ? GAP : 0) - 6} textAnchor="middle">
                {unmeasured ? 'Sin medición' : `${formatNumber(flagged(week))} de ${formatNumber(week.measured ?? 0)}`}
              </text>
              <text className="nsk-office-tick" x={center} y={HEIGHT - 22} textAnchor="middle">{weekRange(week.week_start)}</text>
              {week.days_measured > 0 && week.days_measured < 7 ? <text className="nsk-office-tick is-partial" x={center} y={HEIGHT - 8} textAnchor="middle">{week.days_measured} de 7 días</text> : null}
            </g>;
          })}
        </svg>
        {activeWeek ? <div className={`nsk-office-tooltip${(active ?? 0) >= series.length / 2 ? ' is-left' : ''}`} role="tooltip" style={{ left: `${((step * (active ?? 0) + step / 2) / WIDTH) * 100}%` }}>
          <strong>Semana del {weekRange(activeWeek.week_start)}</strong>
          {activeWeek.measured === null ? <span>{t('Sin medición')}</span> : <>
            <span><i className="nsk-office-swatch is-poor" aria-hidden />Malo {formatNumber(activeWeek.poor ?? 0)}</span>
            <span><i className="nsk-office-swatch is-fair" aria-hidden />Regular {formatNumber(activeWeek.fair ?? 0)}</span>
            <span>De {formatNumber(activeWeek.measured)} personas medidas en la oficina</span>
            <span>Peor en oficina que en remoto: {formatNumber(activeWeek.worse_in_office ?? 0)}</span>
          </>}
          <span>{activeWeek.days_measured} de 7 días medidos</span>
        </div> : null}
      </div>}
  </figure>;
}
