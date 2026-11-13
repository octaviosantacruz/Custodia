import type { AnalyticsBucket } from '../types/analytics';
import { t } from '../i18n/index.ts';

export type PopulationBucket = AnalyticsBucket & {
  percentage: number | null;
};

export type PopulationSummary = {
  population: number | null;
  visible: number;
  visiblePercentage: number | null;
  rest: number | null;
  restPercentage: number | null;
  restValid: boolean;
  truncated: boolean;
  unknown: number;
  inconsistent: boolean;
  visibleCategoryCount: number;
  buckets: PopulationBucket[];
};

/**
 * Describes the visible slice of an exclusive, same-unit category population.
 * A null population deliberately preserves counts without manufacturing a
 * remainder or percentage; callers decide whether their metric is eligible
 * for this calculation (for example, alert snapshots must be complete).
 */
export function summarizeCategoryPopulation(
  buckets: readonly AnalyticsBucket[],
  population: number | null,
  truncationLimit?: number,
): PopulationSummary {
  const finitePopulation = typeof population === 'number' && Number.isFinite(population)
    ? population
    : null;
  const visibleBuckets = buckets.filter((bucket) => Number.isFinite(bucket.count) && bucket.count > 0);
  const visible = visibleBuckets.reduce((total, bucket) => total + bucket.count, 0);
  const unknown = visibleBuckets
    .filter((bucket) => bucket.key === 'Sin dato')
    .reduce((total, bucket) => total + bucket.count, 0);
  const inconsistent = finitePopulation !== null && finitePopulation < visible;
  const restValid = finitePopulation !== null && !inconsistent;
  const rest = restValid ? finitePopulation - visible : null;
  const canCalculatePercentages = finitePopulation !== null && finitePopulation > 0 && !inconsistent;
  const percentageOfPopulation = (count: number) => canCalculatePercentages
    ? (count / finitePopulation) * 100
    : null;

  return {
    population: finitePopulation,
    visible,
    visiblePercentage: percentageOfPopulation(visible),
    rest,
    restPercentage: restValid && rest !== null ? percentageOfPopulation(rest) : null,
    restValid,
    truncated: (restValid && rest !== null && rest > 0)
      || (typeof truncationLimit === 'number' && truncationLimit > 0 && visibleBuckets.length === truncationLimit),
    unknown,
    inconsistent,
    visibleCategoryCount: visibleBuckets.length,
    buckets: visibleBuckets.map((bucket) => ({ ...bucket, percentage: percentageOfPopulation(bucket.count) })),
  };
}

/** The donut's slices: the visible categories plus the omitted remainder as one neutral slice, so a Top-N never reads as the whole population. */
export function donutSlices<T extends AnalyticsBucket>(buckets: readonly T[], population: number | null, limit?: number): Array<T | (AnalyticsBucket & { color: string })> {
  const summary = summarizeCategoryPopulation(buckets, population, limit);
  const rest = summary.restValid && summary.rest !== null && summary.rest > 0 ? summary.rest : null;
  return [...buckets, ...(rest !== null ? [{ key: 'Otros', label: t('Otras categorías'), count: rest, color: 'var(--text-muted)' }] : [])];
}
