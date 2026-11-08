import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Archive, ChevronDown, ChevronRight, Download, FileUp, ListChecks, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import { useConnectionDeviations, useConnectionInventory } from '../hooks/use-connection-inventory';
import { useExecutiveAnalytics } from '../hooks/use-executive-analytics';
import {
  bulkUpdateConnectionDestinations, createConnectionDestination, exportConnectionInventory, fetchConnectionInventory,
  importConnectionInventory, updateConnectionDestination,
} from '../lib/connection-inventory-api';
import { parseConnectionInventoryCsv } from '../lib/connection-inventory-csv';
import { FLAG_FIELDS, POLICY_CAPABILITY_LABELS, capabilityReading, flagLabel, flagTone, isDeviation, nextFlag } from '../lib/connection-coverage-reading';
import { dateTimeHint, formatDate, formatNumber } from '../lib/format';
import { IdentityChip, StatusBadge, TagChip } from './semantic';
import { StateBlock } from './state-block';
import { TablePagination } from './table-pagination';
import type {
  ConnectionCoverageFilter, ConnectionDeviationFilter, ConnectionDestinationChanges, ConnectionDestinationValues, ConnectionImportMode,
  ConnectionInventoryImportRow, ConnectionInventoryRow, ConnectionStatusFilter, WorkStatus,
} from '../types/connection';
import { coverageOptions, environmentOptions } from '../lib/connection-filter-options';
import { CompactSelect } from './compact-select';
import { ConnectionDestinationDialog } from './connection-destination-dialog';
import { DestinationHistory } from './destination-history';
import { WORK_STATUSES, workLabel, workTone } from '../lib/connection-work';
import { ConnectionImportDialog } from './connection-import-dialog';
import { SiaPolicyDialog } from './sia-policy-dialog';
import { CoverageProgress } from './coverage-progress';
import { UNINVENTORIED_QUERY_KEY, UninventoriedAddresses } from './uninventoried-addresses';
import { handleTablistKeyDown } from '../lib/tablist-keyboard';
import './connection-inventory-workspace.css';
import { t } from '../i18n/index.ts';

const PAGE_SIZE = 50;
const BULK_LIMIT = 500;
type FlagField = (typeof FLAG_FIELDS)[number]['field'];
const KEEP = '__keep__';
const FLAG_CHOICES = [{ value: KEEP, label: t('No cambiar') }, { value: 'yes', label: t('Sí') }, { value: 'no', label: t('No') }, { value: 'none', label: t('Sin dato') }];

function serviceHint(port: number | null): string {
  const labels: Record<number, string> = {
    22: 'SSH · Linux posible', 3389: 'RDP · Windows posible', 5985: 'WinRM · Windows posible',
    5986: 'WinRM HTTPS · Windows posible', 1433: 'SQL Server', 1521: 'Oracle',
    3306: 'MySQL/MariaDB', 5432: 'PostgreSQL', 27017: 'MongoDB', 6379: 'Redis',
  };
  return port ? labels[port] || `Puerto ${port}` : 'Puerto sin dato';
}

function CoverageBadge({ row }: { row: ConnectionInventoryRow }) {
  if (row.safe_match_count && row.sia_match_count) return <StatusBadge tone="success">{t('Cubierta en Safe + SIA')}</StatusBadge>;
  if (row.safe_match_count || row.sia_match_count) return <StatusBadge tone="warning">{t('Cobertura parcial')}</StatusBadge>;
  return <StatusBadge tone="neutral">{t('Sin coincidencia')}</StatusBadge>;
}

/** The four sheet flags as small marks. With `onCycle` each one is a button: a click moves it Sin dato -> Sí -> No. */
function DeclaredMarks({ row, onCycle }: { row: ConnectionInventoryRow; onCycle?: (field: FlagField, value: boolean | null) => void }) {
  return <span className="declared-marks">{FLAG_FIELDS.map(({ field, label, short }) => {
    const value = row[field];
    const result = field === 'ca_sia' ? row.platform_result : field === 'ca_dba' ? row.dba_result : null;
    const deviation = isDeviation(result);
    const reading = field === 'ca_sia' ? capabilityReading('platform', result) : field === 'ca_dba' ? capabilityReading('dba', result) : null;
    const content = <>{short}<b aria-hidden>{value === true ? '✓' : value === false ? '✕' : '–'}</b>{deviation && <i className="declared-mark-flag" aria-hidden>!</i>}</>;
    const note = deviation && reading ? ` · ${reading.label}` : '';
    return onCycle
      ? <button key={field} type="button" className={`declared-mark is-editable tone-${flagTone(value)}${deviation ? ' is-deviation' : ''}`} title={`${label}: ${flagLabel(value)}${note} · clic para cambiar`} aria-label={`${label} de ${row.instance_name}: ${flagLabel(value)}${note}. Cambiar`} onClick={() => onCycle(field, nextFlag(value))}>{content}</button>
      : <span key={field} className={`declared-mark tone-${flagTone(value)}${deviation ? ' is-deviation' : ''}`} title={`${label}: ${flagLabel(value)}${note}`}>{content}<span className="sr-only">: {flagLabel(value)}{note}</span></span>;
  })}</span>;
}

type Props = {
  refreshKey: number;
  authChecked: boolean;
  authenticated: boolean;
  includeInternal: boolean;
  canManage: boolean;
  initialSearch?: string;
  initialEnvironment?: string;
  initialCoverage?: ConnectionCoverageFilter | '';
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

export function ConnectionInventoryWorkspace({ refreshKey, authChecked, authenticated, includeInternal, canManage, initialSearch = '', initialEnvironment = '', initialCoverage = '', onUnauthorized, onError, onNotice }: Props) {
  const { search, setSearch, environment, setEnvironment, coverage, setCoverage, status, setStatus, deviation, setDeviation, workStatus, setWorkStatus, responsible, setResponsible, page, setPage, filterArgs, loading, rows, total, importInfo, loadError, reload } = useConnectionInventory({ refreshKey, authChecked, authenticated, includeInternal, initialSearch, initialEnvironment, initialCoverage, onUnauthorized, onError });
  const queryClient = useQueryClient();
  const executive = useExecutiveAnalytics({ refreshKey, includeInternal, onUnauthorized });
  const coverageSummary = executive.data?.connection_coverage ?? null;
  const deviations = useConnectionDeviations({ refreshKey, enabled: authChecked && authenticated });
  const [classifying, setClassifying] = useState(false);
  const [view, setView] = useState<'destinations' | 'uninventoried' | 'progress'>('destinations');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<{ fileName: string; rows: ConnectionInventoryImportRow[] } | null>(null);
  const [editing, setEditing] = useState<{ row: ConnectionInventoryRow | null; ip?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [bulk, setBulk] = useState({ environment: KEEP, ca_sia: KEEP, ca_dba: KEEP, zsp_implemented: KEEP, access_available: KEEP, lifecycle_status: KEEP, work_status: KEEP, responsible: KEEP });
  const fileInput = useRef<HTMLInputElement>(null);
  const environments = useMemo(() => (coverageSummary?.by_environment ?? []).map((item) => item.environment).filter((name) => name !== 'Sin ambiente'), [coverageSummary]);
  const responsibles = useMemo(() => (deviations.data?.responsibles ?? []).map((item) => item.responsible), [deviations.data]);
  const allChecked = rows.length > 0 && rows.every((row) => checked.has(row.inventory_id));

  const resetSelection = () => { setChecked(new Set()); setExpanded(new Set()); };
  const toggle = (setter: typeof setChecked, id: number) => setter((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    onError('');
    try {
      setPending({ fileName: file.name, rows: parseConnectionInventoryCsv(await file.text()) });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo leer el CSV');
    }
  };

  const confirmImport = async (mode: ConnectionImportMode) => {
    if (!pending) return;
    setImporting(true); onError('');
    try {
      const result = await importConnectionInventory({ file_name: pending.fileName, rows: pending.rows, mode });
      const { new: added, changed, missing } = result.counts;
      onNotice(`Importado: ${formatNumber(added)} nuevos, ${formatNumber(changed)} cambian, ${formatNumber(missing)} ${mode === 'update' ? 'retirados' : 'quitados'}.`);
      setPending(null);
      resetSelection();
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo importar el CSV');
    } finally { setImporting(false); }
  };

  const exportCsv = async () => {
    onError('');
    try { await exportConnectionInventory(); onNotice(t('CSV de destinos descargado')); }
    catch (error) { onError(error instanceof Error ? error.message : 'No se pudo exportar el inventario'); }
  };

  const save = async (values: ConnectionDestinationValues) => {
    if (!editing) return;
    setSaving(true); setSaveError('');
    try {
      if (editing.row) {
        const before = editing.row;
        const changes: ConnectionDestinationChanges = {};
        for (const key of Object.keys(values) as (keyof ConnectionDestinationValues)[]) if (values[key] !== before[key]) Object.assign(changes, { [key]: values[key] });
        if (Object.keys(changes).length) await updateConnectionDestination(before.inventory_id, changes);
        onNotice(Object.keys(changes).length ? t('Destino actualizado') : t('Sin cambios'));
      } else {
        await createConnectionDestination(values);
        onNotice(t('Destino agregado'));
      }
      setEditing(null);
      await reload(); await executive.reload(); await deviations.reload();
      await queryClient.invalidateQueries({ queryKey: UNINVENTORIED_QUERY_KEY });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar el destino');
    } finally { setSaving(false); }
  };

  const setLifecycle = async (row: ConnectionInventoryRow, lifecycle: 'active' | 'retired') => {
    onError('');
    try {
      await updateConnectionDestination(row.inventory_id, { lifecycle_status: lifecycle });
      onNotice(lifecycle === 'retired' ? `${row.instance_name} retirado` : `${row.instance_name} reactivado`);
      await reload(); await executive.reload(); await deviations.reload();
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo cambiar el estado'); }
  };

  const setWork = async (row: ConnectionInventoryRow, value: WorkStatus) => {
    onError('');
    try {
      await updateConnectionDestination(row.inventory_id, { work_status: value });
      await reload(); await deviations.reload();
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo cambiar el estado de trabajo'); }
  };

  const cycleFlag = async (row: ConnectionInventoryRow, field: FlagField, value: boolean | null) => {
    onError('');
    try {
      await updateConnectionDestination(row.inventory_id, { [field]: value });
      await reload(); await executive.reload(); await deviations.reload();
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo cambiar el valor'); }
  };

  /** Selects every result of the current filter (not just the page), up to what one bulk edit accepts. */
  const selectAllResults = async () => {
    onError('');
    try {
      const all = await fetchConnectionInventory(filterArgs.search, 0, filterArgs.includeInternal, filterArgs.environment, filterArgs.coverage, filterArgs.status, filterArgs.deviation, filterArgs.workStatus, filterArgs.responsible, undefined, BULK_LIMIT);
      setChecked(new Set(all.rows.map((row) => row.inventory_id)));
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo seleccionar los resultados'); }
  };

  const bulkChanges = (): ConnectionDestinationChanges => {
    const changes: ConnectionDestinationChanges = {};
    if (bulk.environment !== KEEP) changes.environment = bulk.environment === 'none' ? '' : bulk.environment;
    for (const field of ['ca_sia', 'ca_dba', 'zsp_implemented', 'access_available'] as const) {
      if (bulk[field] !== KEEP) changes[field] = bulk[field] === 'yes' ? true : bulk[field] === 'no' ? false : null;
    }
    if (bulk.lifecycle_status !== KEEP) changes.lifecycle_status = bulk.lifecycle_status as 'active' | 'retired';
    if (bulk.work_status !== KEEP) changes.work_status = bulk.work_status as WorkStatus;
    if (bulk.responsible !== KEEP) changes.responsible = bulk.responsible === 'none' ? '' : bulk.responsible;
    return changes;
  };
  const pendingChanges = Object.keys(bulkChanges()).length;

  const applyBulk = async () => {
    const ids = [...checked];
    setSaving(true); onError('');
    try {
      const result = await bulkUpdateConnectionDestinations(ids, bulkChanges());
      onNotice(`Cambio aplicado a ${formatNumber(result.changed)} de ${formatNumber(ids.length)} ${ids.length === 1 ? 'destino' : 'destinos'}.`);
      setBulk({ environment: KEEP, ca_sia: KEEP, ca_dba: KEEP, zsp_implemented: KEEP, access_available: KEEP, lifecycle_status: KEEP, work_status: KEEP, responsible: KEEP });
      resetSelection();
      await reload(); await executive.reload(); await deviations.reload();
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo aplicar el cambio'); }
    finally { setSaving(false); }
  };

  const platformDeviations = deviations.data ? deviations.data.platform.missing + deviations.data.platform.undeclared : 0;
  const dbaDeviations = deviations.data ? deviations.data.dba.missing + deviations.data.dba.undeclared : 0;
  const stats = coverageSummary ? [
    { label: t('Destinos activos'), value: coverageSummary.totals.total, coverage: '', deviation: '' as ConnectionDeviationFilter },
    { label: t('En Safe y SIA'), value: coverageSummary.totals.both, coverage: 'both', deviation: '' as ConnectionDeviationFilter, tone: 'success' },
    { label: t('Cobertura parcial'), value: coverageSummary.totals.pam_only + coverageSummary.totals.sia_only, coverage: null, deviation: '' as ConnectionDeviationFilter, tone: 'warning' },
    { label: t('Sin coincidencia'), value: coverageSummary.totals.none, coverage: 'none', deviation: '' as ConnectionDeviationFilter, tone: 'neutral' },
    ...(deviations.data ? [
      { label: t('Desvíos Platform'), value: platformDeviations, coverage: '', deviation: 'platform' as ConnectionDeviationFilter, tone: platformDeviations ? 'danger' : 'success' },
      { label: t('Desvíos DBA'), value: dbaDeviations, coverage: '', deviation: 'dba' as ConnectionDeviationFilter, tone: dbaDeviations ? 'danger' : 'success' },
    ] : []),
  ] : [];
  const columns = canManage ? 8 : 6;

  return <>
    <nav className="coverage-tabs" role="tablist" aria-label={t('Vistas de Cobertura')} onKeyDown={handleTablistKeyDown}>
      {([['destinations', 'Destinos'], ['uninventoried', 'Sin inventariar'], ['progress', 'Avance']] as const).map(([id, label]) => <button key={id} id={`coverage-tab-${id}`} type="button" role="tab" aria-selected={view === id} aria-controls="coverage-tabpanel" tabIndex={view === id ? 0 : -1} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}
    </nav>
    <div role="tabpanel" id="coverage-tabpanel" aria-labelledby={`coverage-tab-${view}`}>
    {view === 'progress' ? <CoverageProgress refreshKey={refreshKey} canManage={canManage} onError={onError} onNotice={onNotice} />
      : view === 'uninventoried' ? <UninventoriedAddresses includeInternal={includeInternal} canManage={canManage} refreshKey={refreshKey} onAdd={(address) => { setSaveError(''); setEditing({ row: null, ip: address }); }} />
      : <>
    <section className="database-toolbar">
      <div className="database-toolbar-actions"><span className="database-toolbar-count">{formatNumber(total)} {total === 1 ? 'destino' : 'destinos'}</span>{canManage && <><input ref={fileInput} type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event)} hidden />
        <button className="button subtle" type="button" onClick={() => { setSaveError(''); setEditing({ row: null }); }}><Plus size={15} aria-hidden /> {t('Agregar destino')}</button>
        <button className="button subtle" type="button" disabled={importing} title={t('Importar un CSV por IP y puerto, con vista previa')} onClick={() => fileInput.current?.click()}><FileUp size={15} aria-hidden /> {t('Importar CSV')}</button>
        <button className="button subtle" type="button" title={t('Decidir si cada política SIA es Platform, DBA u otra')} onClick={() => setClassifying(true)}><ListChecks size={15} aria-hidden /> {t('Políticas SIA')}</button>
        <button className="button subtle" type="button" title={t('Descargar los destinos activos con lo observado en Safes y SIA')} onClick={() => void exportCsv()}><Download size={15} aria-hidden /> {t('Exportar CSV')}</button></>}</div>
    </section>
    {stats.length > 0 && <section className="coverage-stats" aria-label={t('Resumen de cobertura')}>
      {stats.map((stat) => {
        const filtering = stat.coverage !== null;
        const active = filtering && coverage === stat.coverage && deviation === stat.deviation && !environment && status === 'active';
        const body = <><span className="coverage-stat-value">{formatNumber(stat.value)}</span><span className="coverage-stat-label">{stat.label}</span></>;
        return !filtering
          ? <div key={stat.label} className={`coverage-stat tone-${stat.tone}`}>{body}</div>
          : <button key={stat.label} type="button" className={`coverage-stat${stat.tone ? ` tone-${stat.tone}` : ''}${active ? ' is-active' : ''}`} aria-pressed={active} onClick={() => { setStatus('active'); setCoverage(active ? '' : stat.coverage as ConnectionCoverageFilter | ''); setDeviation(active ? '' : stat.deviation); resetSelection(); }}>{body}</button>;
      })}
    </section>}
    {deviations.data && deviations.data.policies.total > 0 && deviations.data.policies.classified < deviations.data.policies.total && <p className="coverage-policy-banner" role="status">
      {deviations.data.policies.classified === 0 ? 'Todavía no clasificaste las políticas SIA, así que Platform y DBA no se pueden medir.' : `Hay ${deviations.data.policies.total - deviations.data.policies.classified} de ${deviations.data.policies.total} políticas SIA sin clasificar.`}
      {canManage && <button type="button" className="button subtle" onClick={() => setClassifying(true)}>{t('Clasificar políticas')}</button>}
    </p>}
    <section className="list-panel database-surface connection-inventory-panel">
      <div className="search-row connection-inventory-filters"><label className="search-box"><Search size={16} aria-hidden /><input type="search" aria-label={t('Buscar conexiones por IP o instancia')} placeholder={t('Buscar por IP, instancia o ambiente')} value={search} onChange={(event) => { setSearch(event.target.value); resetSelection(); }} /></label>
        <CompactSelect ariaLabel={t('Filtrar por ambiente')} value={environment} onChange={(value) => { setEnvironment(value); resetSelection(); }} options={environmentOptions(coverageSummary?.by_environment ?? null, coverageSummary ? coverageSummary.totals.total : null, environment, formatNumber)} />
        <CompactSelect ariaLabel={t('Filtrar por cobertura')} value={coverage} onChange={(value) => { setCoverage(value as ConnectionCoverageFilter | ''); resetSelection(); }} options={coverageOptions(coverageSummary?.totals ?? null, coverage, formatNumber)} />
        <CompactSelect ariaLabel={t('Filtrar por desvío')} value={deviation} onChange={(value) => { setDeviation(value as ConnectionDeviationFilter); resetSelection(); }} options={[{ value: '', label: t('Con o sin desvío') }, { value: 'any', label: t('Con desvíos') }, { value: 'platform', label: t('Desvío de Platform') }, { value: 'dba', label: t('Desvío de DBA') }]} />
        <CompactSelect ariaLabel={t('Filtrar por estado de trabajo')} value={workStatus} onChange={(value) => { setWorkStatus(value as WorkStatus | ''); resetSelection(); }} options={[{ value: '', label: t('Todo el trabajo') }, ...WORK_STATUSES.map((item) => ({ value: item.value, label: deviations.data ? `${item.label} (${formatNumber(deviations.data.work[item.value] ?? 0)})` : item.label }))]} />
        <CompactSelect ariaLabel={t('Filtrar por responsable')} value={responsible} onChange={(value) => { setResponsible(value); resetSelection(); }} options={[{ value: '', label: t('Todo responsable') }, { value: 'none', label: t('Sin responsable') }, ...responsibles.map((name) => ({ value: name, label: name })), ...(responsible && responsible !== 'none' && !responsibles.includes(responsible) ? [{ value: responsible, label: responsible }] : [])]} />
        <CompactSelect ariaLabel={t('Filtrar por estado')} value={status} onChange={(value) => { setStatus(value as ConnectionStatusFilter); resetSelection(); }} options={[{ value: 'active', label: t('Activos') }, { value: 'retired', label: t('Retirados') }, { value: 'all', label: t('Todos') }]} />
        {!coverageSummary && !executive.loading ? <span className="connection-inventory-summary-error" role="status">{t('Conteos no disponibles')} <button type="button" className="button subtle" onClick={() => void executive.reload()}>{t('Reintentar')}</button></span> : null}
      </div>
      {canManage && checked.size > 0 && <div className="connection-bulk-bar" role="region" aria-label={t('Edición en lote')}>
        <span className="connection-bulk-count">{checked.size} {checked.size === 1 ? 'seleccionado' : 'seleccionados'}</span>
        <label>{t('Ambiente')}<CompactSelect value={bulk.environment} ariaLabel={t('Ambiente a aplicar')} disabled={saving} options={[{ value: KEEP, label: t('No cambiar') }, ...environments.map((name) => ({ value: name, label: name })), { value: 'none', label: t('Sin ambiente') }]} onChange={(value) => setBulk((current) => ({ ...current, environment: value }))} /></label>
        {FLAG_FIELDS.map(({ field, label }) => <label key={field}>{label}<CompactSelect value={bulk[field]} ariaLabel={`${label} a aplicar`} disabled={saving} options={FLAG_CHOICES} onChange={(value) => setBulk((current) => ({ ...current, [field]: value }))} /></label>)}
        <label>{t('Trabajo')}<CompactSelect value={bulk.work_status} ariaLabel={t('Estado de trabajo a aplicar')} disabled={saving} options={[{ value: KEEP, label: t('No cambiar') }, ...WORK_STATUSES.map((item) => ({ value: item.value, label: item.label }))]} onChange={(value) => setBulk((current) => ({ ...current, work_status: value }))} /></label>
        <label>{t('Responsable')}<CompactSelect value={bulk.responsible} ariaLabel={t('Responsable a aplicar')} disabled={saving} options={[{ value: KEEP, label: t('No cambiar') }, { value: 'none', label: t('Sin responsable') }, ...responsibles.map((name) => ({ value: name, label: name }))]} onChange={(value) => setBulk((current) => ({ ...current, responsible: value }))} /></label>
        <label>{t('Estado')}<CompactSelect value={bulk.lifecycle_status} ariaLabel={t('Estado a aplicar')} disabled={saving} options={[{ value: KEEP, label: t('No cambiar') }, { value: 'active', label: t('Activo') }, { value: 'retired', label: t('Retirado') }]} onChange={(value) => setBulk((current) => ({ ...current, lifecycle_status: value }))} /></label>
        {allChecked && total > rows.length && total <= BULK_LIMIT && checked.size < total && <button type="button" className="button subtle" disabled={saving} onClick={() => void selectAllResults()}>Seleccionar los {formatNumber(total)} resultados</button>}
        <span className="connection-bulk-actions">
          <button type="button" className="button primary" disabled={saving || pendingChanges === 0} onClick={() => void applyBulk()}>{saving ? 'Aplicando…' : `Aplicar a ${checked.size}`}</button>
          <button type="button" className="button subtle" disabled={saving} onClick={() => setChecked(new Set())}>{t('Cancelar selección')}</button>
        </span>
      </div>}
      <div className="compact-table-wrap"><table className="compact-table connection-inventory-table"><thead><tr>
        {canManage && <th className="connection-select-cell"><input type="checkbox" className="row-select-checkbox" aria-label={t('Seleccionar los destinos de esta página')} checked={allChecked} disabled={!rows.length} onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((row) => row.inventory_id)))} /></th>}
        <th className="connection-expand-cell" /><th>{t('Destino')}</th><th>{t('IP · puerto')}</th><th>{t('Declarado en la planilla')}</th><th>{t('Observado')}</th><th>{t('Trabajo')}</th>{canManage && <th><span className="sr-only">{t('Acciones')}</span></th>}
      </tr></thead><tbody>
        {loading ? <tr><td colSpan={columns + 1}><StateBlock variant="loading" title={t('Cargando inventario de infraestructura…')} /></td></tr>
          : loadError ? <tr><td colSpan={columns + 1}><StateBlock variant="error" title={t('No se pudo cargar el inventario de infraestructura')} hint={loadError} action={<button type="button" className="button subtle" onClick={() => void reload()}>{t('Reintentar')}</button>} /></td></tr>
          : rows.length ? rows.map((row) => {
            const isExpanded = expanded.has(row.inventory_id);
            const retired = row.lifecycle_status === 'retired';
            return <Fragment key={row.inventory_id}><tr className={`${isExpanded ? 'selected' : ''}${retired ? ' is-retired' : ''}`} onClick={() => toggle(setExpanded, row.inventory_id)} style={{ cursor: 'pointer' }}>
              {canManage && <td className="connection-select-cell" onClick={(event) => event.stopPropagation()}><input type="checkbox" className="row-select-checkbox" aria-label={`Seleccionar ${row.instance_name}`} checked={checked.has(row.inventory_id)} onChange={() => toggle(setChecked, row.inventory_id)} /></td>}
              <td className="connection-expand-cell"><button type="button" className="row-expand-button" aria-expanded={isExpanded} aria-controls={`connection-coverage-${row.inventory_id}`} aria-label={`${isExpanded ? t('Ocultar') : t('Ver')} cobertura de ${row.instance_name}`} title={`${isExpanded ? t('Ocultar') : t('Ver')} cobertura de ${row.instance_name}`} onClick={(event) => { event.stopPropagation(); toggle(setExpanded, row.inventory_id); }}>{isExpanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}</button></td>
              <td><strong>{row.instance_name}</strong><span className="table-subvalue">{row.environment || 'Ambiente sin dato'}</span></td>
              <td><strong className="mono">{row.private_ip}</strong><span className="table-subvalue">{row.port ? `:${row.port}` : 'Sin puerto'}</span></td>
              <td onClick={(event) => event.stopPropagation()}><DeclaredMarks row={row} onCycle={canManage && !retired ? (field, value) => void cycleFlag(row, field, value) : undefined} /></td>
              <td>{retired ? <StatusBadge tone="neutral">{t('Retirado')}</StatusBadge> : <div className="observed-cell"><CoverageBadge row={row} /><span className="table-subvalue">Safes {formatNumber(row.safe_match_count)} · SIA {formatNumber(row.sia_match_count)}</span></div>}</td>
              <td className="work-cell" onClick={(event) => event.stopPropagation()}>
                {canManage && !retired
                  ? <CompactSelect className="work-select" value={row.work_status} ariaLabel={`Estado de trabajo de ${row.instance_name}`} options={WORK_STATUSES.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => void setWork(row, value as WorkStatus)} />
                  : <StatusBadge tone={workTone(row.work_status)}>{workLabel(row.work_status)}</StatusBadge>}
                <span className="table-subvalue">{row.responsible || 'Sin responsable'}</span>
              </td>
              {canManage && <td className="connection-row-actions" onClick={(event) => event.stopPropagation()}>
                <button type="button" className="icon-button" aria-label={`Editar ${row.instance_name}`} title={t('Editar')} onClick={() => { setSaveError(''); setEditing({ row }); }}><Pencil size={14} aria-hidden /></button>
                <button type="button" className="icon-button" aria-label={`${retired ? t('Reactivar') : t('Retirar')} ${row.instance_name}`} title={retired ? t('Reactivar') : t('Retirar')} onClick={() => void setLifecycle(row, retired ? 'active' : 'retired')}>{retired ? <RotateCcw size={14} aria-hidden /> : <Archive size={14} aria-hidden />}</button>
              </td>}</tr>
              {isExpanded && <tr className="connection-inventory-detail-row" id={`connection-coverage-${row.inventory_id}`}><td colSpan={columns + 1}><div className="connection-inventory-detail">
                <div className="destination-block"><span className="pam-role-graph-label">{t('Declarado')}</span>
                  <dl className="declared-list">{FLAG_FIELDS.map(({ field, label }) => <div key={field}><dt>{label}</dt><dd><StatusBadge tone={flagTone(row[field])}>{flagLabel(row[field])}</StatusBadge></dd></div>)}</dl>
                  {row.description && <p className="muted">{row.description}</p>}
                  {row.note && <p className="destination-note-line"><strong>{t('Nota:')}</strong> {row.note}</p>}
                  {!retired && ([['Platform', capabilityReading('platform', row.platform_result)], ['DBA', capabilityReading('dba', row.dba_result)]] as const).map(([name, reading]) => reading && <p key={name} className={`destination-reading tone-${reading.tone}`}><strong>{name}: {reading.label}</strong> <span>{reading.hint}</span></p>)}
                  <p className="muted">{serviceHint(row.port)} · derivado únicamente del puerto informado.</p>
                </div>
                <div className="destination-block"><span className="pam-role-graph-label">{t('Encontrado en Safes')}</span>{row.safe_matches.length ? <div className="connection-inventory-match-list">{row.safe_matches.slice(0, 8).map((match) => <div className="connection-inventory-match" key={`${match.safe_number}-${match.account_id}`}><IdentityChip kind="role" name={match.safe_name} subtitle={`${match.account_name} · ${match.platform_name || 'Plataforma sin dato'}`} /><TagChip label={`Safe ${match.safe_number}`} /></div>)}</div> : <span className="muted">{t('No se encontró una cuenta activa con esa IP.')}</span>}</div>
                <div className="destination-block"><span className="pam-role-graph-label">{t('Encontrado en SIA')}</span>{row.sia_matches.length ? <div className="pam-role-chip-list">{row.sia_matches.slice(0, 8).map((match) => <div className="connection-inventory-match" key={match.object_id}><IdentityChip kind="system" name={match.display_name} subtitle={`Política SIA · ID ${match.source_id}`} /><TagChip label={match.capability ? POLICY_CAPABILITY_LABELS[match.capability] : 'Sin clasificar'} /></div>)}</div> : <span className="muted">{t('No se encontró una política SIA con esa IP.')}</span>}</div>
                <div className="destination-block destination-history-block"><span className="pam-role-graph-label">{t('Historial')}</span><DestinationHistory inventoryId={row.inventory_id} stamp={`${row.work_status}|${row.responsible}|${row.note}|${row.environment}|${row.lifecycle_status}|${row.ca_sia}|${row.ca_dba}`} /></div>
              </div></td></tr>}</Fragment>;
          }) : <tr><td colSpan={columns + 1}><StateBlock variant="empty" title={importInfo ? t('No hay coincidencias para esta búsqueda.') : t('Todavía no hay un inventario de infraestructura cargado.')} hint={importInfo ? t('Probá con otra IP o nombre de instancia.') : t('Descargá tu planilla como CSV UTF-8 e importala para empezar.')} action={!importInfo && canManage ? <button type="button" className="button subtle" onClick={() => fileInput.current?.click()}>{t('Importar el primer CSV')}</button> : undefined} /></td></tr>}
      </tbody></table></div>
      {importInfo && <p className="connection-inventory-source">Fuente: {importInfo.file_name} · {formatNumber(importInfo.row_count)} filas · importado <time dateTime={importInfo.imported_at} title={dateTimeHint(importInfo.imported_at)}>{formatDate(importInfo.imported_at)}</time></p>}
      <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={(nextPage) => { setPage(nextPage); resetSelection(); }} />
    </section>
    {pending && <ConnectionImportDialog fileName={pending.fileName} rows={pending.rows} busy={importing} onConfirm={(mode) => void confirmImport(mode)} onClose={() => setPending(null)} />}
    {classifying && <SiaPolicyDialog onClose={() => setClassifying(false)} onSaved={(changed) => { setClassifying(false); onNotice(changed ? `${formatNumber(changed)} ${changed === 1 ? t('política clasificada') : t('políticas clasificadas')}` : 'Sin cambios'); void reload(); void executive.reload(); void deviations.reload(); }} />}
    </>}
    </div>
    {editing && <ConnectionDestinationDialog row={editing.row} initialIp={editing.ip} environments={environments} responsibles={responsibles} busy={saving} error={saveError} onSave={(values) => void save(values)} onClose={() => setEditing(null)} />}
  </>;
}
