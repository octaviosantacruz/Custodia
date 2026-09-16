import { Download, Search } from 'lucide-react';
import { CompactSelect } from './compact-select';
import { formatNumber, workflowLabel, workflowStatusesFromCounts } from '../lib/format';
import type { Analytics, ClassificationStatus, SafeHealthFilter, WorkflowStatus } from '../types/safe';

type SafeTableFiltersProps = {
  search: string;
  workflowFilter: WorkflowStatus | '';
  classificationFilter: ClassificationStatus | '';
  accountTypeFilter: string;
  inventoryScopeFilter: 'pending' | 'business' | 'internal' | '';
  qualityFilter: 'pending' | 'clean' | 'obsolete' | 'duplicate' | '';
  scopeHintFilter: '' | 'possible_internal_accounts_safe';
  healthFilter: SafeHealthFilter;
  businessUnitFilter: string;
  responsibleFilter: string;
  analytics: Analytics;
  accountTypes: { key: string; count: number; safes: number }[];
  canExport: boolean;
  onSearchChange: (value: string) => void;
  onWorkflowChange: (value: WorkflowStatus | '') => void;
  onClassificationChange: (value: ClassificationStatus | '') => void;
  onAccountTypeChange: (value: string) => void;
  onInventoryScopeChange: (value: 'pending' | 'business' | 'internal' | '') => void;
  onQualityChange: (value: 'pending' | 'clean' | 'obsolete' | 'duplicate' | '') => void;
  onScopeHintChange: (value: '' | 'possible_internal_accounts_safe') => void;
  onHealthChange: (value: SafeHealthFilter) => void;
  onBusinessUnitChange: (value: string) => void;
  onResponsibleChange: (value: string) => void;
  onClearFilters: () => void;
  onExport: () => void;
};

export function SafeTableFilters({
  search, workflowFilter, classificationFilter, accountTypeFilter, inventoryScopeFilter, qualityFilter,
  scopeHintFilter, healthFilter, businessUnitFilter, responsibleFilter, analytics, accountTypes, canExport, onSearchChange, onWorkflowChange,
  onClassificationChange, onAccountTypeChange, onInventoryScopeChange, onQualityChange,
  onScopeHintChange, onHealthChange, onBusinessUnitChange, onResponsibleChange, onClearFilters, onExport,
}: SafeTableFiltersProps) {
  const activeFilters = [workflowFilter, classificationFilter, accountTypeFilter, inventoryScopeFilter, qualityFilter, scopeHintFilter, healthFilter, businessUnitFilter, responsibleFilter].filter(Boolean).length;
  const statusCounts = new Map(analytics.workflow_status.map((bucket) => [bucket.key, bucket.count]));
  const workflowOptions = workflowStatusesFromCounts(analytics.workflow_status, workflowFilter);
  const observedAccountTypes = analytics.account_types.length
    ? analytics.account_types.map((bucket) => ({ value: bucket.key === 'Sin clasificar' ? '__empty__' : bucket.key, label: `${bucket.key} (${formatNumber(bucket.count)})` }))
    : accountTypes.map((type) => ({ value: type.key, label: `${type.key} (${formatNumber(type.count)})` }));
  const businessUnitOptions = analytics.business_units.map((bucket) => ({ value: bucket.key, label: `${bucket.label || bucket.key} (${formatNumber(bucket.count)})` }));
  const responsibleOptions = analytics.responsibles.map((bucket) => ({ value: bucket.key, label: `${bucket.label || bucket.key} (${formatNumber(bucket.count)})` }));
  return <>
    <div className="search-row"><label className="search-box"><Search size={16} /><input type="search" aria-label="Buscar Safes por nombre o Safe URL ID" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Buscar por nombre o Safe URL ID" /></label>{canExport && <button className="button subtle export-button" type="button" onClick={onExport}><Download size={15} /> Exportar CSV</button>}</div>
    <details className="filter-details"><summary><span>Filtros</span><span className="filter-summary">{formatNumber(activeFilters)} activos</span></summary>
      <div className="filter-row">
        <label>Estado<CompactSelect value={workflowFilter} ariaLabel="Filtrar por estado" options={[{ value: '', label: 'Todos' }, ...workflowOptions.map((status) => ({ value: status, label: `${workflowLabel(status)} (${formatNumber(statusCounts.get(status) || 0)})` }))]} onChange={(value) => onWorkflowChange(value as WorkflowStatus | '')} /></label>
        <label>Unidad<CompactSelect value={businessUnitFilter} ariaLabel="Filtrar por unidad" options={[{ value: '', label: 'Todas' }, ...businessUnitOptions]} onChange={onBusinessUnitChange} /></label>
        <label>Responsable<CompactSelect value={responsibleFilter} ariaLabel="Filtrar por responsable" options={[{ value: '', label: 'Todos' }, ...responsibleOptions]} onChange={onResponsibleChange} /></label>
        <label>Clasificación<CompactSelect value={classificationFilter} ariaLabel="Filtrar por clasificación" options={[{ value: '', label: 'Todas' }, { value: 'pending', label: 'Pendiente' }, { value: 'assigned', label: 'Asignada' }, { value: 'review', label: 'Revisión' }]} onChange={(value) => onClassificationChange(value as ClassificationStatus | '')} /></label>
        <label>Tipo de cuenta<CompactSelect value={accountTypeFilter} ariaLabel="Filtrar por tipo de cuenta" options={[{ value: '', label: 'Todos' }, ...observedAccountTypes]} onChange={onAccountTypeChange} /></label>
        <label>Alcance<CompactSelect value={inventoryScopeFilter} ariaLabel="Filtrar por alcance del inventario" options={[{ value: '', label: 'Todos' }, { value: 'pending', label: 'Pendiente' }, { value: 'business', label: 'Negocio' }, { value: 'internal', label: 'Interno CyberArk' }]} onChange={(value) => onInventoryScopeChange(value as 'pending' | 'business' | 'internal' | '')} /></label>
        <label>Calidad<CompactSelect value={qualityFilter} ariaLabel="Filtrar por calidad" options={[{ value: '', label: 'Todas' }, { value: 'pending', label: 'Pendiente' }, { value: 'clean', label: 'Depurado' }, { value: 'obsolete', label: 'Obsoleto' }, { value: 'duplicate', label: 'Duplicado' }]} onChange={(value) => onQualityChange(value as 'pending' | 'clean' | 'obsolete' | 'duplicate' | '')} /></label>
        <label>Revisión<CompactSelect value={scopeHintFilter} ariaLabel="Filtrar candidatos de revisión" options={[{ value: '', label: 'Todos' }, { value: 'possible_internal_accounts_safe', label: 'Candidatos internos' }]} onChange={(value) => onScopeHintChange(value as '' | 'possible_internal_accounts_safe')} /></label>
        <label>Safe Health<CompactSelect value={healthFilter} ariaLabel="Filtrar por Safe Health" options={[{ value: '', label: 'Todos' }, { value: 'missing_cpm', label: 'Sin CPM' }, { value: 'no_accounts', label: 'Sin cuentas' }, { value: 'retention_unconfigured', label: 'Sin retención/purga' }, { value: 'manage_safe_concentration', label: '2+ Manage Safe' }]} onChange={(value) => onHealthChange(value as SafeHealthFilter)} /></label>
        <button className="button subtle" type="button" onClick={onClearFilters}>Limpiar filtros</button>
      </div>
    </details>
  </>;
}
