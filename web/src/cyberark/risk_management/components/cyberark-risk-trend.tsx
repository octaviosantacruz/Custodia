import { formatNumber } from '../../../cross/lib/format';
import { t } from '../../../cross/i18n/index.ts';

export type TrendSeries = { key: string; label: string; tone: 'primary' | 'secondary'; values: Array<number | null> };

const WIDTH = 600;
const HEIGHT = 200;

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value / 4) ?? 10;
  return Math.ceil(value / (step * magnitude)) * step * magnitude;
}

/* Splits a series into runs of known values so a missing point is a gap,
   never an interpolated or zero value. */
function segments(values: Array<number | null>): Array<Array<[number, number]>> {
  const runs: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  values.forEach((value, index) => {
    if (value === null) { if (current.length) runs.push(current); current = []; return; }
    current.push([index, value]);
  });
  if (current.length) runs.push(current);
  return runs;
}

const shortDate = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Small line/area chart for the progress series CyberArk reports. */
export function CyberarkRiskTrend({ dates, series, ariaLabel }: { dates: string[]; series: TrendSeries[]; ariaLabel: string }) {
  const known = series.flatMap((item) => item.values.filter((value): value is number => value !== null));
  const max = niceMax(Math.max(0, ...known));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio));
  const span = Math.max(1, dates.length - 1);
  const x = (index: number) => (dates.length === 1 ? WIDTH / 2 : (index / span) * WIDTH);
  const y = (value: number) => HEIGHT - (value / max) * HEIGHT;
  const labelEvery = Math.max(1, Math.ceil(dates.length / 8));
  const summary = series.map((item) => {
    const last = [...item.values].reverse().find((value) => value !== null);
    return `${item.label}: ${last === undefined || last === null ? t('sin dato') : formatNumber(last)}`;
  }).join('; ');
  return <figure className="risk-trend">
    <div className="risk-trend-plot">
      <div className="risk-trend-y" aria-hidden="true">{[...ticks].reverse().map((tick) => <span key={tick}>{formatNumber(tick)}</span>)}</div>
      <div className="risk-trend-canvas">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={t('{ariaLabel}. Último punto: {value}', { ariaLabel: ariaLabel, value: summary })}>
          {ticks.map((tick) => <line key={tick} className="risk-trend-grid" x1={0} x2={WIDTH} y1={y(tick)} y2={y(tick)} vectorEffect="non-scaling-stroke" />)}
          {series.map((item) => segments(item.values).map((run, runIndex) => {
            const line = run.map(([index, value]) => `${x(index)},${y(value)}`).join(' ');
            const area = run.length > 1 ? `M${x(run[0][0])},${HEIGHT} L${line.replaceAll(' ', ' L')} L${x(run.at(-1)![0])},${HEIGHT} Z` : '';
            return <g key={`${item.key}-${runIndex}`} className={`risk-trend-series is-${item.tone}`}>
              {area ? <path className="risk-trend-area" d={area} /> : null}
              {run.length > 1
                ? <polyline className="risk-trend-line" points={line} vectorEffect="non-scaling-stroke" />
                : <line className="risk-trend-dot" x1={x(run[0][0])} x2={x(run[0][0])} y1={y(run[0][1])} y2={y(run[0][1])} vectorEffect="non-scaling-stroke" />}
            </g>;
          }))}
        </svg>
        <div className="risk-trend-x" aria-hidden="true">{dates.map((date, index) => (index % labelEvery === 0 && dates.length - 1 - index >= labelEvery / 2) || index === dates.length - 1
          ? <span key={date} style={{ left: `${(x(index) / WIDTH) * 100}%` }}>{shortDate.format(new Date(date))}</span>
          : null)}</div>
      </div>
    </div>
    <figcaption className="risk-trend-legend">{series.map((item) => <span key={item.key}><i className={`is-${item.tone}`} aria-hidden="true" />{item.label}</span>)}</figcaption>
  </figure>;
}
