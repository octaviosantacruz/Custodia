import { formatNumber } from '../lib/format';
import { summarizeCategoryPopulation } from '../lib/category-population';
import type { AnalyticsBucket } from '../types/analytics';
import './ranking-bars.css';
import { t } from '../i18n/index.ts';

type Props = {
  title: string;
  buckets: AnalyticsBucket[];
  population: number | null;
  populationLabel: string;
  limit: number;
  onBucketSelect?: (bucket: AnalyticsBucket) => void;
  unavailablePopulationLabel?: string;
  /** The list is a fixed-size sample (for example a Top 10), not a share of a population: say so and show no percentages. */
  sampleLabel?: string;
};

function percentLabel(value: number | null): string {
  return value === null ? 'Porcentaje no calculable' : `${Math.round(value)}%`;
}

export function RankingBars({ title, buckets, population, populationLabel, limit, onBucketSelect, unavailablePopulationLabel, sampleLabel }: Props) {
  const summary = summarizeCategoryPopulation(buckets, sampleLabel ? null : population, limit);
  const sample = Boolean(sampleLabel);
  const rest = summary.restValid && summary.rest !== null && summary.rest > 0 ? summary.rest : null;
  const maxCount = Math.max(1, ...summary.buckets.map((bucket) => bucket.count), rest ?? 0);
  // The reading in the "?" has the full population; the card only says so when the bars cannot be trusted as a share of it.
  const populationNote = sample ? sampleLabel : summary.population === null
    ? unavailablePopulationLabel ?? 'Población no informada'
    : summary.population === 0
      ? 'Sin población: porcentaje no calculable'
      : summary.inconsistent
        ? `Población inconsistente: ${formatNumber(summary.population)} ${populationLabel}`
        : null;

  return <div className={`ranking-bars${sample ? ' is-sample' : ''}`} role="group" aria-label={`Ranking: ${title}`}>
    {populationNote ? <p className="ranking-summary">{populationNote}</p> : null}
    {summary.inconsistent ? <p className="ranking-warning" role="status">La parte visible supera la población; no se calcula resto.</p> : null}
    {summary.buckets.length ? <ul className="ranking-list">
      {summary.buckets.map((bucket) => {
        const content = <>
          <span className="ranking-label">{bucket.key}</span>
          <span className="ranking-track" aria-hidden="true"><span style={{ width: `${(bucket.count / maxCount) * 100}%` }} /></span>
          <strong>{formatNumber(bucket.count)}</strong>
          {sample ? null : <span className="ranking-percent">{percentLabel(bucket.percentage)}</span>}
        </>;
        return <li key={bucket.key}>
          {onBucketSelect
            ? <button type="button" className="ranking-row is-selectable" title={`Filtrar por ${bucket.key}`} onClick={() => onBucketSelect(bucket)}>{content}</button>
            : <div className="ranking-row">{content}</div>}
        </li>;
      })}
      {rest !== null ? <li className="ranking-rest" aria-label={`Otras categorías (resto): ${formatNumber(rest)} · ${percentLabel(summary.restPercentage)}`}>
        <span className="ranking-label">Otras categorías (resto)</span>
        <span className="ranking-track" aria-hidden="true"><span style={{ width: `${(rest / maxCount) * 100}%` }} /></span>
        <strong>{formatNumber(rest)}</strong>
        <span className="ranking-percent">{percentLabel(summary.restPercentage)}</span>
      </li> : null}
    </ul> : <p className="ranking-empty">{t('Sin categorías visibles.')}</p>}
  </div>;
}
