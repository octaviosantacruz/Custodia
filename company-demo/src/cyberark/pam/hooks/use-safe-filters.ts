import { useState } from 'react';
import type { SafeFilterValues } from '../lib/safe-filters';
import { EMPTY_SAFE_FILTERS } from '../lib/safe-filters';
import type { AccountPlatformStatus, ClassificationStatus, SafeHealthFilter, WorkflowStatus } from '../types/safe';

export type { SafeFilterValues } from '../lib/safe-filters';
export { EMPTY_SAFE_FILTERS } from '../lib/safe-filters';

export function useSafeFilters() {
  const [filters, setFilters] = useState<SafeFilterValues>(EMPTY_SAFE_FILTERS);
  const reset = () => setFilters({ ...EMPTY_SAFE_FILTERS });
  const apply = (partial: Partial<SafeFilterValues>) => setFilters((current) => ({ ...current, ...partial }));

  return {
    ...filters,
    apply,
    setSearch: (search: string) => setFilters((current) => ({ ...current, search })),
    setIncludeAccounts: (includeAccounts: boolean) => setFilters((current) => ({ ...current, includeAccounts })),
    setWorkflowFilter: (workflowFilter: WorkflowStatus | '') => setFilters((current) => ({ ...current, workflowFilter })),
    setClassificationFilter: (classificationFilter: ClassificationStatus | '') => setFilters((current) => ({ ...current, classificationFilter })),
    setAccountTypeFilter: (accountTypeFilter: string) => setFilters((current) => ({ ...current, accountTypeFilter })),
    setInventoryScopeFilter: (inventoryScopeFilter: SafeFilterValues['inventoryScopeFilter']) => setFilters((current) => ({ ...current, inventoryScopeFilter })),
    setQualityFilter: (qualityFilter: SafeFilterValues['qualityFilter']) => setFilters((current) => ({ ...current, qualityFilter })),
    setScopeHintFilter: (scopeHintFilter: SafeFilterValues['scopeHintFilter']) => setFilters((current) => ({ ...current, scopeHintFilter })),
    setHealthFilter: (healthFilter: SafeHealthFilter) => setFilters((current) => ({ ...current, healthFilter })),
    setNextActionFilter: (nextActionFilter: string) => setFilters((current) => ({ ...current, nextActionFilter })),
    setBusinessUnitFilter: (businessUnitFilter: string) => setFilters((current) => ({ ...current, businessUnitFilter })),
    setResponsibleFilter: (responsibleFilter: string) => setFilters((current) => ({ ...current, responsibleFilter })),
    setAccountPlatformStatus: (accountPlatformStatus: AccountPlatformStatus) => setFilters((current) => ({ ...current, accountPlatformStatus })),
    setPage: (page: number) => setFilters((current) => ({ ...current, page })),
    reset,
  };
}
