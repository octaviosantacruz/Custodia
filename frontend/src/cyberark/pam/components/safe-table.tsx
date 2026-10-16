import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Save } from 'lucide-react';
import { CompactSelect } from '../../../cross/components/compact-select';
import { SafeTableRow } from './safe-table-row';
import { SafeTableFilters } from './safe-table-filters';
import { SafeTableHead } from './safe-table-head';
import { LoadMore } from '../../../cross/components/load-more';
import { useDebouncedValue } from '../../../cross/hooks/use-debounced-value';
import { StateBlock } from '../../../cross/components/state-block';
import { OverflowActions } from './overflow-actions';
import './safe-table.css';
import { formatNumber, nextActionOptions } from '../../../cross/lib/format';
import { workflowLabel, WORKFLOW_STATUSES } from '../lib/safe-labels';
import { SummaryStats } from '../../../cross/components/summary-stats';
import { StackedBar } from '../../../cross/components/stacked-bar';
import { HelpHint } from '../../../cross/components/help-hint';
import type { Account, AccountPlatformStatus, Analytics, ClassificationStatus, SafeClassificationCounts, SafeHealthFilter, SafeRow, WorkflowStatus } from '../types/safe';

const EMPTY_ACCOUNTS: Account[] = [];

export type SafeTableProps = {
  safes: SafeRow[];
  loading: boolean;
  /** A failed filtered read: shown instead of "Sin resultados" and with retry. */
  loadError?: string;
  onRetry?: () => void;
  total: number;
  /** Classification breakdown of the whole filtered result, not just the loaded rows. */
  classificationCounts: SafeClassificationCounts;
  page: number;
  pageSize: number;
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
  analytics: Analytics;
  accountTypes: { key: string; count: number; safes: number }[];
  catalogs: { business_units: { business_unit_id: number; unit_code: string; unit_name: string; is_active?: boolean }[]; responsibles: { responsible_id: number; display_name: string; email: string; is_active?: boolean }[] };
  actionOptions: string[];
  savingSafeNumber: number | null;
  savedSafeNumber: number | null;
  selectedSafeNumber: number | null;
  onSelect: (safeNumber: number) => void;
  onLoadAccounts: (safeNumber: number, q?: string) => Promise<{ rows: Account[]; total: number }>;
  accountPlatformStatus: AccountPlatformStatus;
  onAccountPlatformChange: (value: AccountPlatformStatus) => void;
  onSearchChange: (value: string) => void;
  onIncludeAccountsChange: (value: boolean) => void;
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
  loadError = '',
  onRetry,
  total,
  classificationCounts,
  page,
  pageSize,
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
  onIncludeAccountsChange,
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
  const [accountsQueryBySafe, setAccountsQueryBySafe] = useState<Record<number, string>>({});
  const [accountsLoading, setAccountsLoading] = useState<Set<number>>(new Set());
  const [accountsError, setAccountsError] = useState<Record<number, string>>({});
  const [checkedSafes, setCheckedSafes] = useState<Set<number>>(new Set());
  const [bulkUnit, setBulkUnit] = useState('__unchanged__');
  const [bulkResponsible, setBulkResponsible] = useState('__unchanged__');
  const [bulkAccountType, setBulkAccountType] = useState('__unchanged__');
  const [bulkStatus, setBulkStatus] = useState('__unchanged__');
  const [bulkAction, setBulkAction] = useState('__unchanged__');
  const [bulkApplying, setBulkApplying] = useState(false);
  const assignmentFallbacks = useMemo(() => new Map(
    safes.map((safe) => [safe.safe_number, { business_unit_id: safe.business_unit_id, responsible_id: safe.responsible_id }]),
  ), [safes]);
  /* Refs keep row callbacks stable: with them as dependencies, expanding one
     row, loading its accounts or saving an assignment changed the callback
     identity and re-rendered every loaded row (measured: 465-row table). */
  const expandedSafesRef = useRef(expandedSafes);
  useEffect(() => { expandedSafesRef.current = expandedSafes; }, [expandedSafes]);
  const accountsBySafeRef = useRef(accountsBySafe);
  useEffect(() => { accountsBySafeRef.current = accountsBySafe; }, [accountsBySafe]);
  const accountsQueryBySafeRef = useRef(accountsQueryBySafe);
  useEffect(() => { accountsQueryBySafeRef.current = accountsQueryBySafe; }, [accountsQueryBySafe]);
  const activeAccountFetches = useRef(new Map<number, string>());
  const safesRef = useRef(safes);
  useEffect(() => { safesRef.current = safes; }, [safes]);
  /* Shared option lists: rebuilt per row before, now built once per catalog. */
  const unitOptions = useMemo(() => [
    { value: '', label: 'Sin asignar' },
    ...catalogs.business_units.filter((unit) => unit.is_active !== false).map((unit) => ({ value: String(unit.business_unit_id), label: unit.unit_code })),
  ], [catalogs.business_units]);
  const responsibleOptions = useMemo(() => [
    { value: '', label: 'Sin asignar' },
    ...catalogs.responsibles.filter((person) => person.is_active !== false).map((person) => ({ value: String(person.responsible_id), label: person.display_name })),
  ], [catalogs.responsibles]);
  useEffect(() => { if (page === 0) setCheckedSafes(new Set()); }, [page]);
  const toggleCheck = useCallback((safeNumber: number) => setCheckedSafes((current) => {
    const next = new Set(current);
    if (next.has(safeNumber)) next.delete(safeNumber); else next.add(safeNumber);
    return next;
  }), []);
  const allLoadedChecked = safes.length > 0 && safes.every((safe) => checkedSafes.has(safe.safe_number));
  const classificationProgress = { ...classificationCounts, total: classificationCounts.assigned + classificationCounts.review + classificationCounts.pending };
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
  /* Debounced so typing does not reload the accounts of every expanded Safe on each key. */
  const debouncedSearch = useDebouncedValue(search, 300);
  const accountSearch = includeAccounts ? debouncedSearch.trim() : '';
  const previousAccountSearch = useRef(accountSearch);
  const fetchAccounts = useCallback(async (safeNumber: number) => {
    activeAccountFetches.current.set(safeNumber, accountSearch);
    setAccountsLoading((current) => new Set(current).add(safeNumber));
    setAccountsError((current) => { const next = { ...current }; delete next[safeNumber]; return next; });
    try {
      const result = await onLoadAccounts(safeNumber, accountSearch);
      if (activeAccountFetches.current.get(safeNumber) === accountSearch) {
        setAccountsBySafe((current) => ({ ...current, [safeNumber]: result }));
        setAccountsQueryBySafe((current) => ({ ...current, [safeNumber]: accountSearch }));
      }
    } catch {
      if (activeAccountFetches.current.get(safeNumber) === accountSearch) {
        setAccountsError((current) => ({ ...current, [safeNumber]: 'No se pudieron cargar las cuentas de esta Safe.' }));
      }
    } finally {
      if (activeAccountFetches.current.get(safeNumber) === accountSearch) {
        activeAccountFetches.current.delete(safeNumber);
        setAccountsLoading((current) => { const next = new Set(current); next.delete(safeNumber); return next; });
      }
    }
  }, [accountSearch, onLoadAccounts]);
  const expandedSafesSnapshot = useRef(expandedSafes);
  useEffect(() => {
    const queryChanged = previousAccountSearch.current !== accountSearch;
    const expandedChanged = expandedSafesSnapshot.current !== expandedSafes;
    previousAccountSearch.current = accountSearch;
    expandedSafesSnapshot.current = expandedSafes;
    if (queryChanged) expandedSafes.forEach((safeNumber) => { void fetchAccounts(safeNumber); });
    else if (expandedChanged) {
      expandedSafes.forEach((safeNumber) => {
        if (accountsQueryBySafeRef.current[safeNumber] !== accountSearch) void fetchAccounts(safeNumber);
      });
    }
  }, [accountSearch, expandedSafes, fetchAccounts]);
  const toggleAccounts = useCallback((safeNumber: number) => {
    if (expandedSafesRef.current.has(safeNumber)) {
      setExpandedSafes((current) => { const next = new Set(current); next.delete(safeNumber); return next; });
      return;
    }
    setExpandedSafes((current) => new Set(current).add(safeNumber));
    if (!accountsBySafeRef.current[safeNumber] || accountsQueryBySafeRef.current[safeNumber] !== accountSearch) {
      void fetchAccounts(safeNumber);
    }
  }, [accountSearch, fetchAccounts]);
  const handleSelect = useCallback((safeNumber: number) => onSelect(safeNumber), [onSelect]);
  const handleToggleCheck = toggleCheck;
  const handleToggleAccounts = toggleAccounts;
  const handleRetryAccounts = fetchAccounts;
  const handleAssignmentChange = useCallback((safeNumber: number, next: { business_unit_id: number | null; responsible_id: number | null }) => {
    setAssignmentDrafts((current) => ({ ...current, [safeNumber]: next }));
  }, []);
  const handleAssignmentSave = useCallback(async (safeNumber: number, assignment: { business_unit_id: number | null; responsible_id: number | null }) => {
    const safe = safesRef.current.find((row) => row.safe_number === safeNumber);
    if (!safe) return;
    await onAssignmentSave(safe, assignment);
    setAssignmentDrafts((current) => { const next = { ...current }; delete next[safeNumber]; return next; });
  }, [onAssignmentSave]);
  const handleQuickUpdate = useCallback((safe: SafeRow, updates: { workflow_status?: WorkflowStatus; next_action?: string | null }) => onQuickUpdate(safe, updates), [onQuickUpdate]);
  const handleAccountTypeChange = useCallback((safe: SafeRow, value: 'nominal' | 'no_nominal' | 'internal') => onSafeAccountTypeChange(safe, value), [onSafeAccountTypeChange]);
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

  return <section className="list-panel database-surface" data-testid="safe-table">
    <SafeTableFilters
      search={search} includeAccounts={includeAccounts} workflowFilter={workflowFilter} classificationFilter={classificationFilter} accountTypeFilter={accountTypeFilter}
      inventoryScopeFilter={inventoryScopeFilter} qualityFilter={qualityFilter} scopeHintFilter={scopeHintFilter} healthFilter={healthFilter} nextActionFilter={nextActionFilter}
      businessUnitFilter={businessUnitFilter} responsibleFilter={responsibleFilter} analytics={analytics}
      accountTypes={accountTypes} canExport={canExport} onSearchChange={onSearchChange} onIncludeAccountsChange={onIncludeAccountsChange}
      onWorkflowChange={onWorkflowChange} onClassificationChange={onClassificationChange} onAccountTypeChange={onAccountTypeChange}
      onInventoryScopeChange={onInventoryScopeChange} onQualityChange={onQualityChange} onScopeHintChange={onScopeHintChange} onHealthChange={onHealthChange}
      onNextActionChange={onNextActionChange}
      onBusinessUnitChange={onBusinessUnitChange} onResponsibleChange={onResponsibleChange}
      onClearFilters={onClearFilters} onExport={onExport}
    />
      <section className="safe-classification-progress" aria-label="Progreso de clasificación de Safes"><div className="safe-classification-progress-heading"><strong>Clasificación de Safes</strong><span>{classificationProgress.total === 1 ? '1 Safe' : `${formatNumber(classificationProgress.total)} Safes`}{safes.length < total ? ` · ${formatNumber(safes.length)} cargadas en la tabla` : ''}</span><HelpHint label="Progreso de clasificación visible"><p>Cuenta todas las Safes del resultado con los filtros activos (menos el de clasificación), estén o no cargadas en la tabla. Hacé clic en un estado para filtrar la tabla.</p></HelpHint></div><SummaryStats ariaLabel="Estados de clasificación de las Safes" stats={[{ key: 'assigned', label: 'Asignadas', value: formatNumber(classificationProgress.assigned), active: classificationFilter === 'assigned', onSelect: () => onClassificationChange(classificationFilter === 'assigned' ? '' : 'assigned') }, { key: 'review', label: 'En revisión', value: formatNumber(classificationProgress.review), active: classificationFilter === 'review', onSelect: () => onClassificationChange(classificationFilter === 'review' ? '' : 'review') }, { key: 'pending', label: 'Pendientes', value: formatNumber(classificationProgress.pending), active: classificationFilter === 'pending', onSelect: () => onClassificationChange(classificationFilter === 'pending' ? '' : 'pending') }]} /><StackedBar ariaLabel="Distribución de estados de clasificación de las Safes" total={classificationProgress.total} segments={[{ key: 'assigned', label: 'Asignadas', count: classificationProgress.assigned, tone: 'good' }, { key: 'review', label: 'En revisión', count: classificationProgress.review, tone: 'warn' }, { key: 'pending', label: 'Pendientes', count: classificationProgress.pending, tone: 'muted' }]} /></section>
    {checkedSafes.size > 0 && <div className="bulk-action-bar" role="region" aria-label="Reclasificación masiva">
      <span className="bulk-action-count">{checkedSafes.size} {checkedSafes.size === 1 ? 'seleccionada' : 'seleccionadas'}</span>
      <label>Tipo de cuenta<CompactSelect className="bulk-action-select" value={bulkAccountType} ariaLabel="Tipo de cuenta a aplicar" disabled={bulkApplying} options={[{ value: '__unchanged__', label: 'No cambiar' }, { value: 'nominal', label: 'Nominal' }, { value: 'no_nominal', label: 'No nominal' }, { value: 'internal', label: 'Interno CyberArk' }]} onChange={setBulkAccountType} /></label>
      <label>Estado<CompactSelect className="bulk-action-select" value={bulkStatus} ariaLabel="Estado a aplicar" disabled={bulkApplying} options={[{ value: '__unchanged__', label: 'No cambiar' }, ...WORKFLOW_STATUSES.map((status) => ({ value: status, label: workflowLabel(status) }))]} onChange={setBulkStatus} /></label>
      <label>Acción siguiente<CompactSelect className="bulk-action-select" value={bulkAction} ariaLabel="Acción siguiente a aplicar" disabled={bulkApplying} options={[{ value: '__unchanged__', label: 'No cambiar' }, { value: '', label: 'Sin definir' }, ...nextActionOptions.map((action) => ({ value: action, label: action }))]} onChange={setBulkAction} /></label>
      <label>Unidad<CompactSelect className="bulk-action-select" value={bulkUnit} ariaLabel="Unidad a aplicar" disabled={bulkApplying} options={[{ value: '__unchanged__', label: 'No cambiar' }, ...unitOptions]} onChange={setBulkUnit} /></label>
      <label>Responsable<CompactSelect className="bulk-action-select" value={bulkResponsible} ariaLabel="Responsable a aplicar" disabled={bulkApplying} options={[{ value: '__unchanged__', label: 'No cambiar' }, ...responsibleOptions]} onChange={setBulkResponsible} /></label>
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
    <div className={'table-wrap' + (headerStuck ? ' header-stuck' : '')} ref={tableWrapRef}><div className="table-sticky-sentinel" ref={stickySentinelRef} aria-hidden="true" /><table className="safe-table"><SafeTableHead allLoadedChecked={allLoadedChecked} bulkApplying={bulkApplying} hasSafes={safes.length > 0} onToggleCheckAllLoaded={toggleCheckAllLoaded} /><tbody>
      {loading && !safes.length ? Array.from({ length: 8 }, (_, index) => <tr key={`skeleton-${index}`} className="safe-row-skeleton" aria-hidden={index !== 0}><td colSpan={8}>{index === 0 && <span className="sr-only" role="status">Cargando inventario...</span>}<span className="skeleton-bar" /></td></tr>) : safes.length ? safes.map((safe) => {
        const assignment = assignmentDrafts[safe.safe_number] || assignmentFallbacks.get(safe.safe_number)!;
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
          accounts={accountsBySafe[safe.safe_number]?.rows || EMPTY_ACCOUNTS}
          accountsTotal={accountsBySafe[safe.safe_number]?.total ?? 0}
          accountsLoading={accountsLoading.has(safe.safe_number)}
          accountsError={accountsError[safe.safe_number] || null}
          accountSearch={accountSearch}
          unitOptions={unitOptions}
          responsibleOptions={responsibleOptions}
          actionOptions={actionOptions}
          saving={savingSafeNumber === safe.safe_number}
          saved={savedSafeNumber === safe.safe_number}
          onSelect={handleSelect}
          onToggleCheck={handleToggleCheck}
          onToggleAccounts={handleToggleAccounts}
          onRetryAccounts={handleRetryAccounts}
          onAssignmentChange={handleAssignmentChange}
          onAssignmentSave={handleAssignmentSave}
          onQuickUpdate={handleQuickUpdate}
          onAccountTypeChange={handleAccountTypeChange}
          canManage={canManage}
          onAddBusinessUnit={onAddBusinessUnit}
          onAddResponsible={onAddResponsible}
        />;
      }) : loadError ? <tr><td colSpan={8} className="state-cell"><StateBlock variant="error" title="No se pudo cargar el inventario de Safes" hint={loadError} action={onRetry ? <button type="button" className="button subtle" onClick={onRetry}>Reintentar</button> : undefined} /></td></tr> : <tr><td colSpan={8} className="state-cell"><StateBlock variant="no-results" title="Sin resultados" hint="Ninguna Safe coincide con los filtros activos. Ajustá la búsqueda o limpiá los filtros." /></td></tr>}
    </tbody></table></div>
    <LoadMore loaded={safes.length} total={total} pageSize={pageSize} loading={loading && page > 0} onLoadMore={() => onPageChange(page + 1)} />
  </section>;
}
