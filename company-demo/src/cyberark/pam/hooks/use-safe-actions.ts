import type { Dispatch, SetStateAction } from 'react';
import type { AccountPlatformStatus, Catalogs, SafeHealthFilter, SafeRow, WorkflowStatus } from '../types/safe';
import { useSafeDetail } from './use-safe-detail';
import { useSafeExport } from './use-safe-export';
import { useSafeMutations } from './use-safe-mutations';

type UseSafeActionsOptions = {
  catalogs: Catalogs;
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
  setSafes: Dispatch<SetStateAction<SafeRow[]>>;
  loadDashboard: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

export function useSafeActions(options: UseSafeActionsOptions) {
  const { detail, setDetail, form, setForm, selectSafe } = useSafeDetail({ onError: options.onError });
  const { exportSafes, exportAccounts } = useSafeExport(options);
  const { saving, savingSafeNumber, savedSafeNumber, quickUpdate, saveAssignment, bulkSaveAssignment, saveMetadata } = useSafeMutations({
    catalogs: options.catalogs,
    detail,
    form,
    setDetail,
    setForm,
    setSafes: options.setSafes,
    loadDashboard: options.loadDashboard,
    selectSafe,
    onError: options.onError,
    onNotice: options.onNotice,
  });

  return { detail, setDetail, form, setForm, saving, savingSafeNumber, savedSafeNumber, selectSafe, exportSafes, exportAccounts, quickUpdate, saveAssignment, bulkSaveAssignment, saveMetadata };
}
