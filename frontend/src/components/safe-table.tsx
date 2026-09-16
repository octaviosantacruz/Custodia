import { useEffect, useRef, useState } from "react";
import { Save } from 'lucide-react';
import { CompactSelect } from './compact-select';
import { SafeTableRow } from './safe-table-row';
import { SafeTableFilters } from './safe-table-filters';
import { LoadMore } from './load-more';
import { StatusGlossary } from './status-glossary';
import { StateBlock } from './state-block';
import { OverflowActions } from './overflow-actions';
import { formatNumber, nextActionOptions, workflowLabel, workflowStatusesFromCounts, WORKFLOW_STATUSES } from '../lib/format';
import type { Account, AccountPlatformStatus, Analytics, ClassificationStatus, SafeHealthFilter, SafeRow, WorkflowStatus } from '../types/safe';

export type SafeTableProps = {
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
  accountTypes: { key: string; count: number; safes: number }[];
  catalogs: { business_units: { business_unit_id: number; unit_code: string; unit_name: string; is_active?: boolean }[]; responsibles: { responsible_id: number; display_name: string; email: string; is_active?: boolean }[] };
  actionOptions: string[];
  savingSafeNumber: number | null;
  savedSafeNumber: number | null;
  selectedSafeNumber: number | null;
  onSelect: (safeNumber: number) => void;
  onLoadAccounts: (safeNumber: number) => Promise<{ rows: Account[]; total: number }>;
  onLoadAccountsPage: (limit: number, offset: number, q: string, platformStatus: AccountPlatformStatus) => Promise<{ rows: Account[]; total: number }>;
  accountPlatformStatus: AccountPlatformStatus;
  onAccountPlatformChange: (value: AccountPlatformStatus) => void;
  onSearchChange: (value: string) => void;
  onWorkflowChange: (value: WorkflowStatus | '') => void;
  onClassificationChange: (value: ClassificationStatus | '') => void;
  onAccountTypeChange: (value: string) => void;
  onInventoryScopeChange: (value: 'pending' | 'business' | 'internal' | '') => void;
  onQualityChange: (value: 'pending' | 'clean' | 'obsolete' | 'duplicate' | '') => void;
  onScopeHintChange: (value: '' | 'possible_internal_accounts_safe') => void;
  onHealthChange: (value: SafeHealthFilter) => void;
  onNextActionChange: (value: string) => void;
  onBusinessUnitChange: (value: string) => void;
  onResponsibleChange: (value: string) => void;
  onClearFilters: () => void;
  onPageChange: (page: number) => void;
  onQuickUpdate: (safe: SafeRow, updates: { workflow_status?: WorkflowStatus; next_action?: string | null }) => void;
  onAssignmentSave: (safe: SafeRow, assignment: { business_unit_id: number | null; responsible_id: number | null }) => Promise<void>;
  onBulkAssignmentSave: (rows: SafeRow[], changes: { business_unit_id: number | null | undefined; responsible_id: number | null | undefined }) => Promise<number[]>;
  onAddBusinessUnit: () => void | Promise<void>;
  onAddResponsible: () => void | Promise<void>;
  canExport: boolean;
  onExport: () => void;
  onExportAccounts: (search: string, platformStatus: AccountPlatformStatus) => void;
  canManage: boolean;
  onUpdateAccountType: (account: Account, value: Account['inventory_account_type']) => Promise<Account | null>;
  onSafeAccountTypeChange: (safe: SafeRow, value: 'nominal' | 'no_nominal' | 'internal') => Promise<void>;
  onBulkClassificationSave: (rows: SafeRow[], changes: { account_type_classification?: 'nominal' | 'no_nominal' | 'internal'; workflow_status?: WorkflowStatus; next_action?: string | null }) => Promise<number[]>;
};


export function SafeTable({
  safes,
  loading,
  total,
  page,
  pageSize,
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
  analytics,
  accountTypes,
  catalogs,
  actionOptions,
  savingSafeNumber,
  savedSafeNumber,
  selectedSafeNumber,
  onSelect,
  onLoadAccounts,
  onSearchChange,
  onWorkflowChange,
  onClassificationChange,
  onAccountTypeChange,
  onInventoryScopeChange,
  onQualityChange,
  onScopeHintChange,
  onHealthChange,
  onNextActionChange,
  onBusinessUnitChange,
  onResponsibleChange,
  onClearFilters,
  onPageChange,
  onQuickUpdate,
  onAssignmentSave,
  onBulkAssignmentSave,
  onAddBusinessUnit,
  onAddResponsible,
  canExport,
  onExport,
  canManage,
  onSafeAccountTypeChange,
  onBulkClassificationSave,
}: SafeTableProps) {
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<number, { business_unit_id: number | null; responsible_id: number | null }>>({});
  const [expandedSafes, setExpandedSafes] = useState<Set<number>>(new Set());
  const [accountsBySafe, setAccountsBySafe] = useState<Record<number, { rows: Account[]; total: number }>>({});
  const [accountsLoading, setAccountsLoading] = useState<Set<number>>(new Set());
  const [accountsError, setAccountsError] = useState<Record<number, string>>({});
  const [checkedSafes, setCheckedSafes] = useState<Set<number>>(new Set());
  const [bulkUnit, setBulkUnit] = useState('__unchanged__');
  const [bulkResponsible, setBulkResponsible] = useState('__unchanged__');
  const [bulkAccountType, setBulkAccountType] = useState('__unchanged__');
  const [bulkStatus, setBulkStatus] = useState('__unchanged__');
  const [bulkAction, setBulkAction] = useState('__unchanged__');
  const [bulkApplying, setBulkApplying] = useState(false);
  useEffect(() => { if (page === 0) setCheckedSafes(new Set()); }, [page]);
  const toggleCheck = (safeNumber: number) => setCheckedSafes((current) => {
    const next = new Set(current);
    if (next.has(safeNumber)) next.delete(safeNumber); else next.add(safeNumber);
    return next;
  });
  const allLoadedChecked = safes.length > 0 && safes.every((safe) => checkedSafes.has(safe.safe_number));
  const toggleCheckAllLoaded = () => setCheckedSafes(allLoadedChecked ? new Set() : new Set(safes.map((safe) => safe.safe_number)));
  const clearBulkSelection = () => { setCheckedSafes(new Set()); setBulkUnit('__unchanged__'); setBulkResponsible('__unchanged__'); setBulkAccountType('__unchanged__'); setBulkStatus('__unchanged__'); setBulkAction('__unchanged__'); };
  const applyBulkAssignment = async () => {
    const rows = safes.filter((safe) => checkedSafes.has(safe.safe_number));
    if (!rows.length) return;
    setBulkApplying(true);
    try {
      const failed = await onBulkAssignmentSave(rows, {
        business_unit_id: bulkUnit === '__unchanged__' ? undefined : (bulkUnit === '' ? null : Number(bulkUnit)),
        responsible_id: bulkResponsible === '__unchanged__' ? undefined : (bulkResponsible === '' ? null : Number(bulkResponsible)),
      });
      setCheckedSafes(new Set(failed));
      setBulkUnit('__unchanged__');
      setBulkResponsible('__unchanged__');
    } finally {
      setBulkApplying(false);
    }
  };
  const applyBulkClassification = async () => {
    const rows = safes.filter((safe) => checkedSafes.has(safe.safe_number));
    if (!rows.length) return;
    const failed = await onBulkClassificationSave(rows, {
      account_type_classification: bulkAccountType === '__unchanged__' ? undefined : bulkAccountType as 'nominal' | 'no_nominal' | 'internal',
      workflow_status: bulkStatus === '__unchanged__' ? undefined : bulkStatus as WorkflowStatus,
      next_action: bulkAction === '__unchanged__' ? undefined : (bulkAction || null),
    });
    setCheckedSafes(new Set(failed));
    setBulkAccountType('__unchanged__'); setBulkStatus('__unchanged__'); setBulkAction('__unchanged__');
  };
  const fetchAccounts = async (safeNumber: number) => {
    setAccountsLoading((current) => new Set(current).add(safeNumber));
    setAccountsError((current) => { const next = { ...current }; delete next[safeNumber]; return next; });
    try {
      const result = await onLoadAccounts(safeNumber);
      setAccountsBySafe((current) => ({ ...current, [safeNumber]: result }));
    } catch {
      setAccountsError((current) => ({ ...current, [safeNumber]: 'No se pudieron cargar las cuentas de esta Safe.' }));
    } finally {
      setAccountsLoading((current) => { const next = new Set(current); next.delete(safeNumber); return next; });
    }
  };
  const toggleAccounts = async (safeNumber: number) => {
    if (expandedSafes.has(safeNumber)) {
      setExpandedSafes((current) => { const next = new Set(current); next.delete(safeNumber); return next; });
      return;
    }
    setExpandedSafes((current) => new Set(current).add(safeNumber));
    if (accountsBySafe[safeNumber]) return;
    await fetchAccounts(safeNumber);
  };
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const [headerStuck, setHeaderStuck] = useState(false);
  useEffect(() => {
    const sentinel = stickySentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderStuck(!entry.isIntersecting),
      { root: tableWrapRef.current, threshold: [1] },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return <section className="list-panel database-surface">
    <SafeTableFilters
      search={search} workflowFilter={workflowFilter} classificationFilter={classificationFilter} accountTypeFilter={accountTypeFilter}
      inventoryScopeFilter={inventoryScopeFilter} qualityFilter={qualityFilter} scopeHintFilter={scopeHintFilter} healthFilter={healthFilter}
      businessUnitFilter={businessUnitFilter} responsibleFilter={responsibleFilter} analytics={analytics}
      accountTypes={accountTypes} canExport={canExport} onSearchChange={onSearchChange}
      onWorkflowChange={onWorkflowChange} onClassificationChange={onClassificationChange} onAccountTypeChange={onAccountTypeChange}
      onInventoryScopeChange={onInventoryScopeChange} onQualityChange={onQualityChange} onScopeHintChange={onScopeHintChange} onHealthChange={onHealthChange}
      onBusinessUnitChange={onBusinessUnitChange} onResponsibleChange={onResponsibleChange}
      onClearFilters={onClearFilters} onExport={onExport}
    />
    <div className="table-hint">Seleccioná una fila para abrir el detalle. Usá “Ver cuentas” para expandir el inventario inline; estado y acción se pueden cambiar directamente.</div>
    {checkedSafes.size > 0 && <div className="bulk-action-bar" role="region" aria-label="Reclasificación masiva">
      <span className="bulk-action-count">{checkedSafes.size} {checkedSafes.size === 1 ? 'seleccionada' : 'seleccionadas'}</span>
      <label>Tipo de cuenta<CompactSelect className="bulk-action-select" value={bulkAccountType} ariaLabel="Tipo de cuenta a aplicar" disabled={bulkApplying} options={[{ value: '__unchanged__', label: 'No cambiar' }, { value: 'nominal', label: 'Nominal' }, { value: 'no_nominal', label: 'No nominal' }, { value: 'internal', label: 'Interno CyberArk' }]} onChange={setBulkAccountType} /></label>
      <label>Estado<CompactSelect className="bulk-action-select" value={bulkStatus} ariaLabel="Estado a aplicar" disabled={bulkApplying} options={[{ value: '__unchanged__', label: 'No cambiar' }, ...WORKFLOW_STATUSES.map((status) => ({ value: status, label: workflowLabel(status) }))]} onChange={setBulkStatus} /></label>
      <label>Acción siguiente<CompactSelect className="bulk-action-select" value={bulkAction} ariaLabel="Acción siguiente a aplicar" disabled={bulkApplying} options={[{ value: '__unchanged__', label: 'No cambiar' }, { value: '', label: 'Sin definir' }, ...nextActionOptions.map((action) => ({ value: action, label: action }))]} onChange={setBulkAction} /></label>
      <label>Unidad<CompactSelect className="bulk-action-select" value={bulkUnit} ariaLabel="Unidad a aplicar" disabled={bulkApplying} options={[{ value: '__unchanged__', label: 'No cambiar' }, { value: '', label: 'Sin asignar' }, ...catalogs.business_units.filter((unit) => unit.is_active !== false).map((unit) => ({ value: String(unit.business_unit_id), label: unit.unit_code }))]} onChange={setBulkUnit} /></label>
      <label>Responsable<CompactSelect className="bulk-action-select" value={bulkResponsible} ariaLabel="Responsable a aplicar" disabled={bulkApplying} options={[{ value: '__unchanged__', label: 'No cambiar' }, { value: '', label: 'Sin asignar' }, ...catalogs.responsibles.filter((person) => person.is_active !== false).map((person) => ({ value: String(person.responsible_id), label: person.display_name }))]} onChange={setBulkResponsible} /></label>
      <OverflowActions
        ariaLabel="Acciones de reclasificación masiva"
        minVisible={0}
        actions={[
          {
            id: 'apply',
            label: bulkApplying ? 'Aplicando...' : `Aplicar a ${checkedSafes.size}`,
            icon: <Save size={14} />,
            tone: 'primary',
            disabled: bulkApplying || (bulkUnit === '__unchanged__' && bulkResponsible === '__unchanged__' && bulkAccountType === '__unchanged__' && bulkStatus === '__unchanged__' && bulkAction === '__unchanged__'),
            onSelect: () => {
              if (bulkUnit !== '__unchanged__' || bulkResponsible !== '__unchanged__') void applyBulkAssignment();
              if (bulkAccountType !== '__unchanged__' || bulkStatus !== '__unchanged__' || bulkAction !== '__unchanged__') void applyBulkClassification();
            },
          },
          { id: 'cancel', label: 'Cancelar selección', disabled: bulkApplying, onSelect: clearBulkSelection },
        ]}
      />
    </div>}
    <div className={'table-wrap' + (headerStuck ? ' header-stuck' : '')} ref={tableWrapRef}><div className="table-sticky-sentinel" ref={stickySentinelRef} aria-hidden="true" /><table className="safe-table"><thead><tr><th><span className="row-select-header"><input type="checkbox" aria-label="Seleccionar todas las Safes cargadas" checked={allLoadedChecked} disabled={bulkApplying || !safes.length} onChange={toggleCheckAllLoaded} /> Safe</span></th><th>Cuentas</th><th>Miembros</th><th><span className="table-column-heading"><span className="table-header-label">Tipo de cuenta<StatusGlossary scope="account_type" compact /></span><CompactSelect className="table-column-filter" value={accountTypeFilter} ariaLabel="Filtrar columna tipo de cuenta" options={[{ value: '', label: 'Todos' }, ...(analytics.account_types.length ? analytics.account_types.map((bucket) => ({ value: bucket.key === 'Sin clasificar' ? '__empty__' : bucket.key, label: `${bucket.key} (${formatNumber(bucket.count)})` })) : accountTypes.map((type) => ({ value: type.key, label: `${type.key} (${formatNumber(type.count)})` })))]} onChange={onAccountTypeChange} /></span></th><th><span className="table-column-heading"><span className="table-header-label">Unidad<StatusGlossary scope="business_unit" compact /></span><CompactSelect className="table-column-filter" value={businessUnitFilter} ariaLabel="Filtrar columna unidad" options={[{ value: '', label: 'Todas' }, ...analytics.business_units.map((bucket) => ({ value: bucket.key, label: `${bucket.label || bucket.key} (${formatNumber(bucket.count)})` }))]} onChange={onBusinessUnitChange} /></span></th><th><span className="table-column-heading"><span className="table-header-label">Responsable<StatusGlossary scope="responsible" compact /></span><CompactSelect className="table-column-filter" value={responsibleFilter} ariaLabel="Filtrar columna responsable" options={[{ value: '', label: 'Todos' }, ...analytics.responsibles.map((bucket) => ({ value: bucket.key, label: `${bucket.label || bucket.key} (${formatNumber(bucket.count)})` }))]} onChange={onResponsibleChange} /></span></th><th className="assignment-save-header"><span className="sr-only">Guardar asignación</span></th><th><span className="table-column-heading"><span className="table-header-label">Estado<StatusGlossary scope="status" compact /></span><CompactSelect className="table-column-filter" value={workflowFilter} ariaLabel="Filtrar columna estado" options={[{ value: '', label: 'Todos' }, ...workflowStatusesFromCounts(analytics.workflow_status, workflowFilter).map((status) => ({ value: status, label: `${workflowLabel(status)} (${formatNumber(analytics.workflow_status.find((bucket) => bucket.key === status)?.count || 0)})` }))]} onChange={(value) => onWorkflowChange(value as WorkflowStatus | '')} /></span></th><th><span className="table-column-heading"><span className="table-header-label">Acción siguiente<StatusGlossary scope="next_action" compact /></span><CompactSelect className="table-column-filter" value={nextActionFilter} ariaLabel="Filtrar columna acción siguiente" options={[{ value: '', label: 'Todas' }, ...analytics.next_actions.map((bucket) => ({ value: bucket.key === 'Sin definir' ? '__empty__' : bucket.key, label: `${bucket.key} (${formatNumber(bucket.count)})` }))]} onChange={onNextActionChange} /></span></th></tr></thead><tbody>
      {loading && !safes.length ? Array.from({ length: 8 }, (_, index) => <tr key={`skeleton-${index}`} className="safe-row-skeleton" aria-hidden={index !== 0}><td colSpan={9}>{index === 0 && <span className="sr-only" role="status">Cargando inventario...</span>}<span className="skeleton-bar" /></td></tr>) : safes.length ? safes.map((safe) => {
        const assignment = assignmentDrafts[safe.safe_number] || { business_unit_id: safe.business_unit_id, responsible_id: safe.responsible_id };
        const assignmentChanged = assignment.business_unit_id !== safe.business_unit_id || assignment.responsible_id !== safe.responsible_id;
        return <SafeTableRow
          key={safe.safe_number}
          safe={safe}
          selected={selectedSafeNumber === safe.safe_number}
          checked={checkedSafes.has(safe.safe_number)}
          bulkDisabled={bulkApplying}
          assignment={assignment}
          assignmentChanged={assignmentChanged}
          expanded={expandedSafes.has(safe.safe_number)}
          accounts={accountsBySafe[safe.safe_number]?.rows || []}
          accountsTotal={accountsBySafe[safe.safe_number]?.total ?? 0}
          accountsLoading={accountsLoading.has(safe.safe_number)}
          accountsError={accountsError[safe.safe_number] || null}
          catalogs={catalogs}
          actionOptions={actionOptions}
          saving={savingSafeNumber === safe.safe_number}
          saved={savedSafeNumber === safe.safe_number}
          onSelect={() => onSelect(safe.safe_number)}
          onToggleCheck={() => toggleCheck(safe.safe_number)}
          onToggleAccounts={() => void toggleAccounts(safe.safe_number)}
          onRetryAccounts={() => void fetchAccounts(safe.safe_number)}
          onAssignmentChange={(next) => setAssignmentDrafts((current) => ({ ...current, [safe.safe_number]: next }))}
          onAssignmentSave={async () => {
            await onAssignmentSave(safe, assignment);
            setAssignmentDrafts((current) => { const next = { ...current }; delete next[safe.safe_number]; return next; });
          }}
          onQuickUpdate={(updates) => onQuickUpdate(safe, updates)}
          onAccountTypeChange={(value) => onSafeAccountTypeChange(safe, value)}
          canManage={canManage}
          onAddBusinessUnit={onAddBusinessUnit}
          onAddResponsible={onAddResponsible}
        />;
      }) : <tr><td colSpan={9} className="state-cell"><StateBlock variant="no-results" title="Sin resultados" hint="Ninguna Safe coincide con los filtros activos. Ajustá la búsqueda o limpiá los filtros." /></td></tr>}
    </tbody></table></div>
    <LoadMore loaded={safes.length} total={total} pageSize={pageSize} loading={loading && page > 0} onLoadMore={() => onPageChange(page + 1)} />
  </section>;
}
