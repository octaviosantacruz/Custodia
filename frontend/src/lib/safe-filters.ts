import type { AccountPlatformStatus, ClassificationStatus, SafeHealthFilter, WorkflowStatus } from '../types/safe';

export type SafeFilterValues = {
  search: string;
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
  accountPlatformStatus: AccountPlatformStatus;
  page: number;
};

export const EMPTY_SAFE_FILTERS: SafeFilterValues = {
  search: '', workflowFilter: '', classificationFilter: '', accountTypeFilter: '', inventoryScopeFilter: '',
  qualityFilter: '', scopeHintFilter: '', healthFilter: '', nextActionFilter: '', businessUnitFilter: '',
  responsibleFilter: '', accountPlatformStatus: '', page: 0,
};
