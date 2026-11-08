import { useEffect, useState } from 'react';
import { AlertTriangle, CircleCheck, Database, Gauge, LayoutGrid, Server, ShieldAlert, Timer, Trash2, Users } from 'lucide-react';
import { CompactSelect, type CompactSelectOption } from '../../../cross/components/compact-select';
import { BarList, Metric } from '../../../cross/components/dashboard';
import { PieChart } from '../../../cross/components/pie-chart';
import { AdvancedChart } from './advanced-chart';
import { WORKFLOW_STATUSES, workflowLabel } from '../lib/safe-labels';
import {
  DASHBOARD_DIMENSION_LABELS,
  DASHBOARD_DIMENSIONS,
  DASHBOARD_MEASURE_LABELS,
  DASHBOARD_PERCENTAGE_MEASURES,
  dashboardWidgetEmptyAfterFilters,
  type DashboardChartDimension,
  DASHBOARD_ADVANCED_CHART_DIMENSIONS,
  ADVANCED_STYLE_DIMENSION,
  withChartStyle,
  type DashboardShortcutId,
  type DashboardWidget,
  type DashboardWidgetFilters,
} from '../lib/dashboard-metrics';
import { previewDashboardWidget } from '../lib/dashboard-preferences-api';
import { ApiError } from '../../../cross/lib/api';
import '../../../cross/components/dashboard-widget.css';
import { t } from '../../../cross/i18n/index.ts';

const EMPTY_OPTION = { value: '', label: t('No filtrar') };

/** Shared filter selects for a PAM widget's Estado/Clasificación/Alcance/Señal
 * técnica. Used by the in-place editor and (until VIEW-008 finishes) by the
 * dashboard customizer. */
export const FILTER_OPTIONS: Record<keyof DashboardWidgetFilters, CompactSelectOption[]> = {
  workflow_status: [EMPTY_OPTION, ...WORKFLOW_STATUSES.map((status) => ({ value: status, label: workflowLabel(status) }))],
  classification_status: [EMPTY_OPTION, { value: 'pending', label: t('Pendiente') }, { value: 'assigned', label: t('Asignada') }, { value: 'review', label: t('En revisión') }],
  inventory_scope: [EMPTY_OPTION, { value: 'pending', label: t('Pendiente') }, { value: 'business', label: t('Negocio') }, { value: 'internal', label: t('Interno CyberArk') }],
  data_quality_status: [EMPTY_OPTION, { value: 'pending', label: t('Pendiente') }, { value: 'clean', label: t('Depurado') }, { value: 'obsolete', label: t('Obsoleto') }, { value: 'duplicate', label: t('Duplicado') }],
  health_filter: [EMPTY_OPTION, { value: 'missing_cpm', label: t('Sin CPM') }, { value: 'no_accounts', label: t('Sin cuentas') }, { value: 'retention_unconfigured', label: t('Sin retención') }, { value: 'manage_safe_concentration', label: t('Manage Safe compartido') }],
};

export function ShortcutIcon({ id }: { id: DashboardShortcutId }) {
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

/** Live, debounced preview of a widget's current data. Shared so both the
 * in-place editor and the customizer show the same result. */
export function DashboardWidgetPreview({ widget, includeInternal = true }: { widget: DashboardWidget; includeInternal?: boolean }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` already encodes the widget config that drives the preview
  }, [signature, widget.title, includeInternal]);

  if (error) return <p className="dashboard-widget-preview-hint">{error}</p>;
  if (!result) return <p className="dashboard-widget-preview-hint">{loading ? t('Calculando…') : t('Escribí un nombre para ver la previsualización.')}</p>;
  // A real 0 under active filters is not the same as an empty source: warn
  // that the block would stay at 0 so the operator can adjust the toolbar
  // filters before saving (VIEW-005).
  const warning = dashboardWidgetEmptyAfterFilters(result)
    ? <p className={`dashboard-widget-preview-warning${loading ? ' is-stale' : ''}`} role="status"><AlertTriangle size={13} aria-hidden="true" />{t('Ningún dato cumple los filtros aplicados: el bloque quedaría en 0. Quitá o ajustá filtros en la barra.')}</p>
    : null;
  if (result.kind === 'chart' && result.chart) {
    const buckets = result.buckets ?? [];
    return <>
      {warning}
      <div className={`dashboard-widget-preview ${loading ? 'is-stale' : ''}`.trim()}>
        {result.chart.style === 'pie'
          ? <PieChart buckets={buckets} size={112} thickness={18} />
          : result.chart.style === 'bars'
            ? <BarList buckets={buckets} emptyHint="Sin datos para este corte." />
            : <AdvancedChart title={result.title} style={result.chart.style} data={result.chart_data} />}
      </div>
    </>;
  }
  return <>
    {warning}
    <div className={`dashboard-widget-preview ${loading ? 'is-stale' : ''}`.trim()}>
      <Metric label={t('Resultado actual')} value={result.value} detail={DASHBOARD_MEASURE_LABELS[result.measure]} />
    </div>
  </>;
}

// --- In-place widget configuration (VIEW-008) ---

const MEASURE_OPTIONS: CompactSelectOption[] = Object.entries(DASHBOARD_MEASURE_LABELS).map(([value, label]) => ({ value, label }));
const CHART_MEASURE_OPTIONS: CompactSelectOption[] = ['safes', 'accounts'].map((value) => ({ value, label: DASHBOARD_MEASURE_LABELS[value as 'safes' | 'accounts'] }));
const STYLE_OPTIONS: CompactSelectOption[] = [
  { value: 'pie', label: t('Torta') }, { value: 'bars', label: t('Barras') },
  { value: 'line', label: t('Línea · evolución') }, { value: 'heatmap', label: t('Mapa de calor · cruce') },
  { value: 'scatter', label: t('Dispersión · correlación') }, { value: 'combo', label: t('Combinado · barras y línea') },
];
const KIND_OPTIONS: CompactSelectOption[] = [{ value: 'count', label: t('Dato destacado') }, { value: 'goal', label: t('Objetivo') }, { value: 'chart', label: t('Gráfico') }];
const DIMENSION_OPTIONS: CompactSelectOption[] = DASHBOARD_DIMENSIONS.map((dimension) => ({ value: dimension, label: `Por ${DASHBOARD_DIMENSION_LABELS[dimension]}` }));

function WidgetCardShell({ index, title, onRemove, children }: { index: number; title: string; onRemove?: () => void; children: React.ReactNode }) {
  return <article className="dashboard-widget-card">
    <div className="dashboard-widget-editor-heading">
      <span>Métrica {index + 1}{title.trim() ? ` · ${title.trim()}` : ''}</span>
      {onRemove ? <button type="button" className="icon-button" aria-label={`Quitar métrica ${index + 1}`} title={`Quitar métrica ${index + 1}`} onClick={onRemove}><Trash2 size={14} /></button> : null}
    </div>
    {children}
  </article>;
}

export function WidgetBasicsCard({ widget, index, onChange, onRemove }: { widget: DashboardWidget; index: number; onChange: (widget: DashboardWidget) => void; onRemove?: () => void }) {
  return <WidgetCardShell index={index} title={widget.title} onRemove={onRemove}>
    <label className="dashboard-widget-name">{t('Nombre')}<input value={widget.title} maxLength={100} onChange={(event) => onChange({ ...widget, title: event.target.value })} placeholder={t('Ej. Safes por unidad')} /></label>
    <div className="dashboard-widget-sentence">
      <span>{t('Medir')}</span>
      <CompactSelect value={widget.measure} ariaLabel={`Qué medir en ${widget.title}`} options={MEASURE_OPTIONS} onChange={(value) => onChange({ ...widget, measure: value as DashboardWidget['measure'], value_format: DASHBOARD_PERCENTAGE_MEASURES.has(value as DashboardWidget['measure']) ? 'percentage' : 'count', baseline_value: null })} />
    </div>
  </WidgetCardShell>;
}

export function WidgetDisplayCard({ widget, index, onChange }: { widget: DashboardWidget; index: number; onChange: (widget: DashboardWidget) => void }) {
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
    <div className="dashboard-widget-core"><label>{t('Tipo')}<CompactSelect value={widget.kind} ariaLabel={`Tipo de ${widget.title}`} options={KIND_OPTIONS} onChange={setKind} /></label>{widget.kind === 'chart' && !(widget.chart && DASHBOARD_ADVANCED_CHART_DIMENSIONS.has(widget.chart.group_by)) ? <label>{t('Medida')}<CompactSelect value={widget.measure} ariaLabel={`Medida del gráfico de ${widget.title}`} options={CHART_MEASURE_OPTIONS} onChange={(value) => onChange({ ...widget, measure: value as 'safes' | 'accounts', value_format: 'count' })} /></label> : null}</div>
    {widget.kind === 'chart' ? <div className="dashboard-widget-chart-options">
      {widget.chart && ADVANCED_STYLE_DIMENSION[widget.chart.style as keyof typeof ADVANCED_STYLE_DIMENSION] ? <label>{t('Mostrar como')}<CompactSelect value={widget.chart.style} ariaLabel={`Gráfico de ${widget.title}`} options={STYLE_OPTIONS} onChange={(value) => onChange(withChartStyle(widget, value as NonNullable<DashboardWidget['chart']>['style']))} /></label> : null}
      {widget.chart && !ADVANCED_STYLE_DIMENSION[widget.chart.style as keyof typeof ADVANCED_STYLE_DIMENSION]
        ? <label>{t('Agrupar por')}<CompactSelect value={widget.chart.group_by} ariaLabel={`Agrupar gráfico de ${widget.title}`} options={DIMENSION_OPTIONS} onChange={(value) => onChange({ ...widget, chart: { style: widget.chart?.style ?? 'pie', group_by: value as DashboardChartDimension } })} /></label>
        : <div className="dashboard-chart-cross-note"><strong>{t('Cruce preconfigurado')}</strong><small>{widget.chart ? DASHBOARD_DIMENSION_LABELS[widget.chart.group_by] : ''}</small></div>}
    </div> : null}
    {widget.kind === 'goal' ? <div className="dashboard-widget-goal">
      <label>{t('Meta')}<input type="number" aria-label={t('Meta')} min="0" max="10000000" value={widget.target_value === null ? '' : widget.target_value} onChange={(event) => { const raw = event.target.value; onChange({ ...widget, target_value: raw === '' ? null : Number(raw), baseline_value: null }); }} aria-invalid={widget.target_value === null} />{widget.target_value === null ? <small className="dashboard-field-error">{t('Definí una meta para continuar.')}</small> : null}</label>
      <label>{t('Objetivo')}<CompactSelect value={widget.target_direction || 'at_most'} ariaLabel={`Dirección de la meta ${widget.title}`} options={[{ value: 'at_most', label: t('Llegar como máximo a') }, { value: 'at_least', label: t('Llegar como mínimo a') }]} onChange={(value) => onChange({ ...widget, target_direction: value as 'at_most' | 'at_least', baseline_value: null })} /></label>
      <label>{t('Período')}<input value={widget.period_label || ''} maxLength={40} onChange={(event) => onChange({ ...widget, period_label: event.target.value })} placeholder={t('Ej. Q4 2026')} /></label>
    </div> : null}
  </WidgetCardShell>;
}
