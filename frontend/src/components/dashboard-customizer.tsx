import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleCheck, Copy, Database, Gauge, LayoutGrid, Pencil, Plus, Server, ShieldAlert, Timer, Trash2, Users, X } from 'lucide-react';
import { CompactSelect, type CompactSelectOption } from './compact-select';
import { ConfirmDialog } from './confirm-dialog';
import { BarList, Metric } from './dashboard';
import { PieChart } from './pie-chart';
import { AdvancedChart } from './advanced-chart';
import { WORKFLOW_STATUSES, workflowLabel } from '../lib/format';
import {
  createDashboardWidget,
  createDashboardShortcut,
  DASHBOARD_SHORTCUTS,
  DASHBOARD_SHORTCUT_GROUPS,
  DASHBOARD_UNAVAILABLE_CHARTS,
  EMPTY_DASHBOARD_FILTERS,
  DASHBOARD_PERCENTAGE_MEASURES,
  DASHBOARD_DIMENSION_LABELS,
  DASHBOARD_DIMENSIONS,
  DASHBOARD_MEASURE_LABELS,
  dashboardWidgetDetail,
  dashboardValueLabel,
  type DashboardChartDimension,
  type DashboardShortcutId,
  type DashboardWidget,
  type DashboardWidgetFilters,
} from '../lib/dashboard-metrics';
import {
  DASHBOARD_SIZE_HINTS,
  DASHBOARD_SIZE_LABELS,
  DASHBOARD_ZONE_COUNT,
  dashboardOccupiedZones,
  dashboardZoneFits,
  dashboardZonesCovered,
  type DashboardWidgetSize,
} from '../lib/dashboard-layout';
import { previewDashboardWidget } from '../lib/dashboard-preferences-api';
import { ApiError } from '../lib/api';
import { handleTablistKeyDown } from '../lib/tablist-keyboard';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';

type Props = { widgets: DashboardWidget[]; saving: boolean; onSave: (widgets: DashboardWidget[]) => Promise<boolean>; onClose: () => void; mode?: 'manage' | 'create'; includeInternal?: boolean };
const EMPTY_OPTION = { value: '', label: 'No filtrar' };
const FILTER_OPTIONS: Record<keyof DashboardWidgetFilters, CompactSelectOption[]> = {
  workflow_status: [EMPTY_OPTION, ...WORKFLOW_STATUSES.map((status) => ({ value: status, label: workflowLabel(status) }))],
  classification_status: [EMPTY_OPTION, { value: 'pending', label: 'Pendiente' }, { value: 'assigned', label: 'Asignada' }, { value: 'review', label: 'En revisión' }],
  inventory_scope: [EMPTY_OPTION, { value: 'pending', label: 'Pendiente' }, { value: 'business', label: 'Negocio' }, { value: 'internal', label: 'Interno CyberArk' }],
  data_quality_status: [EMPTY_OPTION, { value: 'pending', label: 'Pendiente' }, { value: 'clean', label: 'Depurado' }, { value: 'obsolete', label: 'Obsoleto' }, { value: 'duplicate', label: 'Duplicado' }],
  health_filter: [EMPTY_OPTION, { value: 'missing_cpm', label: 'Sin CPM' }, { value: 'no_accounts', label: 'Sin cuentas' }, { value: 'retention_unconfigured', label: 'Sin retención' }, { value: 'manage_safe_concentration', label: 'Manage Safe compartido' }],
};

const MEASURE_OPTIONS: CompactSelectOption[] = Object.entries(DASHBOARD_MEASURE_LABELS).map(([value, label]) => ({ value, label }));
const CHART_MEASURE_OPTIONS: CompactSelectOption[] = ['safes', 'accounts'].map((value) => ({ value, label: DASHBOARD_MEASURE_LABELS[value as 'safes' | 'accounts'] }));
const STYLE_OPTIONS: CompactSelectOption[] = [
  { value: 'pie', label: 'Torta' }, { value: 'bars', label: 'Barras' },
  { value: 'line', label: 'Línea · evolución' }, { value: 'heatmap', label: 'Mapa de calor · cruce' },
  { value: 'scatter', label: 'Dispersión · correlación' }, { value: 'combo', label: 'Combinado · barras y línea' },
];
const ADVANCED_STYLE_DIMENSION: Partial<Record<'line' | 'heatmap' | 'scatter' | 'combo', DashboardChartDimension>> = {
  line: 'inventory_trend', heatmap: 'business_unit_workflow', scatter: 'safe_accounts_members', combo: 'business_unit_inventory',
};
const ADVANCED_DIMENSIONS = new Set<DashboardChartDimension>([...Object.values(ADVANCED_STYLE_DIMENSION), 'workflow_next_action']);
const KIND_OPTIONS: CompactSelectOption[] = [{ value: 'count', label: 'Dato destacado' }, { value: 'goal', label: 'Objetivo' }, { value: 'chart', label: 'Gráfico' }];
const DIMENSION_OPTIONS: CompactSelectOption[] = DASHBOARD_DIMENSIONS.map((dimension) => ({ value: dimension, label: `Por ${DASHBOARD_DIMENSION_LABELS[dimension]}` }));

const STEPS = [
  { id: 1, label: 'Contenido', hint: 'Nombre y qué medir' },
  { id: 2, label: 'Visualización', hint: 'Cómo se muestra' },
  { id: 3, label: 'Ubicación', hint: 'Tamaño y zona' },
  { id: 4, label: 'Filtros y vista previa', hint: 'Acotar y revisar' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const SIZE_OPTIONS: DashboardWidgetSize[] = ['sm', 'md', 'lg'];

function hasActiveFilter(widget: DashboardWidget): boolean {
  return Object.values(widget.filters).some(Boolean);
}

function occupiedVisualZones(widgets: DashboardWidget[], widgetId: string): Set<number> {
  const visualWidgets = widgets.filter((widget) => widget.kind !== 'count');
  return dashboardOccupiedZones(visualWidgets, visualWidgets.findIndex((widget) => widget.widget_id === widgetId));
}

function WidgetPreview({ widget, includeInternal = true }: { widget: DashboardWidget; includeInternal?: boolean }) {
  const [result, setResult] = useState<DashboardWidget | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const signature = JSON.stringify({ kind: widget.kind, measure: widget.measure, chart: widget.chart, filters: widget.filters, target: widget.target_value, direction: widget.target_direction });

  useEffect(() => {
    if (!widget.title.trim()) { setResult(null); setError(''); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await previewDashboardWidget(widget, controller.signal, includeInternal);
        setResult(response.widgets[0] ?? null);
        setError('');
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof ApiError ? caught.message : 'No se pudo previsualizar');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, widget.title, includeInternal]);

  if (error) return <p className="dashboard-widget-preview-hint">{error}</p>;
  if (!result) return <p className="dashboard-widget-preview-hint">{loading ? 'Calculando…' : 'Escribí un nombre para ver la previsualización.'}</p>;
  if (result.kind === 'chart' && result.chart) {
    const buckets = result.buckets ?? [];
    return <div className={`dashboard-widget-preview ${loading ? 'is-stale' : ''}`.trim()}>
      {result.chart.style === 'pie'
        ? <PieChart buckets={buckets} size={112} thickness={18} />
        : result.chart.style === 'bars'
          ? <BarList buckets={buckets} emptyHint="Sin datos para este corte." />
          : <AdvancedChart title={result.title} style={result.chart.style} data={result.chart_data} />}
    </div>;
  }
  return <div className={`dashboard-widget-preview ${loading ? 'is-stale' : ''}`.trim()}>
    <Metric label="Resultado actual" value={result.value} detail={DASHBOARD_MEASURE_LABELS[result.measure]} />
  </div>;
}

function WidgetCardShell({ index, title, onRemove, children }: { index: number; title: string; onRemove?: () => void; children: React.ReactNode }) {
  return <article className="dashboard-widget-card">
    <div className="dashboard-widget-editor-heading">
      <span>Métrica {index + 1}{title.trim() ? ` · ${title.trim()}` : ''}</span>
      {onRemove ? <button type="button" className="icon-button" aria-label={`Eliminar métrica ${index + 1}`} title={`Eliminar métrica ${index + 1}`} onClick={onRemove}><Trash2 size={14} /></button> : null}
    </div>
    {children}
  </article>;
}

function WidgetBasicsCard({ widget, index, onChange, onRemove }: { widget: DashboardWidget; index: number; onChange: (widget: DashboardWidget) => void; onRemove?: () => void }) {
  return <WidgetCardShell index={index} title={widget.title} onRemove={onRemove}>
    <label className="dashboard-widget-name">Nombre<input value={widget.title} maxLength={100} onChange={(event) => onChange({ ...widget, title: event.target.value })} placeholder="Ej. Safes por unidad" /></label>
    <div className="dashboard-widget-sentence">
      <span>Medir</span>
      <CompactSelect value={widget.measure} ariaLabel={`Qué medir en ${widget.title}`} options={MEASURE_OPTIONS} onChange={(value) => onChange({ ...widget, measure: value as DashboardWidget['measure'], value_format: DASHBOARD_PERCENTAGE_MEASURES.has(value as DashboardWidget['measure']) ? 'percentage' : 'count', baseline_value: null })} />
    </div>
  </WidgetCardShell>;
}

function WidgetDisplayCard({ widget, index, onChange }: { widget: DashboardWidget; index: number; onChange: (widget: DashboardWidget) => void }) {
  const setKind = (kind: string) => onChange({
    ...widget,
    kind: kind as 'count' | 'goal' | 'chart',
    measure: kind === 'chart' && !['safes', 'accounts'].includes(widget.measure) ? 'safes' : widget.measure,
    value_format: kind === 'chart' || !DASHBOARD_PERCENTAGE_MEASURES.has(widget.measure) ? 'count' : 'percentage',
    chart: kind === 'chart' ? (widget.chart ?? { style: 'pie', group_by: DASHBOARD_DIMENSIONS[0] }) : null,
    target_value: kind === 'goal' ? (widget.target_value ?? 0) : null,
    target_direction: kind === 'goal' ? (widget.target_direction || 'at_most') : null,
    period_label: kind === 'goal' ? widget.period_label : null,
    baseline_value: null,
    size: kind === 'count' ? 'sm' : widget.size,
    position: kind === 'count' ? null : widget.position,
  });
  return <WidgetCardShell index={index} title={widget.title}>
    <div className="dashboard-widget-core"><label>Tipo<CompactSelect value={widget.kind} ariaLabel={`Tipo de ${widget.title}`} options={KIND_OPTIONS} onChange={setKind} /></label>{widget.kind === 'chart' && !(widget.chart && ADVANCED_DIMENSIONS.has(widget.chart.group_by)) ? <label>Medida<CompactSelect value={widget.measure} ariaLabel={`Medida del gráfico de ${widget.title}`} options={CHART_MEASURE_OPTIONS} onChange={(value) => onChange({ ...widget, measure: value as 'safes' | 'accounts', value_format: 'count' })} /></label> : null}</div>
    {widget.kind === 'chart' ? <div className="dashboard-widget-chart-options">
      <label>Mostrar como<CompactSelect value={widget.chart?.style ?? 'pie'} ariaLabel={`Gráfico de ${widget.title}`} options={STYLE_OPTIONS} onChange={(value) => {
        const style = value as NonNullable<DashboardWidget['chart']>['style'];
        const isAdvanced = Boolean(ADVANCED_STYLE_DIMENSION[style as keyof typeof ADVANCED_STYLE_DIMENSION]);
        onChange({ ...widget, measure: isAdvanced ? 'safes' : widget.measure, chart: { style, group_by: ADVANCED_STYLE_DIMENSION[style as keyof typeof ADVANCED_STYLE_DIMENSION] ?? DASHBOARD_DIMENSIONS[0] }, filters: isAdvanced ? { ...EMPTY_DASHBOARD_FILTERS } : widget.filters, size: isAdvanced ? 'md' : widget.size });
      }} /></label>
      {widget.chart && !ADVANCED_STYLE_DIMENSION[widget.chart.style as keyof typeof ADVANCED_STYLE_DIMENSION]
        ? <label>Agrupar por<CompactSelect value={widget.chart.group_by} ariaLabel={`Agrupar gráfico de ${widget.title}`} options={DIMENSION_OPTIONS} onChange={(value) => onChange({ ...widget, chart: { style: widget.chart?.style ?? 'pie', group_by: value as DashboardChartDimension } })} /></label>
        : <div className="dashboard-chart-cross-note"><strong>Cruce preconfigurado</strong><small>{widget.chart ? DASHBOARD_DIMENSION_LABELS[widget.chart.group_by] : ''}</small></div>}
    </div> : null}
    {widget.kind === 'goal' ? <div className="dashboard-widget-goal">
      <label>Meta<input type="number" aria-label="Meta" min="0" max="10000000" value={widget.target_value === null ? '' : widget.target_value} onChange={(event) => { const raw = event.target.value; onChange({ ...widget, target_value: raw === '' ? null : Number(raw), baseline_value: null }); }} aria-invalid={widget.target_value === null} />{widget.target_value === null ? <small className="dashboard-field-error">Definí una meta para continuar.</small> : null}</label>
      <label>Objetivo<CompactSelect value={widget.target_direction || 'at_most'} ariaLabel={`Dirección de la meta ${widget.title}`} options={[{ value: 'at_most', label: 'Llegar como máximo a' }, { value: 'at_least', label: 'Llegar como mínimo a' }]} onChange={(value) => onChange({ ...widget, target_direction: value as 'at_most' | 'at_least', baseline_value: null })} /></label>
      <label>Período<input value={widget.period_label || ''} maxLength={40} onChange={(event) => onChange({ ...widget, period_label: event.target.value })} placeholder="Ej. Q4 2026" /></label>
    </div> : null}
  </WidgetCardShell>;
}

function ZonePicker({ size, position, occupied, onPick }: { size: DashboardWidgetSize; position: number | null; occupied: Set<number>; onPick: (zone: number) => void }) {
  const currentZones = position !== null && dashboardZoneFits(position, size) ? dashboardZonesCovered(position, size) : [];
  return <div className="dashboard-zone-picker" role="group" aria-label="Elegí la zona del panel (6 zonas)">
    {Array.from({ length: DASHBOARD_ZONE_COUNT }, (_, zone) => {
      const fits = dashboardZoneFits(zone, size);
      const zonesIfPicked = fits ? dashboardZonesCovered(zone, size) : [];
      const blocked = zonesIfPicked.some((covered) => occupied.has(covered));
      const isCurrent = currentZones.includes(zone);
      return <button
        key={zone}
        type="button"
        className={`dashboard-zone ${isCurrent ? 'selected' : ''} ${occupied.has(zone) && !isCurrent ? 'occupied' : ''}`.trim()}
        disabled={!fits || (blocked && !isCurrent)}
        aria-pressed={isCurrent}
        aria-label={`Zona ${zone + 1}`}
        onClick={() => onPick(zone)}
      >{zone + 1}</button>;
    })}
  </div>;
}

function WidgetLayoutCard({ widget, index, occupied, onChange }: { widget: DashboardWidget; index: number; occupied: Set<number>; onChange: (widget: DashboardWidget) => void }) {
  const setSize = (size: DashboardWidgetSize) => {
    const zones = widget.position !== null && dashboardZoneFits(widget.position, size) ? dashboardZonesCovered(widget.position, size) : null;
    const stillFits = zones !== null && !zones.some((zone) => occupied.has(zone));
    onChange({ ...widget, size, position: stillFits ? widget.position : null });
  };
  if (widget.kind === 'count') return <WidgetCardShell index={index} title={widget.title}>
    <div className="dashboard-compact-layout-note">
      <Gauge size={18} aria-hidden />
      <div><strong>Se mostrará en Datos clave</strong><p>Los datos destacados se acomodan juntos en una franja compacta para aprovechar mejor el espacio.</p></div>
    </div>
  </WidgetCardShell>;
  return <WidgetCardShell index={index} title={widget.title}>
    <div className="dashboard-widget-size-row">
      {SIZE_OPTIONS.map((size) => <button key={size} type="button" className={`dashboard-size-chip ${widget.size === size ? 'selected' : ''}`.trim()} onClick={() => setSize(size)} aria-pressed={widget.size === size}>
        <strong>{DASHBOARD_SIZE_LABELS[size]}</strong><small>{DASHBOARD_SIZE_HINTS[size]}</small>
      </button>)}
    </div>
    <div className="dashboard-widget-zone-field">
      <div className="dashboard-widget-zone-header">
        <span>Zona en el panel</span>
        {widget.position !== null ? <button type="button" className="dashboard-zone-auto" onClick={() => onChange({ ...widget, position: null })}>Automático</button> : null}
      </div>
      <ZonePicker size={widget.size} position={widget.position} occupied={occupied} onPick={(zone) => onChange({ ...widget, position: zone })} />
    </div>
  </WidgetCardShell>;
}

function WidgetFiltersCard({ widget, index, onChange, includeInternal }: { widget: DashboardWidget; index: number; onChange: (widget: DashboardWidget) => void; includeInternal: boolean }) {
  const [filtersOpen, setFiltersOpen] = useState(hasActiveFilter(widget));
  const updateFilter = (key: keyof DashboardWidgetFilters, value: string) => onChange({ ...widget, filters: { ...widget.filters, [key]: value }, baseline_value: null });
  return <WidgetCardShell index={index} title={widget.title}>
    {['safes', 'accounts'].includes(widget.measure) && !(widget.chart && ADVANCED_DIMENSIONS.has(widget.chart.group_by)) ? <details className="dashboard-widget-filters-group" open={filtersOpen} onToggle={(event) => setFiltersOpen((event.target as HTMLDetailsElement).open)}>
      <summary>Acotar (opcional)</summary>
      <div className="dashboard-widget-filters">
        <label>Estado<CompactSelect value={widget.filters.workflow_status} ariaLabel={`Estado de ${widget.title}`} options={FILTER_OPTIONS.workflow_status} onChange={(value) => updateFilter('workflow_status', value)} /></label>
        <label>Clasificación<CompactSelect value={widget.filters.classification_status} ariaLabel={`Clasificación de ${widget.title}`} options={FILTER_OPTIONS.classification_status} onChange={(value) => updateFilter('classification_status', value)} /></label>
        <label>Alcance<CompactSelect value={widget.filters.inventory_scope} ariaLabel={`Alcance de ${widget.title}`} options={FILTER_OPTIONS.inventory_scope} onChange={(value) => updateFilter('inventory_scope', value)} /></label>
        <label>Señal técnica<CompactSelect value={widget.filters.health_filter} ariaLabel={`Señal técnica de ${widget.title}`} options={FILTER_OPTIONS.health_filter} onChange={(value) => updateFilter('health_filter', value)} /></label>
      </div>
    </details> : <p className="dashboard-widget-preview-hint">Esta métrica usa un cruce global y no necesita filtros de Safes.</p>}
    <WidgetPreview widget={widget} includeInternal={includeInternal} />
  </WidgetCardShell>;
}

function widgetTypeLabel(widget: DashboardWidget): string {
  if (widget.kind === 'chart') return `Gráfico ${widget.chart?.style === 'bars' ? 'de barras' : widget.chart?.style === 'pie' ? 'de torta' : widget.chart?.style ?? ''}`;
  return widget.kind === 'goal' ? 'Objetivo' : 'Contador';
}

function ShortcutIcon({ id }: { id: DashboardShortcutId }) {
  const Icon = id === 'pending-classification' ? ShieldAlert
    : id === 'without-accounts' || id === 'without-cpm' || id === 'without-retention' ? Database
      : id === 'accounts-by-company' ? Users
        : id === 'pam-users' ? Users
          : id === 'pam-roles' ? ShieldAlert
            : id === 'sia-policies' ? Server
              : id === 'connection-inventory' ? Server
                : id.endsWith('coverage') ? CircleCheck
                  : id === 'in-progress' ? Timer
                    : id === 'safes-by-action' || id === 'accounts-by-type' ? Gauge
                    : id === 'safes-by-company' || id === 'status-distribution' || id === 'workflow-next-action' ? LayoutGrid : Database;
  return <Icon size={16} aria-hidden />;
}

function DashboardWidgetManager({ widgets, saving, onCreate, onQuickCreate, onEdit, onDuplicate, onDelete }: {
  widgets: DashboardWidget[];
  saving: boolean;
  onCreate: (kind: 'count' | 'chart') => void;
  onQuickCreate: (id: DashboardShortcutId) => void;
  onEdit: (widget: DashboardWidget) => void;
  onDuplicate: (widget: DashboardWidget) => void;
  onDelete: (widget: DashboardWidget) => void;
}) {
  const [shortcutView, setShortcutView] = useState<'data' | 'charts'>('data');
  const visibleShortcuts = DASHBOARD_SHORTCUTS.filter((shortcut) => shortcutView === 'charts' ? shortcut.kind === 'chart' : shortcut.kind !== 'chart');
  const visibleWidgets = widgets.filter((widget) => shortcutView === 'charts' ? widget.kind === 'chart' : widget.kind !== 'chart');
  const dataCount = DASHBOARD_SHORTCUTS.length - DASHBOARD_SHORTCUTS.filter((shortcut) => shortcut.kind === 'chart').length;
  const chartCount = DASHBOARD_SHORTCUTS.length - dataCount;
  const savedDataCount = widgets.filter((widget) => widget.kind === 'count').length;
  const savedVisualCount = widgets.length - savedDataCount;
  const shortcutDisabled = (kind: DashboardWidget['kind']) => saving || (kind === 'count' ? savedDataCount >= 6 : savedVisualCount >= 6);
  return <div className="dashboard-manager-content">
    <div className="dashboard-manager-intro">
      <div><span className="eyebrow">MÉTRICAS GUARDADAS</span><p>Usá un atajo para empezar o configurá un indicador desde cero. Después podés editarlo.</p></div>
      <button type="button" className="button primary" onClick={() => onCreate(shortcutView === 'charts' ? 'chart' : 'count')} disabled={shortcutDisabled(shortcutView === 'charts' ? 'chart' : 'count')}><Plus size={14} /> {shortcutView === 'charts' ? 'Nuevo gráfico' : 'Nuevo dato'}</button>
    </div>
    <section className="dashboard-shortcuts" aria-labelledby="dashboard-shortcuts-title">
      <div className="dashboard-shortcuts-heading">
        <div>
          <span className="eyebrow">ATAJOS</span>
          <h3 id="dashboard-shortcuts-title">Empezá con una vista lista</h3>
          <p>Elegí una plantilla con filtros útiles y guardala en un clic.</p>
        </div>
        <span className="dashboard-shortcuts-limit">{savedDataCount}/6 datos · {savedVisualCount}/6 visuales</span>
      </div>
      <div className="dashboard-shortcut-tabs" role="tablist" aria-label="Tipo de representación" onKeyDown={handleTablistKeyDown}>
        <button type="button" role="tab" aria-selected={shortcutView === 'data'} tabIndex={shortcutView === 'data' ? 0 : -1} className={shortcutView === 'data' ? 'active' : ''} onClick={() => setShortcutView('data')}>
          <Gauge size={15} aria-hidden /><span><strong>Datos</strong><small>{dataCount} indicadores compactos</small></span>
        </button>
        <button type="button" role="tab" aria-selected={shortcutView === 'charts'} tabIndex={shortcutView === 'charts' ? 0 : -1} className={shortcutView === 'charts' ? 'active' : ''} onClick={() => setShortcutView('charts')}>
          <LayoutGrid size={15} aria-hidden /><span><strong>Gráficos</strong><small>{chartCount} comparaciones visuales</small></span>
        </button>
      </div>
      <div className="dashboard-shortcut-groups">
        {DASHBOARD_SHORTCUT_GROUPS.map((group) => {
          const groupShortcuts = visibleShortcuts.filter((shortcut) => shortcut.group === group.id);
          return groupShortcuts.length ? <section className="dashboard-shortcut-group" key={group.id} aria-labelledby={`dashboard-shortcut-group-${group.id}`}>
          <div className="dashboard-shortcut-group-heading"><strong id={`dashboard-shortcut-group-${group.id}`}>{group.label}</strong><small>{group.hint}</small></div>
          <div className="dashboard-shortcut-grid">
            {groupShortcuts.map((shortcut) => <button
              key={shortcut.id}
              type="button"
              className="dashboard-shortcut"
              aria-label={`Crear vista rápida: ${shortcut.title}`}
              disabled={shortcutDisabled(shortcut.kind)}
              onClick={() => onQuickCreate(shortcut.id)}
            >
              <span className="dashboard-shortcut-icon"><ShortcutIcon id={shortcut.id} /></span>
              <span className="dashboard-shortcut-copy"><strong>{shortcut.title}</strong><small>{shortcut.detail}</small></span>
              <ArrowRight size={14} aria-hidden />
            </button>)}
          </div>
        </section> : null;})}
      </div>
      {shortcutView === 'charts' ? <section className="dashboard-shortcut-group" aria-labelledby="dashboard-unavailable-charts-title">
        <div className="dashboard-shortcut-group-heading"><strong id="dashboard-unavailable-charts-title">Requieren más datos</strong><small>Opciones disponibles cuando exista una fuente verificable</small></div>
        <div className="dashboard-shortcut-grid">{DASHBOARD_UNAVAILABLE_CHARTS.map((chart) => <button key={chart.id} type="button" className="dashboard-shortcut dashboard-shortcut-unavailable" disabled title={chart.detail}>
          <span className="dashboard-shortcut-icon"><LayoutGrid size={16} aria-hidden /></span><span className="dashboard-shortcut-copy"><strong>{chart.title}</strong><small>{chart.detail}</small></span>
        </button>)}</div>
      </section> : null}
    </section>
    <div className="dashboard-manager-list-heading"><strong>{shortcutView === 'charts' ? 'Gráficos configurados' : 'Datos configurados'}</strong><span>{visibleWidgets.length}</span></div>
    {visibleWidgets.length ? <div className="dashboard-manager-list">{visibleWidgets.map((widget, index) => <article className="dashboard-manager-row" key={widget.widget_id}>
      <span className="dashboard-manager-index">{String(index + 1).padStart(2, '0')}</span>
      <div className="dashboard-manager-copy"><strong>{widget.title}</strong><span>{widgetTypeLabel(widget)} · {dashboardValueLabel(widget)} actual</span><small>{dashboardWidgetDetail(widget)}</small></div>
      <div className="dashboard-manager-actions">
        <button type="button" className="icon-button" aria-label={`Editar ${widget.title}`} title={`Editar ${widget.title}`} onClick={() => onEdit(widget)}><Pencil size={14} /></button>
        <button type="button" className="icon-button" aria-label={`Duplicar ${widget.title}`} title={`Duplicar ${widget.title}`} onClick={() => onDuplicate(widget)} disabled={shortcutDisabled(widget.kind)}><Copy size={14} /></button>
        <button type="button" className="icon-button danger" aria-label={`Eliminar ${widget.title}`} title={`Eliminar ${widget.title}`} onClick={() => onDelete(widget)} disabled={saving}><Trash2 size={14} /></button>
      </div>
    </article>)}</div> : <div className="dashboard-manager-empty"><p>{shortcutView === 'charts' ? 'Todavía no configuraste gráficos.' : 'Todavía no configuraste datos.'}</p><button type="button" className="button subtle" onClick={() => onCreate(shortcutView === 'charts' ? 'chart' : 'count')} disabled={shortcutDisabled(shortcutView === 'charts' ? 'chart' : 'count')}><Plus size={14} /> Crear el primero</button></div>}
  </div>;
}

export function DashboardCustomizer({ widgets, saving, onSave, onClose, mode = 'manage', includeInternal = true }: Props) {
  const standaloneCreate = mode === 'create';
  const [screen, setScreen] = useState<'manage' | 'builder'>('manage');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DashboardWidget[]>([]);
  const [pendingDelete, setPendingDelete] = useState<DashboardWidget | null>(null);
  const [step, setStep] = useState<StepId>(1);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onClose, initialFocusRef: closeRef });
  const hasCapacity = (kind: DashboardWidget['kind'], excludingId: string | null = null) => {
    const remaining = widgets.filter((widget) => widget.widget_id !== excludingId);
    return (kind === 'count' ? remaining.filter((widget) => widget.kind === 'count').length : remaining.filter((widget) => widget.kind !== 'count').length) < 6;
  };
  const change = (index: number, widget: DashboardWidget) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? widget : item));
  const openCreate = (preferredKind?: 'count' | 'chart') => {
    if (!hasCapacity('count') && !hasCapacity('chart')) return;
    const base = createDashboardWidget(widgets.length);
    const createChart = preferredKind === 'chart' || !hasCapacity('count');
    setDraft([createChart ? { ...base, kind: 'chart', chart: { style: 'pie', group_by: DASHBOARD_DIMENSIONS[0] } } : base]);
    setEditingId(null); setStep(1); setScreen('builder');
  };
  const quickCreate = (shortcutId: DashboardShortcutId) => {
    const shortcut = createDashboardShortcut(shortcutId, widgets.length);
    if (saving || !hasCapacity(shortcut.kind)) return;
    void onSave([...widgets, shortcut]);
  };
  const openEdit = (widget: DashboardWidget) => { setDraft([{ ...widget, filters: { ...widget.filters } }]); setEditingId(widget.widget_id); setStep(1); setScreen('builder'); };
  const submit = async () => {
    if (!draft[0]) return;
    const normalizedDraft = draft[0].kind === 'count' ? { ...draft[0], size: 'sm' as const, position: null } : draft[0];
    const next = editingId === null ? [...widgets, normalizedDraft] : widgets.map((widget) => widget.widget_id === editingId ? normalizedDraft : widget);
    if (!(await onSave(next))) return;
    if (standaloneCreate || editingId === null) onClose();
    else { setScreen('manage'); setEditingId(null); setDraft([]); setStep(1); }
  };
  const duplicate = (widget: DashboardWidget) => {
    if (!hasCapacity(widget.kind)) return;
    const copy = { ...widget, widget_id: `custom-${Date.now()}-${widgets.length}`, title: `${widget.title} · copia`, position: null, filters: { ...widget.filters }, chart: widget.chart ? { ...widget.chart } : null };
    void onSave([...widgets, copy]);
  };
  const remove = (widget: DashboardWidget) => setPendingDelete(widget);
  const confirmRemove = async () => {
    if (!pendingDelete) return;
    if (await onSave(widgets.filter((item) => item.widget_id !== pendingDelete.widget_id))) setPendingDelete(null);
  };
  const hasEmptyTitle = draft.some((widget) => !widget.title.trim());
  const canAdvance = draft.length > 0 && !hasEmptyTitle;
  const hasInvalidGoal = draft.some((widget) => widget.kind === 'goal' && (widget.target_value === null || !Number.isFinite(widget.target_value)));
  const canSave = canAdvance && !hasInvalidGoal && Boolean(draft[0] && hasCapacity(draft[0].kind, editingId));
  const currentStepMeta = STEPS[step - 1];
  const stepDescription: Record<StepId, string> = {
    1: 'Elegí qué querés medir y poné un nombre fácil de reconocer.',
    2: 'Elegí si necesitás un dato, un objetivo o una comparación visual.',
    3: 'Los datos se agrupan automáticamente. Los gráficos y objetivos usan una grilla 3×2 de seis zonas.',
    4: 'Acotá con filtros opcionales y revisá el resultado antes de guardar.',
  };

  return <div ref={dialogRef} className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="dashboard-customizer-title" tabIndex={-1}>
    <button className="drawer-backdrop" type="button" aria-label="Cerrar personalización" onClick={onClose} />
    <aside className="detail-drawer dashboard-customizer">
      <div className="detail-title">
        <div className="detail-heading">
          <p className="eyebrow">MI VISTA {screen === 'builder' ? `· PASO ${step} DE ${STEPS.length}` : ''}</p>
          <h2 id="dashboard-customizer-title">{screen === 'builder' ? (editingId ? 'Editar métrica' : 'Crear métrica') : standaloneCreate ? 'Elegí una vista' : 'Editar vista'}</h2>
          <p>{screen === 'builder' ? stepDescription[step] : standaloneCreate ? 'Usá un atajo listo o configurá una métrica desde cero.' : 'Elegí una métrica para editarla o agregá un indicador nuevo.'}</p>
        </div>
        <button ref={closeRef} className="icon-button drawer-close" type="button" aria-label="Cerrar" title="Cerrar personalización" onClick={onClose}><X size={16} /></button>
      </div>

      {screen === 'builder' ? <nav className="dashboard-customizer-steps" aria-label="Pasos para crear la métrica">
        {STEPS.map((item) => {
          const state = item.id < step ? 'done' : item.id === step ? 'active' : 'upcoming';
          return <button
            key={item.id}
            type="button"
            className={`dashboard-customizer-step ${state}`}
            onClick={() => { if (item.id <= step || canAdvance) setStep(item.id); }}
            disabled={item.id > step && !canAdvance}
            aria-current={item.id === step ? 'step' : undefined}
          >
            <span className="dashboard-customizer-step-badge">{state === 'done' ? <Check size={12} /> : item.id}</span>
            <span className="dashboard-customizer-step-text"><strong>{item.label}</strong><small>{item.hint}</small></span>
          </button>;
        })}
      </nav> : null}

      {screen === 'builder' ? <div className="dashboard-customizer-count"><span>{editingId ? 'Editando 1 métrica' : 'Nueva métrica'}</span><small>{currentStepMeta.hint}</small></div> : null}

      {screen === 'manage' ? <DashboardWidgetManager widgets={widgets} saving={saving} onCreate={openCreate} onQuickCreate={quickCreate} onEdit={openEdit} onDuplicate={duplicate} onDelete={remove} />
        : <div className="dashboard-step-grid">
          {step === 1 && draft.map((widget, index) => <WidgetBasicsCard key={widget.widget_id} widget={widget} index={index} onChange={(next) => change(index, next)} />)}
          {step === 2 && draft.map((widget, index) => <WidgetDisplayCard key={widget.widget_id} widget={widget} index={index} onChange={(next) => change(index, next)} />)}
          {step === 3 && draft.map((widget, index) => <WidgetLayoutCard key={widget.widget_id} widget={widget} index={index} occupied={occupiedVisualZones(widgets, widget.widget_id)} onChange={(next) => change(index, next)} />)}
          {step === 4 && draft.map((widget, index) => <WidgetFiltersCard key={widget.widget_id} widget={widget} index={index} includeInternal={includeInternal} onChange={(next) => change(index, next)} />)}
        </div>}

      {screen === 'builder' ? <div className="dashboard-customizer-actions">
        {step > 1 ? <button className="button subtle" type="button" onClick={() => setStep((current) => (current - 1) as StepId)}><ArrowLeft size={14} /> Atrás</button> : <button className="button subtle" type="button" onClick={standaloneCreate ? onClose : () => setScreen('manage')}>Cancelar</button>}
        {step < STEPS.length ? <button className="button primary" type="button" disabled={!canAdvance} onClick={() => setStep((current) => (current + 1) as StepId)}>Siguiente <ArrowRight size={14} /></button> : <button className="button primary" type="button" disabled={saving || !canSave} onClick={() => void submit()}>{saving ? 'Guardando...' : 'Guardar métrica'}</button>}
      </div> : <div className="dashboard-customizer-actions"><button className="button subtle" type="button" onClick={onClose}>Cerrar</button><button className="button primary" type="button" onClick={() => openCreate()} disabled={!hasCapacity('count') && !hasCapacity('chart')}><Plus size={14} /> Nueva métrica</button></div>}
      {pendingDelete ? <ConfirmDialog
        icon={<Trash2 size={18} />}
        titleId="delete-metric-title"
        title="Eliminar métrica"
        descriptionId="delete-metric-copy"
        description={<>¿Querés eliminar <strong>{pendingDelete.title}</strong> de tu vista?</>}
        onClose={() => setPendingDelete(null)}
        closeDisabled={saving}
        confirmLabel="Eliminar métrica"
        confirmBusyLabel="Eliminando..."
        confirmBusy={saving}
        onConfirm={() => void confirmRemove()}
        backdropClassName="dashboard-confirm-backdrop"
      /> : null}
    </aside>
  </div>;
}
