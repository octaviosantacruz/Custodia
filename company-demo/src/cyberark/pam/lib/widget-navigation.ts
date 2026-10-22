import type { SearchResult } from '../../../cross/lib/search-api';
import type { DashboardWidget } from './dashboard-metrics';
import type { AnalyticsBucket, ClassificationStatus, WorkflowStatus } from '../types/safe';
import type { ConnectionCoverageFilter } from '../../../cross/types/connection';
import { EMPTY_SAFE_FILTERS, type SafeFilterValues } from './safe-filters.ts';

export type WidgetNavigation =
  | { workspace: 'safes'; filters: Partial<SafeFilterValues>; reset?: boolean }
  | { workspace: 'assets'; assetsSeed: { search: string; environment: string; coverage: ConnectionCoverageFilter | '' } };

export type SearchNavigation =
  | { workspace: 'safes'; filters: Partial<SafeFilterValues> }
  | { workspace: 'sia' | 'graph' | 'roles' | 'identity'; query: string; identitySection?: 'users' | 'roles' }
  | { workspace: 'assets'; assetsSeed: { search: string; environment: string; coverage: ConnectionCoverageFilter | '' } };

export function selectSearchResult(result: SearchResult): SearchNavigation {
  if (result.type === 'safe') return { workspace: 'safes', filters: { ...EMPTY_SAFE_FILTERS, search: result.label } };
  if (result.type === 'account') return { workspace: 'safes', filters: { ...EMPTY_SAFE_FILTERS, search: result.detail.replace(/^Safe:\s*/, '') } };
  if (result.type === 'sia_policy') return { workspace: 'sia', query: result.label };
  if (result.type === 'connection') return { workspace: 'assets', assetsSeed: { search: result.detail.split(' · ')[0], environment: '', coverage: '' } };
  if (result.type === 'pam_user') return { workspace: 'graph', query: result.label };
  if (result.type === 'pam_role') return { workspace: 'roles', query: result.label };
  return { workspace: 'identity', query: result.label, identitySection: result.type === 'identity_role' ? 'roles' : 'users' };
}

export function navigateFromWidget(widget: DashboardWidget, bucket?: AnalyticsBucket): WidgetNavigation | null {
  if (widget.measure === 'cyberark_compliance') return null;
  if (bucket?.key === 'Otros' && !bucket.filter_value) return null;
  if (['connections', 'pam_sia_coverage', 'zsp_coverage', 'kr2_connection_coverage'].includes(widget.measure)) {
    return { workspace: 'assets', assetsSeed: { search: '', environment: '', coverage: '' } };
  }
  if (widget.measure === 'kr1_safe_bu_coverage') {
    return { workspace: 'safes', filters: { ...EMPTY_SAFE_FILTERS, businessUnitFilter: 'unassigned', page: 0 }, reset: false };
  }
  if (widget.measure === 'safe_account_coverage') {
    return { workspace: 'safes', filters: { ...EMPTY_SAFE_FILTERS, healthFilter: 'no_accounts', page: 0 }, reset: false };
  }
  if (widget.measure === 'account_platform_coverage') {
    return { workspace: 'safes', reset: false, filters: { accountPlatformStatus: 'without_platform', page: 0 } };
  }

  const filters: Partial<SafeFilterValues> = {
    ...EMPTY_SAFE_FILTERS,
    workflowFilter: widget.filters.workflow_status,
    classificationFilter: widget.filters.classification_status,
    inventoryScopeFilter: widget.filters.inventory_scope,
    qualityFilter: widget.filters.data_quality_status,
    healthFilter: widget.filters.health_filter,
  };
  const filterValue = bucket?.filter_value ?? bucket?.key ?? '';
  const dimension = bucket && widget.chart?.group_by;
  if (dimension === 'workflow_status') filters.workflowFilter = filterValue as WorkflowStatus;
  if (dimension === 'classification_status') filters.classificationFilter = filterValue as ClassificationStatus;
  if (dimension === 'inventory_scope') filters.inventoryScopeFilter = filterValue as SafeFilterValues['inventoryScopeFilter'];
  if (dimension === 'data_quality_status') filters.qualityFilter = filterValue as SafeFilterValues['qualityFilter'];
  if (dimension === 'business_unit' || dimension === 'business_unit_inventory') filters.businessUnitFilter = filterValue;
  if (dimension === 'responsible') filters.responsibleFilter = filterValue;
  if (dimension === 'next_action') filters.nextActionFilter = filterValue === 'Sin definir' ? '__empty__' : filterValue;
  if (dimension === 'account_type') filters.accountTypeFilter = filterValue === 'Sin clasificar' ? '__empty__' : filterValue;
  if (dimension === 'safe_accounts_members') filters.search = filterValue;
  if (dimension === 'business_unit_workflow') {
    try {
      const cross = JSON.parse(filterValue) as { business_unit?: string; workflow_status?: WorkflowStatus };
      if (cross.business_unit) filters.businessUnitFilter = cross.business_unit;
      if (cross.workflow_status) filters.workflowFilter = cross.workflow_status;
    } catch { /* Ignore malformed legacy drill-down values. */ }
  }
  if (dimension === 'workflow_next_action') {
    try {
      const cross = JSON.parse(filterValue) as { workflow_status?: WorkflowStatus; next_action?: string };
      if (cross.workflow_status) filters.workflowFilter = cross.workflow_status;
      if (cross.next_action) filters.nextActionFilter = cross.next_action;
    } catch { /* Ignore malformed legacy drill-down values. */ }
  }
  return { workspace: 'safes', filters: { ...filters, accountPlatformStatus: '', page: 0 } };
}
