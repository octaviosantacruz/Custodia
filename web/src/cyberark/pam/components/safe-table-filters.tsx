import { Download, Search, X } from 'lucide-react';
import { CompactSelect } from '../../../cross/components/compact-select';
import { formatNumber } from '../../../cross/lib/format';
import { workflowLabel, workflowStatusesFromCounts } from '../lib/safe-labels';
import { buildSafeFilterChips, clearSafeFilter, type SafeFilterChipKeyWithAccountSearch, type SafeFilterChipValues } from '../lib/safe-filter-chips';
import type { Analytics, ClassificationStatus, SafeHealthFilter, WorkflowStatus } from '../types/safe';
import './safe-table.css';
import { t } from '../../../cross/i18n/index.ts';

type SafeTableFiltersProps = {
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
  canExport: boolean;
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
  onExport: () => void;
};

export function SafeTableFilters({
  search, includeAccounts, workflowFilter, classificationFilter, accountTypeFilter, inventoryScopeFilter, qualityFilter,
  scopeHintFilter, healthFilter, nextActionFilter, businessUnitFilter, responsibleFilter, analytics, accountTypes, canExport, onSearchChange, onWorkflowChange,
  onIncludeAccountsChange, onClassificationChange, onAccountTypeChange, onInventoryScopeChange, onQualityChange,
  onScopeHintChange, onHealthChange, onNextActionChange, onBusinessUnitChange, onResponsibleChange, onClearFilters, onExport,
}: SafeTableFiltersProps) {
  const filters: SafeFilterChipValues = {
    includeAccounts, workflowFilter, classificationFilter, accountTypeFilter, inventoryScopeFilter, qualityFilter, nextActionFilter,
    scopeHintFilter, healthFilter, businessUnitFilter, responsibleFilter,
  };
  const statusCounts = new Map(analytics.workflow_status.map((bucket) => [bucket.key, bucket.count]));
  const workflowOptions = workflowStatusesFromCounts(analytics.workflow_status, workflowFilter);
  const observedAccountTypes = analytics.account_types.length
    ? analytics.account_types.map((bucket) => ({ value: bucket.key === 'Sin clasificar' ? '__empty__' : bucket.key, label: bucket.key }))
    : accountTypes.map((type) => ({ value: type.key, label: type.key }));
  const businessUnitOptions = analytics.business_units.map((bucket) => ({ value: bucket.key, label: bucket.label || bucket.key }));
  const responsibleOptions = analytics.responsibles.map((bucket) => ({ value: bucket.key, label: bucket.label || bucket.key }));
  const chips = buildSafeFilterChips(filters, {
    accountTypeFilter: new Map(observedAccountTypes.map((option) => [option.value, option.label])),
    businessUnitFilter: new Map(businessUnitOptions.map((option) => [option.value, option.label])),
    responsibleFilter: new Map(responsibleOptions.map((option) => [option.value, option.label])),
    nextActionFilter: new Map(analytics.next_actions.map((bucket) => [
      bucket.key === 'Sin definir' ? '__empty__' : bucket.key,
      bucket.label || bucket.key,
    ])),
  });
  // Estado, unidad, responsable, tipo de cuenta y acción siguiente viven en la barra principal.
  const moreFilterCount = [classificationFilter, inventoryScopeFilter, qualityFilter, scopeHintFilter, healthFilter].filter(Boolean).length;
  // FE-MOTION-001: the counter span below is keyed by this derived count, so its
  // pulse restarts exactly when the number changes (no state, ref or effect).
  const activeFilters = moreFilterCount;

  const removeFilter = (key: SafeFilterChipKeyWithAccountSearch) => {
    const cleared = clearSafeFilter(filters, key);
    switch (key) {
      case 'workflowFilter': onWorkflowChange(cleared.workflowFilter); break;
      case 'classificationFilter': onClassificationChange(cleared.classificationFilter); break;
      case 'accountTypeFilter': onAccountTypeChange(cleared.accountTypeFilter); break;
      case 'inventoryScopeFilter': onInventoryScopeChange(cleared.inventoryScopeFilter); break;
      case 'qualityFilter': onQualityChange(cleared.qualityFilter); break;
      case 'scopeHintFilter': onScopeHintChange(cleared.scopeHintFilter); break;
      case 'healthFilter': onHealthChange(cleared.healthFilter); break;
      case 'nextActionFilter': onNextActionChange(cleared.nextActionFilter); break;
      case 'businessUnitFilter': onBusinessUnitChange(cleared.businessUnitFilter); break;
      case 'responsibleFilter': onResponsibleChange(cleared.responsibleFilter); break;
      case 'includeAccounts': onIncludeAccountsChange(cleared.includeAccounts); break;
    }
  };

  return <div className="safe-table-filters">
    <div className="safe-filter-toolbar">
      <div className="safe-filter-search-group" role="group" aria-label={t('Búsqueda del inventario')}>
        <label className="search-box"><Search size={16} /><input type="search" aria-label={t('Buscar Safes por nombre o Safe URL ID')} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={t('Buscar por nombre o Safe URL ID')} /></label>
        <label className="safe-include-accounts"><input type="checkbox" checked={includeAccounts} onChange={(event) => onIncludeAccountsChange(event.target.checked)} /> {t('Incluir cuentas')}</label>
      </div>
      <div className="safe-filter-primary-group" role="group" aria-label={t('Filtros principales')}>
        <label>{t('Estado')}<CompactSelect value={workflowFilter} ariaLabel={t('Filtrar por estado')} options={[{ value: '', label: t('Todos') }, ...workflowOptions.map((status) => ({ value: status, label: `${workflowLabel(status)} (${formatNumber(statusCounts.get(status) || 0)})` }))]} onChange={(value) => onWorkflowChange(value as WorkflowStatus | '')} /></label>
        <label>{t('Unidad')}<CompactSelect value={businessUnitFilter} ariaLabel={t('Filtrar por unidad')} options={[{ value: '', label: t('Todas') }, ...businessUnitOptions.map((option) => ({ ...option, label: `${option.label} (${formatNumber(analytics.business_units.find((bucket) => bucket.key === option.value)?.count || 0)})` }))]} onChange={onBusinessUnitChange} /></label>
        <label>{t('Responsable')}<CompactSelect value={responsibleFilter} ariaLabel={t('Filtrar por responsable')} options={[{ value: '', label: t('Todos') }, ...responsibleOptions.map((option) => ({ ...option, label: `${option.label} (${formatNumber(analytics.responsibles.find((bucket) => bucket.key === option.value)?.count || 0)})` }))]} onChange={onResponsibleChange} /></label>
        <label>{t('Tipo de cuenta')}<CompactSelect value={accountTypeFilter} ariaLabel={t('Filtrar por tipo de cuenta')} options={[{ value: '', label: t('Todos') }, ...observedAccountTypes.map((option) => ({ value: option.value, label: `${option.label} (${formatNumber(analytics.account_types.find((bucket) => (bucket.key === 'Sin clasificar' ? '__empty__' : bucket.key) === option.value)?.count ?? accountTypes.find((type) => type.key === option.value)?.count ?? 0)})` }))]} onChange={onAccountTypeChange} /></label>
        <label>{t('Acción siguiente')}<CompactSelect value={nextActionFilter} ariaLabel={t('Filtrar por acción siguiente')} options={[{ value: '', label: t('Todas') }, ...analytics.next_actions.map((bucket) => ({ value: bucket.key === 'Sin definir' ? '__empty__' : bucket.key, label: `${bucket.label || bucket.key} (${formatNumber(bucket.count)})` }))]} onChange={onNextActionChange} /></label>
      </div>
      {canExport && <button className="button subtle export-button" type="button" onClick={onExport}><Download size={15} /> {t('Exportar CSV')}</button>}
    </div>
    <details className="safe-filter-details">
      <summary><span>{t('Más filtros')}</span><span key={activeFilters} className="filter-summary">({formatNumber(activeFilters)})</span></summary>
      <div className="safe-filter-more-row">
        <label>{t('Clasificación')}<CompactSelect value={classificationFilter} ariaLabel={t('Filtrar por clasificación')} options={[{ value: '', label: t('Todas') }, { value: 'pending', label: t('Pendiente') }, { value: 'assigned', label: t('Asignada') }, { value: 'review', label: t('Revisión') }]} onChange={(value) => onClassificationChange(value as ClassificationStatus | '')} /></label>
        <label>{t('Alcance')}<CompactSelect value={inventoryScopeFilter} ariaLabel={t('Filtrar por alcance del inventario')} options={[{ value: '', label: t('Todos') }, { value: 'pending', label: t('Pendiente') }, { value: 'business', label: t('Negocio') }, { value: 'internal', label: t('Interno CyberArk') }]} onChange={(value) => onInventoryScopeChange(value as 'pending' | 'business' | 'internal' | '')} /></label>
        <label>{t('Calidad')}<CompactSelect value={qualityFilter} ariaLabel={t('Filtrar por calidad')} options={[{ value: '', label: t('Todas') }, { value: 'pending', label: t('Pendiente') }, { value: 'clean', label: t('Depurado') }, { value: 'obsolete', label: t('Obsoleto') }, { value: 'duplicate', label: t('Duplicado') }]} onChange={(value) => onQualityChange(value as 'pending' | 'clean' | 'obsolete' | 'duplicate' | '')} /></label>
        <label>{t('Revisión')}<CompactSelect value={scopeHintFilter} ariaLabel={t('Filtrar candidatos de revisión')} options={[{ value: '', label: t('Todos') }, { value: 'possible_internal_accounts_safe', label: t('Candidatos internos') }]} onChange={(value) => onScopeHintChange(value as '' | 'possible_internal_accounts_safe')} /></label>
        <label>{t('Safe Health')}<CompactSelect value={healthFilter} ariaLabel={t('Filtrar por Safe Health')} options={[{ value: '', label: t('Todos') }, { value: 'missing_cpm', label: t('Sin CPM') }, { value: 'no_accounts', label: t('Sin cuentas') }, { value: 'retention_unconfigured', label: t('Sin retención/purga') }, { value: 'manage_safe_concentration', label: t('2+ Manage Safe') }]} onChange={(value) => onHealthChange(value as SafeHealthFilter)} /></label>
      </div>
    </details>
    {chips.length > 0 && <div className="safe-active-filters">
      <div className="safe-filter-chip-list" role="list" aria-label={t('Filtros activos')}>
        {chips.map((chip) => <span className="safe-filter-chip" role="listitem" key={chip.key}>
          <span>{chip.label}: {chip.displayValue}</span>
          <button type="button" aria-label={t('Quitar filtro {chip}', { chip: chip.label })} onClick={() => removeFilter(chip.key)}><X size={13} aria-hidden="true" /></button>
        </span>)}
      </div>
      <button className="button subtle safe-filter-clear" type="button" onClick={onClearFilters}>{t('Limpiar filtros')}</button>
    </div>}
  </div>;
}
