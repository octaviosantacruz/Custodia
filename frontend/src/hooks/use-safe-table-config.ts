import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { api } from '../lib/api';
import { nextActionOptions } from '../lib/format';
import type { SafeTableProps } from '../components/safe-table';
import type { Account, AccountPlatformStatus, Analytics, Catalogs, ClassificationStatus, SafeHealthFilter, SafeRow, WorkflowStatus } from '../types/safe';

type UseSafeTableConfigOptions = {
  safes: SafeRow[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
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
  analytics: Analytics;
  catalogs: Catalogs;
  savingSafeNumber: number | null;
  savedSafeNumber: number | null;
  selectedSafeNumber: number | null;
  selectSafe: (safeNumber: number) => Promise<void>;
  setSearch: (value: string) => void;
  setPage: (page: number) => void;
  setWorkflowFilter: (value: WorkflowStatus | '') => void;
  setClassificationFilter: (value: ClassificationStatus | '') => void;
  setAccountTypeFilter: (value: string) => void;
  setInventoryScopeFilter: (value: 'pending' | 'business' | 'internal' | '') => void;
  setQualityFilter: (value: 'pending' | 'clean' | 'obsolete' | 'duplicate' | '') => void;
  setScopeHintFilter: (value: '' | 'possible_internal_accounts_safe') => void;
  setHealthFilter: (value: SafeHealthFilter) => void;
  setNextActionFilter: (value: string) => void;
  setBusinessUnitFilter: (value: string) => void;
  setResponsibleFilter: (value: string) => void;
  accountPlatformStatus: AccountPlatformStatus;
  setAccountPlatformStatus: (value: AccountPlatformStatus) => void;
  quickUpdate: (safe: SafeRow, updates: { workflow_status?: WorkflowStatus; next_action?: string | null }) => Promise<void>;
  saveAssignment: (safe: SafeRow, assignment: { business_unit_id: number | null; responsible_id: number | null }) => Promise<void>;
  bulkSaveAssignment: (rows: SafeRow[], changes: { business_unit_id: number | null | undefined; responsible_id: number | null | undefined }) => Promise<number[]>;
  openCatalogModal: (kind: 'unit' | 'responsible') => void;
  canExport: boolean;
  exportSafes: () => Promise<void>;
  exportAccounts: (search: string, platformStatus: AccountPlatformStatus) => Promise<void>;
  canManage: boolean;
  setSafes: Dispatch<SetStateAction<SafeRow[]>>;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
};

export function useSafeTableConfig(options: UseSafeTableConfigOptions): SafeTableProps {
  const {
    safes, loading, total, page, pageSize, search, workflowFilter, classificationFilter,
    accountTypeFilter, inventoryScopeFilter, qualityFilter, scopeHintFilter, healthFilter, nextActionFilter, businessUnitFilter, responsibleFilter, analytics, catalogs,
    savingSafeNumber, savedSafeNumber, selectedSafeNumber, selectSafe, setSearch, setPage,
    setWorkflowFilter, setClassificationFilter, setAccountTypeFilter, setInventoryScopeFilter,
    setQualityFilter, setScopeHintFilter, setHealthFilter, setNextActionFilter, setBusinessUnitFilter, setResponsibleFilter, accountPlatformStatus, setAccountPlatformStatus, quickUpdate, saveAssignment, bulkSaveAssignment, openCatalogModal,
    canExport, exportSafes, exportAccounts, canManage, setSafes, onError, onNotice,
  } = options;

  const loadAccountsPage = useCallback(
    (limit: number, offset: number, q: string, platformStatus: AccountPlatformStatus) => api<{ rows: Account[]; total: number }>(`/accounts?limit=${limit}&offset=${offset}&q=${encodeURIComponent(q)}&platform_status=${platformStatus}`),
    [],
  );

  return {
    safes, loading, total, page, pageSize, search, workflowFilter, classificationFilter,
    accountTypeFilter, inventoryScopeFilter, qualityFilter, scopeHintFilter, healthFilter, nextActionFilter, businessUnitFilter, responsibleFilter, analytics,
    accountTypes: catalogs.account_types || [],
    actionOptions: nextActionOptions,
    savingSafeNumber, savedSafeNumber, selectedSafeNumber,
    onSelect: (safeNumber) => void selectSafe(safeNumber),
    onLoadAccounts: async (safeNumber) => {
      const result = await api<{ rows: Account[]; total: number }>(`/safes/${safeNumber}/accounts?limit=200`);
      return { rows: result.rows, total: result.total };
    },
    accountPlatformStatus,
    onAccountPlatformChange: (value) => { setAccountPlatformStatus(value); },
    onLoadAccountsPage: loadAccountsPage,
    onSearchChange: (value) => { setSearch(value); setPage(0); },
    onWorkflowChange: (value) => { setWorkflowFilter(value); setPage(0); },
    onClassificationChange: (value) => { setClassificationFilter(value); setPage(0); },
    onAccountTypeChange: (value) => { setAccountTypeFilter(value); setPage(0); },
    onInventoryScopeChange: (value) => { setInventoryScopeFilter(value); setPage(0); },
    onQualityChange: (value) => { setQualityFilter(value); setPage(0); },
    onScopeHintChange: (value) => { setScopeHintFilter(value); setPage(0); },
    onHealthChange: (value) => { setHealthFilter(value); setPage(0); },
    onNextActionChange: (value) => { setNextActionFilter(value); setPage(0); },
    onBusinessUnitChange: (value) => { setBusinessUnitFilter(value); setPage(0); },
    onResponsibleChange: (value) => { setResponsibleFilter(value); setPage(0); },
    onClearFilters: () => {
      setSearch(''); setWorkflowFilter(''); setClassificationFilter(''); setAccountTypeFilter('');
      setInventoryScopeFilter(''); setQualityFilter(''); setScopeHintFilter(''); setHealthFilter(''); setNextActionFilter(''); setBusinessUnitFilter(''); setResponsibleFilter(''); setAccountPlatformStatus(''); setPage(0);
    },
    onPageChange: setPage,
    onQuickUpdate: (safe, updates) => void quickUpdate(safe, updates),
    catalogs,
    onAssignmentSave: saveAssignment,
    onBulkAssignmentSave: bulkSaveAssignment,
    onAddBusinessUnit: () => openCatalogModal('unit'),
    onAddResponsible: () => openCatalogModal('responsible'),
    canExport,
    onExport: () => void exportSafes(),
    onExportAccounts: (accountSearch: string, platformStatus: AccountPlatformStatus) => void exportAccounts(accountSearch, platformStatus),
    canManage,
    onUpdateAccountType: async (account, value) => {
      try {
        return await api<Account>(`/accounts/${account.safe_number}/${encodeURIComponent(account.account_id)}/classification`, {
          method: 'PATCH',
          body: JSON.stringify({ inventory_account_type: value }),
        });
      } catch (error) {
        onError(error instanceof Error ? error.message : 'No se pudo clasificar la cuenta');
        return null;
      }
    },
    onSafeAccountTypeChange: async (safe, value) => {
      try {
        await api(`/safes/${safe.safe_number}/account-type`, {
          method: 'PATCH',
          body: JSON.stringify({ account_type_classification: value }),
        });
        setSafes((current) => current.map((item) => item.safe_number === safe.safe_number ? { ...item, account_type_classification: value } : item));
        onNotice?.('Tipo de cuenta actualizado');
      } catch (error) {
        onError(error instanceof Error ? error.message : 'No se pudo actualizar el tipo de Safe');
      }
    },
    onBulkClassificationSave: async (rows, changes) => {
      const failed: number[] = [];
      for (const row of rows) {
        try {
          if (changes.account_type_classification) {
            await api(`/safes/${row.safe_number}/account-type`, { method: 'PATCH', body: JSON.stringify({ account_type_classification: changes.account_type_classification }) });
          }
          const nextWorkflow = changes.workflow_status || row.workflow_status;
          const nextAction = nextWorkflow === 'resolved' ? null : (changes.next_action === undefined ? row.next_action : changes.next_action);
          if (changes.workflow_status || changes.next_action !== undefined) {
            await api(`/safes/${row.safe_number}/quick-update`, { method: 'PATCH', body: JSON.stringify({ workflow_status: nextWorkflow, next_action: nextAction }) });
          }
          setSafes((current) => current.map((item) => item.safe_number === row.safe_number ? { ...item, ...(changes.account_type_classification ? { account_type_classification: changes.account_type_classification } : {}), ...(changes.workflow_status ? { workflow_status: nextWorkflow, next_action: nextAction } : {}), ...(changes.next_action !== undefined ? { next_action: nextAction } : {}) } : item));
        } catch {
          failed.push(row.safe_number);
        }
      }
      if (!failed.length) onNotice?.(`Clasificación aplicada a ${rows.length} ${rows.length === 1 ? 'Safe' : 'Safes'}.`);
      else onError(`Se aplicó a ${rows.length - failed.length} de ${rows.length} Safes.`);
      return failed;
    },
  };
}
