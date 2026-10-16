import { download } from '../../../cross/lib/api';
import type { AccountPlatformStatus, SafeHealthFilter, WorkflowStatus } from '../types/safe';

type UseSafeExportOptions = {
  search: string;
  includeAccounts: boolean;
  workflowFilter: WorkflowStatus | '';
  classificationFilter: string;
  accountTypeFilter: string;
  inventoryScopeFilter: string;
  qualityFilter: string;
  scopeHintFilter: string;
  healthFilter: SafeHealthFilter;
  nextActionFilter: string;
  businessUnitFilter: string;
  responsibleFilter: string;
  accountPlatformStatus: AccountPlatformStatus;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

export function useSafeExport({
  search, includeAccounts, workflowFilter, classificationFilter, accountTypeFilter,
  inventoryScopeFilter, qualityFilter, scopeHintFilter, healthFilter, nextActionFilter, accountPlatformStatus, onError, onNotice,
  businessUnitFilter, responsibleFilter,
}: UseSafeExportOptions) {
  const exportSafes = async () => {
    onError('');
    const params = new URLSearchParams({
      q: search, workflow_status: workflowFilter, classification_status: classificationFilter,
      account_type: accountTypeFilter, inventory_scope: inventoryScopeFilter,
      data_quality_status: qualityFilter, scope_hint: scopeHintFilter,
      health_filter: healthFilter,
      next_action: nextActionFilter,
      business_unit: businessUnitFilter,
      responsible: responsibleFilter,
    });
    if (includeAccounts) params.set('include_accounts', 'true');
    try {
      await download('/safes/export.csv?' + params.toString(), 'dshub-safes.csv');
      onNotice('CSV descargado');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo exportar el inventario');
    }
  };

  const exportAccounts = async (search: string, platformStatus: AccountPlatformStatus = accountPlatformStatus) => {
    onError('');
    try {
      await download('/accounts/export.csv?q=' + encodeURIComponent(search) + '&platform_status=' + encodeURIComponent(platformStatus), 'dshub-accounts.csv');
      onNotice('CSV de cuentas descargado');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo exportar las cuentas');
    }
  };

  return { exportSafes, exportAccounts };
}
