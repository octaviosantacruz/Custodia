import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchDashboardFiltered, fetchDashboardStatic, type DashboardFilters, type DashboardRequestOptions } from '../lib/dashboard-api';
import type { AuthStatus } from '../types/auth';
import type { Catalogs, Analytics, SafeRow } from '../types/safe';
import type { CmdbCoverage } from '../types/cmdb';
import type { Summary } from '../types/dashboard';

type UseDashboardOptions = DashboardFilters & {
  authChecked: boolean;
  authStatus: AuthStatus | null;
  loadFiltered: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  includeInternal: boolean;
};

export function useDashboard({
  authChecked,
  authStatus,
  onUnauthorized,
  onError,
  search,
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
  const [summary, setSummary] = useState<Summary | null>(null);
  const [catalogs, setCatalogs] = useState<Catalogs>({ business_units: [], responsibles: [], account_types: [] });
  const [cmdbCoverage, setCmdbCoverage] = useState<CmdbCoverage>({ objects: [], relationships: [], chains: { pam: 'pending_sources', sia: 'pending_sources' } });
  const [analytics, setAnalytics] = useState<Analytics>({ workflow_status: [], next_actions: [], account_types: [], business_units: [], responsibles: [] });
  const [retiredCandidates, setRetiredCandidates] = useState(0);
  const [accountPlatformCoverage, setAccountPlatformCoverage] = useState({ accounts_active: 0, accounts_with_platform: 0, accounts_without_platform: 0, accounts_with_partial_platform: 0, platforms_observed: 0, safes_without_accounts: 0 });
  const [safes, setSafes] = useState<SafeRow[]>([]);
  const [safeTotal, setSafeTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const staticLoaded = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);

  const loadDashboard = useCallback(async (options: DashboardRequestOptions = {}) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    onError('');
    try {
      const filters: DashboardFilters = {
        search,
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
      const [filteredData, staticData] = await Promise.all([
        loadFiltered ? fetchDashboardFiltered(filters, { signal: controller.signal, includeInternal }) : Promise.resolve(null),
        (options.refreshStatic || !staticLoaded.current)
          ? fetchDashboardStatic({ signal: controller.signal, includeInternal })
          : Promise.resolve(null),
      ]);
      if (controller.signal.aborted) return;
      if (staticData) {
        setSummary(staticData.summary);
        setCatalogs(staticData.catalogs);
        setCmdbCoverage(staticData.cmdbCoverage);
        setRetiredCandidates(staticData.retiredCandidates);
        setAccountPlatformCoverage(staticData.accountPlatformCoverage);
        staticLoaded.current = true;
      }
      if (filteredData) {
        setAnalytics(filteredData.analytics);
        setSafes((current) => {
          if (page === 0) return filteredData.safes;
          const knownNumbers = new Set(current.map((safe) => safe.safe_number));
          return [...current, ...filteredData.safes.filter((safe) => !knownNumbers.has(safe.safe_number))];
        });
        setSafeTotal(filteredData.safeTotal);
      }
    } catch (loadError) {
      if (controller.signal.aborted || (loadError instanceof DOMException && loadError.name === 'AbortError')) return;
      if (loadError instanceof ApiError && loadError.status === 401) {
        onUnauthorized();
        return;
      }
      onError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el inventario');
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
    workflowFilter,
    includeInternal,
  ]);

  useEffect(() => {
    staticLoaded.current = false;
  }, [includeInternal]);

  useEffect(() => {
    if (!authChecked || !authStatus?.authenticated) return;
    const delay = search.trim() ? 280 : 0;
    const timeout = window.setTimeout(() => void loadDashboard(), delay);
    return () => {
      window.clearTimeout(timeout);
      activeRequest.current?.abort();
    };
  }, [authChecked, authStatus?.authenticated, loadDashboard]);

  return {
    summary,
    catalogs,
    cmdbCoverage,
    analytics,
    retiredCandidates,
    accountPlatformCoverage,
    safes,
    safeTotal,
    loading,
    setSafes,
    loadDashboard,
  };
}
