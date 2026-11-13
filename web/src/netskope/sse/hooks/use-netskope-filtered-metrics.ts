import { useCallback, useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { errorDetailsFrom } from '../../../cross/lib/error-details';
import { createNetskopeMetricsLoader } from '../lib/netskope-metrics-loader';
import { netskopeFilterKey, netskopeFiltersFromKey } from '../lib/netskope-dashboard';
import type { NetskopeSelectedMetrics, NetskopeWidgetFilters, NetskopeWidgetInstance } from '../types/netskope';
import { t } from '../../../cross/i18n/index.ts';

type Options = {
  widgets: readonly NetskopeWidgetInstance[];
  enabled: boolean;
  refreshKey?: number;
  onUnauthorized: () => void;
};

/** One projected request per unique filter, after saved preferences resolve.
 * Snapshots and AA have independent owners and never enter this SQL plan. */
export function useNetskopeFilteredMetrics({ widgets, enabled, refreshKey = 0, onUnauthorized }: Options) {
  const groups = new Map<string, Set<string>>();
  for (const widget of widgets) {
    // Alert snapshots and Advanced Analytics charts have their own owners.
    if (widget.id.startsWith('alerts_') || widget.id.startsWith('aa_')) continue;
    const key = netskopeFilterKey(widget.filters);
    const ids = groups.get(key) ?? new Set<string>();
    ids.add(widget.id);
    groups.set(key, ids);
  }
  const signature = JSON.stringify([...groups].sort(([left], [right]) => left.localeCompare(right)).map(([key, ids]) => [key, [...ids].sort()]));
  const plan = useMemo(() => JSON.parse(signature) as Array<[string, string[]]>, [signature]);
  const load = useMemo(createNetskopeMetricsLoader, []);
  const queries = useQueries({
    queries: plan.map(([key, ids]) => ({
      queryKey: ['netskope', 'metrics', key, ids, refreshKey],
      enabled,
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) => load(netskopeFiltersFromKey(key), ids, signal),
    })),
  });
  const byKey = Object.fromEntries(plan.flatMap(([key], index) => {
    const data = queries[index]?.data;
    return data ? [[key, data] as const] : [];
  }));
  const failed = queries.find((query) => query.error)?.error;
  useEffect(() => {
    if (failed instanceof ApiError && failed.status === 401) onUnauthorized();
  }, [failed, onUnauthorized]);

  const metricsFor = useCallback((filters?: NetskopeWidgetFilters): NetskopeSelectedMetrics | null => {
    return byKey[netskopeFilterKey(filters)] ?? null;
  }, [byKey]);
  const reload = useCallback(async () => {
    await Promise.all(queries.filter((query) => query.isError).map((query) => query.refetch()));
  }, [queries]);

  return {
    metricsFor,
    loading: queries.some((query) => query.isLoading || query.isFetching),
    error: failed instanceof Error ? failed.message : failed ? t('No se pudieron cargar las métricas') : '',
    errorInfo: failed ? errorDetailsFrom(failed, t('No se pudieron cargar las métricas')) : null,
    reload,
  };
}
