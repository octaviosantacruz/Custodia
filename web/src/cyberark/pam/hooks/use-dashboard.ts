import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { fetchDashboardFiltered, fetchDashboardStatic, type DashboardFilters, type DashboardRequestOptions } from '../lib/dashboard-api';
import type { AuthStatus } from '../../../cross/types/auth';
import type { Analytics, SafeClassificationCounts, SafeRow } from '../types/safe';
import { t } from '../../../cross/i18n/index.ts';

type UseDashboardOptions = DashboardFilters & {
  authChecked: boolean;
  authStatus: AuthStatus | null;
  enabled?: boolean;
  refreshKey?: unknown;
  loadFiltered: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  includeInternal: boolean;
};

export function useDashboard({
  authChecked,
  authStatus,
  enabled = true,
  refreshKey = null,
  onUnauthorized,
  onError,
  search,
  includeAccounts,
  workflowFilter,
  classificationFilter,
  accountTypeFilter,
  inventoryScopeFilter,
  qualityFilter,
  scopeHintFilter,
  healthFilter,
  nextActionFilter,
  businessUnitFilter,
  responsibleFilter,
  page,
  loadFiltered,
  includeInternal,
}: UseDashboardOptions) {
  const [analytics, setAnalytics] = useState<Analytics>({ workflow_status: [], next_actions: [], account_types: [], business_units: [], responsibles: [] });
  const [safes, setSafes] = useState<SafeRow[]>([]);
  const [safeTotal, setSafeTotal] = useState(0);
  const [safeClassificationCounts, setSafeClassificationCounts] = useState<SafeClassificationCounts>({ assigned: 0, review: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  /** FE-AUD-002: a failed filtered read; never shown as "Sin resultados" nor as rows of another filter. */
  const [loadError, setLoadError] = useState('');
  const activeRequest = useRef<AbortController | null>(null);
  const lastRefreshKey = useRef(refreshKey);
  const staticQuery = useQuery({
    queryKey: ['pam', 'dashboard-static', includeInternal, refreshKey],
    enabled: enabled && authChecked && Boolean(authStatus?.authenticated),
    queryFn: ({ signal }) => fetchDashboardStatic({ signal, includeInternal }),
  });
  const refetchStatic = staticQuery.refetch;

  useEffect(() => {
    if (!staticQuery.error) return;
    if (staticQuery.error instanceof ApiError && staticQuery.error.status === 401) onUnauthorized();
    else onError(staticQuery.error instanceof Error ? staticQuery.error.message : t('No se pudo cargar el inventario'));
  }, [onError, onUnauthorized, staticQuery.error]);

  const loadDashboard = useCallback(async (options: DashboardRequestOptions = {}) => {
    if (!enabled) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setLoadError('');
    onError('');
    try {
      const filters: DashboardFilters = {
        search,
        includeAccounts,
        workflowFilter,
        classificationFilter,
        accountTypeFilter,
        inventoryScopeFilter,
        qualityFilter,
        scopeHintFilter,
        healthFilter,
        nextActionFilter,
        businessUnitFilter,
        responsibleFilter,
        page,
      };
      const [filteredData] = await Promise.all([
        loadFiltered ? fetchDashboardFiltered(filters, { signal: controller.signal, includeInternal }) : Promise.resolve(null),
        options.refreshStatic ? refetchStatic() : Promise.resolve(null),
      ]);
      if (controller.signal.aborted) return;
      if (filteredData) {
        setAnalytics(filteredData.analytics);
        setSafes((current) => {
          if (page === 0) return filteredData.safes;
          const knownNumbers = new Set(current.map((safe) => safe.safe_number));
          return [...current, ...filteredData.safes.filter((safe) => !knownNumbers.has(safe.safe_number))];
        });
        setSafeTotal(filteredData.safeTotal);
        setSafeClassificationCounts(filteredData.safeClassificationCounts);
      }
    } catch (failure) {
      if (controller.signal.aborted || (failure instanceof DOMException && failure.name === 'AbortError')) return;
      if (failure instanceof ApiError && failure.status === 401) {
        onUnauthorized();
        return;
      }
      const message = failure instanceof Error ? failure.message : t('No se pudo cargar el inventario');
      setLoadError(message);
      // Rows loaded for another filter must not stay on screen as if they matched this one.
      if (page === 0) { setSafes([]); setSafeTotal(0); }
      onError(message);
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }, [
    accountTypeFilter,
    classificationFilter,
    inventoryScopeFilter,
    loadFiltered,
    onError,
    onUnauthorized,
    page,
    qualityFilter,
    scopeHintFilter,
    healthFilter,
    nextActionFilter,
    businessUnitFilter,
    responsibleFilter,
    search,
    includeAccounts,
    workflowFilter,
    includeInternal,
    enabled, refetchStatic,
  ]);

  useEffect(() => {
    if (!enabled || !authChecked || !authStatus?.authenticated) return;
    const delay = search.trim() ? 280 : 0;
    const refreshStatic = refreshKey !== lastRefreshKey.current;
    lastRefreshKey.current = refreshKey;
    const timeout = window.setTimeout(() => void loadDashboard(refreshStatic ? { refreshStatic: true } : {}), delay);
    return () => {
      window.clearTimeout(timeout);
      activeRequest.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- search only picks the debounce delay; its changes reach this effect through loadDashboard
  }, [authChecked, authStatus?.authenticated, enabled, loadDashboard, refreshKey]);

  return {
    summary: staticQuery.data?.summary ?? null,
    catalogs: staticQuery.data?.catalogs ?? { business_units: [], responsibles: [], account_types: [] },
    cmdbCoverage: staticQuery.data?.cmdbCoverage ?? { objects: [], relationships: [], chains: { pam: 'pending_sources', sia: 'pending_sources' } },
    analytics,
    retiredCandidates: staticQuery.data?.retiredCandidates ?? 0,
    accountPlatformCoverage: staticQuery.data?.accountPlatformCoverage ?? { accounts_active: 0, accounts_with_platform: 0, accounts_without_platform: 0, accounts_with_partial_platform: 0, platforms_observed: 0, safes_without_accounts: 0 },
    accountManagementSummary: staticQuery.data?.accountManagementSummary ?? null,
    accountManagementSummaryLoading: staticQuery.isLoading && !staticQuery.data,
    accountManagementSummaryError: staticQuery.isError || (staticQuery.isSuccess && !staticQuery.data?.accountManagementSummary),
    safes,
    safeTotal,
    safeClassificationCounts,
    loadError,
    loading: loading || staticQuery.isLoading || staticQuery.isFetching,
    setSafes,
    loadDashboard,
  };
}
