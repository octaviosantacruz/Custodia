import { PieChart } from './pie-chart';
import { RankingBars } from './ranking-bars';
import { donutSlices } from '../lib/category-population';
import type { ChartMode } from '../lib/chart-mode';
import type { AnalyticsBucket } from '../types/analytics';

type Props = {
  title: string;
  buckets: AnalyticsBucket[];
  /** `undefined` means "the sum of the buckets"; `null` means the population is not known. */
  population: number | null | undefined;
  populationLabel: string;
  /** Top-N the source applies; categories beyond it are only known as a remainder. */
  limit: number;
  mode: ChartMode;
  onBucketSelect?: (bucket: AnalyticsBucket) => void;
  unavailablePopulationLabel?: string;
  centerLabel?: string;
  /** Marks the list as a fixed-size sample; it is always drawn as bars without percentages. */
  sampleLabel?: string;
};

/**
 * One category distribution, drawn as a donut or as ranked bars from the same
 * data, population and drill. The donut adds the omitted remainder as its own
 * neutral slice so a Top-N never reads as the whole population.
 */
export function CategoryChart({ title, buckets, population, populationLabel, limit, mode, onBucketSelect, unavailablePopulationLabel, centerLabel, sampleLabel }: Props) {
  const knownPopulation = population === undefined ? buckets.reduce((sum, bucket) => sum + (bucket.count > 0 ? bucket.count : 0), 0) : population;
  if (mode === 'bars' || sampleLabel) {
    return <RankingBars title={title} buckets={buckets} population={knownPopulation} populationLabel={populationLabel} limit={limit} onBucketSelect={onBucketSelect} unavailablePopulationLabel={unavailablePopulationLabel} sampleLabel={sampleLabel} />;
  }
  const slices = donutSlices(buckets, knownPopulation, limit);
  return <div role="group" aria-label={`Distribución: ${title}`}>
    <PieChart title={title} buckets={slices} population={population === undefined ? undefined : population} centerLabel={centerLabel} onBucketSelect={onBucketSelect} />
  </div>;
}
