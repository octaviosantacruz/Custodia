import type { ConnectionCoverageEnvironment, ConnectionCoverageFilter, ConnectionCoverageTotals } from '../types/connection';

export type FilterOption = { value: string; label: string };

const COVERAGE_LABELS: [ConnectionCoverageFilter, string, keyof ConnectionCoverageTotals][] = [
  ['both', 'PAM + SIA', 'both'], ['pam_only', 'Solo PAM', 'pam_only'], ['sia_only', 'Solo SIA', 'sia_only'], ['none', 'Sin coincidencia', 'none'],
];

const withCount = (label: string, count: number | null, format: (value: number) => string) => count === null ? label : `${label} (${format(count)})`;

/** FE-AUD-003: while the summary is unavailable the options carry no count at all ("Sin dato"), never "(0)". */
export function coverageOptions(totals: ConnectionCoverageTotals | null, active: ConnectionCoverageFilter | '', format: (value: number) => string): FilterOption[] {
  const options: FilterOption[] = [{ value: '', label: withCount('Toda cobertura', totals ? totals.total : null, format) }];
  for (const [value, label, key] of COVERAGE_LABELS) {
    const count = totals ? totals[key] : null;
    // With a summary, empty categories are hidden unless selected; without one every category stays reachable.
    if (totals && count === 0 && value !== active) continue;
    options.push({ value, label: withCount(label, count, format) });
  }
  return options;
}

export function environmentOptions(environments: readonly ConnectionCoverageEnvironment[] | null, total: number | null, active: string, format: (value: number) => string): FilterOption[] {
  const options: FilterOption[] = [{ value: '', label: withCount('Todos los ambientes', total, format) }];
  for (const item of environments ?? []) options.push({ value: item.environment, label: withCount(item.environment, item.total, format) });
  // The active choice survives a failed summary so the filter never silently changes.
  if (active && !options.some((option) => option.value === active)) options.push({ value: active, label: active });
  return options;
}
