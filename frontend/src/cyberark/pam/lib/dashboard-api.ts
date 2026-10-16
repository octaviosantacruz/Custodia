import { api } from '../../../cross/lib/api';
import type {
  Analytics,
  AccountManagementSummary,
  AccountPlatformCoverage,
  Catalogs,
  ClassificationStatus,
  RetiredCandidates,
  SafeClassificationCounts,
  SafeListResponse,
  SafeRow,
  SafeHealthFilter,
  WorkflowStatus,
} from '../types/safe';
import type { CmdbCoverage } from '../../../cross/types/cmdb';
import type { Summary } from '../types/dashboard';

export const DASHBOARD_PAGE_SIZE = 50;

export type DashboardFilters = {
  search: string;
  includeAccounts: boolean;
  workflowFilter: WorkflowStatus | '';
  classificationFilter: ClassificationStatus | '';
  accountTypeFilter: string;
  inventoryScopeFilter: 'pending' | 'business' | 'internal' | '';
  qualityFilter: 'pending' | 'clean' | 'obsolete' | 'duplicate' | '';
  scopeHintFilter: '' | 'possible_internal_accounts_safe';
  healthFilter: SafeHealthFilter;
  nextActionFilter: string;
  businessUnitFilter: string;
  responsibleFilter: string;
  page: number;
};

export type DashboardData = {
  summary: Summary;
  catalogs: Catalogs;
  cmdbCoverage: CmdbCoverage;
  analytics: Analytics;
  retiredCandidates: number;
  accountPlatformCoverage: AccountPlatformCoverage;
  accountManagementSummary: AccountManagementSummary | null;
  safes: SafeRow[];
  safeTotal: number;
  safeClassificationCounts: SafeClassificationCounts;
};

export type DashboardStaticData = Pick<DashboardData, 'summary' | 'catalogs' | 'cmdbCoverage' | 'retiredCandidates' | 'accountPlatformCoverage' | 'accountManagementSummary'>;
export type DashboardFilteredData = Pick<DashboardData, 'analytics' | 'safes' | 'safeTotal' | 'safeClassificationCounts'>;

export type DashboardRequestOptions = {
  signal?: AbortSignal;
  refreshStatic?: boolean;
};

export async function fetchDashboardStatic({ signal, includeInternal = true }: DashboardRequestOptions & { includeInternal?: boolean } = {}): Promise<DashboardStaticData> {
  const accountManagementRequest = api<AccountManagementSummary>(`/analytics/account-management?include_internal=${includeInternal}`, { signal })
    .catch((error) => {
      if (signal?.aborted) throw error;
      return null;
    });
  const [summaryData, catalogsData, coverageData, retiredData, accountPlatformData, accountManagementData] = await Promise.all([
    api<Summary>(`/summary?include_internal=${includeInternal}`, { signal }),
    api<Catalogs>('/catalogs', { signal }),
    api<CmdbCoverage>('/cmdb/coverage', { signal }),
    api<RetiredCandidates>('/lifecycle/retired?limit=100', { signal }),
    api<AccountPlatformCoverage>(`/analytics/account-platform-coverage?include_internal=${includeInternal}`, { signal }),
    accountManagementRequest,
  ]);

  return {
    summary: summaryData,
    catalogs: {
      business_units: Array.isArray(catalogsData.business_units) ? catalogsData.business_units : [],
      responsibles: Array.isArray(catalogsData.responsibles) ? catalogsData.responsibles : [],
      account_types: Array.isArray(catalogsData.account_types) ? catalogsData.account_types : [],
    },
    cmdbCoverage: coverageData,
    retiredCandidates: retiredData.total || 0,
    accountPlatformCoverage: accountPlatformData,
    accountManagementSummary: accountManagementData,
  };
}

export async function fetchDashboardFiltered(
  filters: DashboardFilters,
  { signal, includeInternal = true }: DashboardRequestOptions & { includeInternal?: boolean } = {},
): Promise<DashboardFilteredData> {
  const nextAction = encodeURIComponent(filters.nextActionFilter);
  const dimensionFilters = `&business_unit=${encodeURIComponent(filters.businessUnitFilter)}&responsible=${encodeURIComponent(filters.responsibleFilter)}`;
  const includeAccountsQuery = filters.includeAccounts ? '&include_accounts=true' : '';
  const analyticsQuery = `q=${encodeURIComponent(filters.search)}&workflow_status=${filters.workflowFilter}&classification_status=${filters.classificationFilter}&account_type=${encodeURIComponent(filters.accountTypeFilter)}&inventory_scope=${filters.inventoryScopeFilter}&data_quality_status=${filters.qualityFilter}&scope_hint=${filters.scopeHintFilter}&health_filter=${filters.healthFilter}&next_action=${nextAction}${dimensionFilters}&include_internal=${includeInternal}${includeAccountsQuery}`;
  const [analyticsData, safesData] = await Promise.all([
    api<Analytics>('/analytics?' + analyticsQuery, { signal }),
    api<SafeListResponse>(`/safes?limit=${DASHBOARD_PAGE_SIZE}&offset=${filters.page * DASHBOARD_PAGE_SIZE}&q=${encodeURIComponent(filters.search)}&workflow_status=${filters.workflowFilter}&classification_status=${filters.classificationFilter}&account_type=${encodeURIComponent(filters.accountTypeFilter)}&inventory_scope=${filters.inventoryScopeFilter}&data_quality_status=${filters.qualityFilter}&scope_hint=${filters.scopeHintFilter}&health_filter=${filters.healthFilter}&next_action=${nextAction}${dimensionFilters}&include_internal=${includeInternal}${includeAccountsQuery}`, { signal }),
  ]);

  return {
    analytics: {
      workflow_status: Array.isArray(analyticsData.workflow_status) ? analyticsData.workflow_status : [],
      next_actions: Array.isArray(analyticsData.next_actions) ? analyticsData.next_actions : [],
      account_types: Array.isArray(analyticsData.account_types) ? analyticsData.account_types : [],
      business_units: Array.isArray(analyticsData.business_units) ? analyticsData.business_units : [],
      responsibles: Array.isArray(analyticsData.responsibles) ? analyticsData.responsibles : [],
    },
    safes: Array.isArray(safesData.rows) ? safesData.rows : [],
    safeTotal: safesData.total || 0,
    safeClassificationCounts: {
      assigned: safesData.classification_counts?.assigned || 0,
      review: safesData.classification_counts?.review || 0,
      pending: safesData.classification_counts?.pending || 0,
    },
  };
}
