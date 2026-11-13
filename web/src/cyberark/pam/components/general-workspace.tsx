import { useRef, useState } from 'react';
import { ArrowRight, CircleCheck, LayoutDashboard, LayoutGrid, LayoutTemplate, ListChecks, Trash2, Plus, RotateCcw, ShieldAlert, SlidersHorizontal, Undo2 } from 'lucide-react';
import { BarList } from '../../../cross/components/dashboard';
import { PieChart } from '../../../cross/components/pie-chart';
import { AdvancedChart } from './advanced-chart';
import { HelpHint } from '../../../cross/components/help-hint';
import { CompactSelect } from '../../../cross/components/compact-select';
import { ConfirmDialog } from '../../../cross/components/confirm-dialog';
import { DashboardPresetMenu } from '../../../cross/components/dashboard-presets';
import { DashboardTemplatePublisher } from '../../../cross/components/dashboard-template-publisher';
import { DashboardWidgetPreview, FILTER_OPTIONS, ShortcutIcon, WidgetBasicsCard, WidgetDisplayCard } from './dashboard-widget-config';
import { DashboardEditItem, DashboardEditToolbar } from '../../../cross/components/dashboard-edit-item';
import { DashboardWidgetPicker, type DashboardPickerGroup } from '../../../cross/components/dashboard-widget-picker';
import { StateBlock } from '../../../cross/components/state-block';
import { DashboardDataItem } from './dashboard-data-item';
import './general-workspace.css';
import { useDashboardPreferences } from '../hooks/use-dashboard-preferences';
import { useDashboardShortcutPreviews, type ShortcutPreview } from '../hooks/use-dashboard-shortcut-previews';
import { useUnsavedChangesWarning } from '../../../cross/hooks/use-unsaved-changes-warning';
import { useDashboardTeamTemplates } from '../../../cross/hooks/use-dashboard-team-templates';
import { previewDashboardWidget } from '../lib/dashboard-preferences-api';
import {
  createDashboardShortcut, createDashboardWidget, dashboardWidgetAcceptsFilters, DASHBOARD_DIMENSIONS, DASHBOARD_PERCENTAGE_MEASURES, DASHBOARD_PRESETS, DASHBOARD_SHORTCUTS,
  DASHBOARD_SHORTCUT_GROUPS, DASHBOARD_UNAVAILABLE_CHARTS, DEFAULT_PAM_SHORTCUT_IDS, EMPTY_DASHBOARD_FILTERS, RECOMMENDED_PAM_SHORTCUT_IDS,
  dashboardGoalProgress, dashboardValueLabel, dashboardWidgetDetail, dashboardWidgetSignature,
  type DashboardMeasure, type DashboardPreset, type DashboardShortcut, type DashboardShortcutId, type DashboardWidget, type DashboardWidgetFilters,
} from '../lib/dashboard-metrics';
import {
  dashboardGridPlacement, dashboardZoneFits, dashboardZonesCovered,
  moveDashboardWidget, resolveDashboardRenderLayout, swapDashboardWidgets, type DashboardWidgetSize,
} from '../../../cross/lib/dashboard-layout';
import type { AnalyticsBucket } from '../types/safe';
import { t, localeTag } from '../../../cross/i18n/index.ts';

const PICKER_GROUP_ICONS: Record<string, React.ReactNode> = {
  coverage: <CircleCheck size={20} aria-hidden="true" />,
  operations: <ListChecks size={20} aria-hidden="true" />,
  quality: <ShieldAlert size={20} aria-hidden="true" />,
};

function shortcutSourceLabel(measure: DashboardMeasure): string {
  if (measure === 'connections' || measure === 'kr2_connection_coverage') return t('Fuente: CSV de conexiones · última carga');
  if (measure === 'cyberark_compliance') return t('Fuente: script de compliance · último cálculo publicado');
  return 'Fuente: CyberArk · inventario confirmado';
}

function shortcutAlreadySelected(shortcut: DashboardShortcut, widgets: DashboardWidget[]): boolean {
  const signature = dashboardWidgetSignature({
    kind: shortcut.kind,
    measure: shortcut.measure,
    filters: { ...EMPTY_DASHBOARD_FILTERS, ...shortcut.filters },
    chart: shortcut.chart,
  });
  return widgets.some((widget) => dashboardWidgetSignature(widget) === signature);
}

const RECOMMENDED_SHORTCUTS = new Set(RECOMMENDED_PAM_SHORTCUT_IDS);

/** A preset or reset waiting for the operator's explicit confirmation before
 * it replaces the saved view (VIEW-003). */
type PendingView = {
  title: string;
  description: string;
  confirmLabel: string;
  notice: string;
  icon: React.ReactNode;
  widgets: DashboardWidget[];
};

function shortcutVisualization(shortcut: DashboardShortcut): string {
  if (shortcut.kind !== 'chart') return 'Indicador';
  switch (shortcut.chart?.style) {
    case 'pie': return 'Dona';
    case 'line': return t('Línea');
    case 'heatmap': return t('Mapa de calor');
    case 'scatter': return t('Dispersión');
    case 'combo': return t('Barras + línea');
    default: return 'Barras';
  }
}

/** Real value/buckets for a shortcut, from a batched preview call -- mirrors
 * netskope-dashboard-editor.tsx's netskopePreview(), but only 'pie'/'bars'
 * charts reduce cleanly to a bucket list; the advanced styles (line,
 * heatmap, scatter, combo) keep the picker's generic placeholder shape. */
function shortcutPreviewFields(shortcut: DashboardShortcut, preview?: ShortcutPreview): { previewLabel?: string; previewBuckets?: AnalyticsBucket[]; previewChartData?: DashboardWidget['chart_data'] } {
  if (!preview) return {};
  if (shortcut.kind !== 'chart') {
    if (preview.data_status === 'unavailable') return { previewLabel: t('Sin datos') };
    const value = preview.value.toLocaleString(localeTag());
    return { previewLabel: DASHBOARD_PERCENTAGE_MEASURES.has(shortcut.measure) ? `${value}%` : value };
  }
  if (shortcut.chart?.style !== 'pie' && shortcut.chart?.style !== 'bars') return preview.chart_data ? { previewChartData: preview.chart_data } : {};
  const buckets = (preview.buckets ?? []).filter((bucket) => bucket.count > 0).slice().sort((a, b) => b.count - a.count).slice(0, 5);
  return buckets.length ? { previewBuckets: buckets } : {};
}

function shortcutPickerGroups(kind: 'data' | 'chart', selectedWidgets: DashboardWidget[], previews: Partial<Record<DashboardShortcutId, ShortcutPreview>>): DashboardPickerGroup[] {
  const groups: DashboardPickerGroup[] = DASHBOARD_SHORTCUT_GROUPS.map((group) => ({
    id: group.id,
    title: group.label,
    description: group.hint,
    icon: PICKER_GROUP_ICONS[group.id],
    options: DASHBOARD_SHORTCUTS
      .filter((shortcut) => shortcut.group === group.id && (kind === 'chart' ? shortcut.kind === 'chart' : shortcut.kind !== 'chart'))
      .map((shortcut) => ({
        id: shortcut.id,
        title: shortcut.title,
        description: shortcut.detail,
        sourceLabel: shortcutSourceLabel(shortcut.measure),
         previewIcon: <ShortcutIcon id={shortcut.id} />,
         previewKind: shortcut.kind === 'chart' ? shortcut.chart?.style : 'number',
         visualization: shortcutVisualization(shortcut),
         added: shortcutAlreadySelected(shortcut, selectedWidgets),
         recommended: RECOMMENDED_SHORTCUTS.has(shortcut.id),
         ...shortcutPreviewFields(shortcut, previews[shortcut.id]),
       })),
  }));
  if (kind !== 'chart') return groups;
  return [...groups, {
    id: 'unavailable',
    title: t('Requieren más datos'),
    description: t('Opciones disponibles cuando exista una fuente verificable'),
    icon: <LayoutGrid size={20} aria-hidden="true" />,
    options: DASHBOARD_UNAVAILABLE_CHARTS.map((chart) => ({
      id: chart.id,
      title: chart.title,
      description: chart.detail,
      sourceLabel: t('Requiere una fuente verificable'),
      previewIcon: <LayoutGrid size={23} aria-hidden="true" />,
      previewKind: 'heatmap' as const,
      visualization: 'No disponible',
      unavailable: true,
    })),
  }];
}

function PamEmptyDashboard({ saving, onAddData, onAddChart, onUseRecommended }: {
  saving: boolean;
  onAddData: () => void;
  onAddChart: () => void;
  onUseRecommended: () => void;
}) {
  return <section className="dashboard-empty-state" aria-labelledby="pam-empty-title">
    <div className="dashboard-empty-copy">
      <div className="workspace-intro-heading"><h2 id="pam-empty-title">{t('Todavía no elegiste qué seguir')}</h2><HelpHint label={t('Vista recomendada')}><p>{t('Armá tu tablero con indicadores del inventario CyberArk (Safes, cuentas, cobertura) y comparaciones por empresa, tipo o estado operativo. Podés empezar con la vista sugerida y ajustarla después.')}</p><p>La vista sugerida incluye Safes sin cuentas, pendientes de clasificar, usuarios PAM y tres distribuciones. Se guarda sólo si la aceptás; también podés elegir bloque por bloque.</p></HelpHint></div>
      <p>{t('Elegí datos o gráficos para armar tu tablero.')}</p>
    </div>
    <div className="dashboard-empty-actions">
      <button type="button" className="button primary" onClick={onAddData}><Plus size={14} aria-hidden="true" /> {t('Agregar datos')}</button>
      <button type="button" className="button subtle" onClick={onAddChart}><Plus size={14} aria-hidden="true" /> {t('Agregar gráficos')}</button>
      <button type="button" className="button subtle" onClick={onUseRecommended} disabled={saving}><LayoutDashboard size={14} aria-hidden="true" /> {saving ? t('Guardando…') : t('Usar vista recomendada')}</button>
    </div>
  </section>;
}

/** The per-block "clasificador": the same Estado/Clasificación/Alcance/Señal
 * técnica selects the side drawer offers, but inline on the block itself
 * while editing -- mirrors NetskopeEditableItem's per-widget filter
 * CompactSelects. Only rendered for widgets dashboardWidgetAcceptsFilters()
 * allows (a plain Safes/accounts count, or a basic-dimension chart). */
function DashboardWidgetFilterControls({ widget, disabled, onChange }: {
  widget: DashboardWidget;
  disabled: boolean;
  onChange: (key: keyof DashboardWidgetFilters, value: string) => void;
}) {
  return <>
    <CompactSelect className="dashboard-widget-filter" ariaLabel={t('Estado de {title}', { title: widget.title })} value={widget.filters.workflow_status} disabled={disabled} onChange={(value) => onChange('workflow_status', value)} options={FILTER_OPTIONS.workflow_status} />
    <CompactSelect className="dashboard-widget-filter" ariaLabel={t('Clasificación de {title}', { title: widget.title })} value={widget.filters.classification_status} disabled={disabled} onChange={(value) => onChange('classification_status', value)} options={FILTER_OPTIONS.classification_status} />
    <CompactSelect className="dashboard-widget-filter" ariaLabel={t('Alcance de {title}', { title: widget.title })} value={widget.filters.inventory_scope} disabled={disabled} onChange={(value) => onChange('inventory_scope', value)} options={FILTER_OPTIONS.inventory_scope} />
    <CompactSelect className="dashboard-widget-filter" ariaLabel={t('Señal técnica de {title}', { title: widget.title })} value={widget.filters.health_filter} disabled={disabled} onChange={(value) => onChange('health_filter', value)} options={FILTER_OPTIONS.health_filter} />
  </>;
}

type GeneralWorkspaceProps = {
  onWidgetNavigate: (widget: DashboardWidget, bucket?: AnalyticsBucket) => void;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  includeInternal: boolean;
  permissions: string[];
};

export function GeneralWorkspace({ onWidgetNavigate, onUnauthorized, onError, onNotice, includeInternal, permissions }: GeneralWorkspaceProps) {
  const preferences = useDashboardPreferences({ onUnauthorized, onError, onNotice, includeInternal });
  const teamTemplates = useDashboardTeamTemplates<DashboardWidget>({ source: 'cyberark', enabled: true, onUnauthorized, onError, onNotice });
  const [configWidgetId, setConfigWidgetId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DashboardWidget[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [pendingCancel, setPendingCancel] = useState(false);
  const [pendingView, setPendingView] = useState<PendingView | null>(null);
  const [pickerRequest, setPickerRequest] = useState<{ kind: 'data' | 'chart'; token: number } | null>(null);
  const dashboardRef = useRef<HTMLElement>(null);
  const widgets = editing ? draft : preferences.widgets;
  const dataWidgets = widgets.filter((widget) => widget.kind === 'count');
  const visualWidgets = widgets.filter((widget) => widget.kind !== 'count');
  const dataPreviews = useDashboardShortcutPreviews(editing ? 'data' : null, includeInternal);
  const chartPreviews = useDashboardShortcutPreviews(editing ? 'chart' : null, includeInternal);
  const dataShortcutGroups = shortcutPickerGroups('data', dataWidgets, dataPreviews.previews);
  const chartShortcutGroups = shortcutPickerGroups('chart', visualWidgets, chartPreviews.previews);
  const usesCompactVisualGrid = visualWidgets.length === 6 && visualWidgets.every((widget) => widget.size === 'sm');
  const layout = usesCompactVisualGrid
    ? visualWidgets.map((widget, position) => ({ widget, position, size: 'sm' as const }))
    : resolveDashboardRenderLayout(visualWidgets);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(preferences.widgets);
  useUnsavedChangesWarning(dirty);

  const startEditing = () => {
    setDraft(preferences.widgets.map((widget) => ({ ...widget, filters: { ...widget.filters } })));
    setEditing(true);
    setConfigWidgetId(null);
    setAnnouncement(t('Edición del tablero activada'));
  };
  const requestPicker = (kind: 'data' | 'chart') => {
    if (!editing) startEditing();
    setPickerRequest({ kind, token: Date.now() });
  };
  const cancelEditing = () => { setDraft([]); setEditing(false); setPickerRequest(null); setConfigWidgetId(null); setAnnouncement('Cambios descartados'); };
  const requestCancel = () => { if (dirty) setPendingCancel(true); else cancelEditing(); };
  const saveEditing = async () => {
    const invalidTitle = draft.some((widget) => !widget.title.trim());
    const invalidGoal = draft.some((widget) => widget.kind === 'goal' && (widget.target_value === null || !Number.isFinite(widget.target_value)));
    if (invalidTitle || invalidGoal) {
      setAnnouncement(invalidGoal ? t('Completá la meta de los objetivos antes de guardar.') : t('Poné un nombre a cada métrica antes de guardar.'));
      return;
    }
    const normalized = draft.map((widget) => widget.kind === 'count' ? { ...widget, size: 'sm' as const, position: null } : widget);
    if (await preferences.save(normalized)) { setEditing(false); setDraft([]); setConfigWidgetId(null); setAnnouncement('Vista guardada'); }
  };
  // VIEW-003: choosing a preset or the factory default only stages it; the
  // saved view changes when the operator confirms the dialog.
  const applyPreset = (preset: DashboardPreset) => setPendingView({
    title: `Aplicar vista "${preset.label}"`,
    description: t('{description} Reemplaza tu vista guardada de CyberArk ({shortcutIds} bloques). Hasta que confirmes, tu vista actual no cambia.', { description: preset.description, shortcutIds: preset.shortcutIds.length }),
    confirmLabel: 'Aplicar vista',
    notice: `Vista "${preset.label}" aplicada`,
    icon: <LayoutTemplate size={18} aria-hidden="true" />,
    widgets: preset.shortcutIds.map((id, index) => createDashboardShortcut(id, index)),
  });
  const applyTeamTemplate = (template: (typeof teamTemplates.templates)[number]) => setPendingView({
    title: t('Restaurar vista de {role_name}', { role_name: template.role_name }),
    description: t('Aplica la versión {version} como una copia personalizable ({widgets} bloques). No modifica la plantilla del equipo.', { version: template.version, widgets: template.widgets.length }),
    confirmLabel: 'Usar esta vista', notice: t('Vista de {role_name} aplicada', { role_name: template.role_name }),
    icon: <LayoutTemplate size={18} aria-hidden="true" />,
    widgets: template.widgets.map((widget) => ({ ...widget, filters: { ...widget.filters } })),
  });
  const resetView = () => setPendingView({
    title: t('Restablecer a predeterminada'),
    description: t('Vuelve a los {DEFAULT_PAM_SHORTCUT_IDS} bloques por defecto de CyberArk y reemplaza tu vista guardada.', { DEFAULT_PAM_SHORTCUT_IDS: DEFAULT_PAM_SHORTCUT_IDS.length }),
    confirmLabel: 'Restablecer',
    notice: 'Vista predeterminada restablecida',
    icon: <RotateCcw size={18} aria-hidden="true" />,
    widgets: DEFAULT_PAM_SHORTCUT_IDS.map((id, index) => createDashboardShortcut(id, index)),
  });
  const clearView = () => setPendingView({
    title: t('Vaciar vista'),
    description: t('Quita todos los bloques de tu vista de CyberArk y la deja vacía para armarla desde cero. Hasta que confirmes, tu vista actual no cambia.'),
    confirmLabel: 'Vaciar',
    notice: 'Vista vaciada',
    icon: <Trash2 size={18} aria-hidden="true" />,
    widgets: [],
  });
  const confirmPendingView = async () => {
    if (!pendingView) return;
    const { notice, widgets } = pendingView;
    const applied = await preferences.save(widgets);
    if (applied) setAnnouncement(notice);
    setPendingView(null);
  };
  const updateWidget = (next: DashboardWidget) => setDraft((current) => current.map((widget) => widget.widget_id === next.widget_id ? next : widget));
  const createCustom = (kind: 'data' | 'chart') => {
    const base = createDashboardWidget(draft.length);
    const widget: DashboardWidget = kind === 'chart'
      ? { ...base, kind: 'chart', chart: { style: 'pie', group_by: DASHBOARD_DIMENSIONS[0] } }
      : base;
    setDraft((current) => [...current, widget]);
    setConfigWidgetId(widget.widget_id);
    setAnnouncement(t('Métrica nueva agregada. Configurala y guardá la vista.'));
  };
  const duplicateWidget = (id: string) => setDraft((current) => {
    const source = current.find((widget) => widget.widget_id === id);
    if (!source) return current;
    const copy: DashboardWidget = { ...source, widget_id: `custom-${Date.now()}-${current.length}`, title: `${source.title} · copia`, position: null, filters: { ...source.filters }, chart: source.chart ? { ...source.chart } : null };
    return [...current, copy];
  });

  const moveDataWidget = (id: string, direction: -1 | 1) => setDraft((current) => moveDashboardWidget(current, id, direction, (widget) => widget.kind === 'count'));
  const moveVisualWidget = (id: string, direction: -1 | 1) => setDraft((current) => {
    const visuals = current.filter((widget) => widget.kind !== 'count');
    const index = visuals.findIndex((widget) => widget.widget_id === id);
    const target = visuals[index + direction];
    return target ? swapDashboardWidgets(current, id, target.widget_id) : current;
  });
  const dropVisualWidget = (draggedId: string, targetId: string) => setDraft((current) => swapDashboardWidgets(current, draggedId, targetId));
  const dropDataWidget = (draggedId: string, targetId: string) => setDraft((current) => {
    const dragged = current.find((widget) => widget.widget_id === draggedId);
    const target = current.find((widget) => widget.widget_id === targetId);
    if (!dragged || !target || dragged.kind !== 'count' || target.kind !== 'count') return current;
    const from = current.findIndex((widget) => widget.widget_id === draggedId);
    const to = current.findIndex((widget) => widget.widget_id === targetId);
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });
  const resizeWidget = (id: string, size: DashboardWidgetSize) => setDraft((current) => current.map((widget) => {
    if (widget.widget_id !== id) return widget;
    const zones = widget.position !== null && dashboardZoneFits(widget.position, size) ? dashboardZonesCovered(widget.position, size) : null;
    return { ...widget, size, position: zones ? widget.position : null };
  }));
  const removeWidget = (id: string) => {
    setDraft((current) => current.filter((widget) => widget.widget_id !== id));
    setConfigWidgetId((current) => current === id ? null : current);
    setAnnouncement(t('Widget quitado de la vista. El cambio queda pendiente de guardar.'));
    focusFirstEditItem();
  };
  const focusFirstEditItem = () => {
    requestAnimationFrame(() => {
      dashboardRef.current?.querySelector<HTMLElement>('.dashboard-edit-item')?.focus();
    });
  };
  const addShortcut = (id: string) => setDraft((current) => {
    const widget = createDashboardShortcut(id as DashboardShortcutId, current.length);
    // The picker already fetched this shortcut's real value/buckets to show
    // its preview card; seed the new block with it so it reads correctly
    // right away instead of showing the zeroed-out default until saved.
    const preview = (widget.kind === 'chart' ? chartPreviews : dataPreviews).previews[id as DashboardShortcutId];
    return [...current, preview ? { ...widget, ...preview } : widget];
  });
  const [recalculating, setRecalculating] = useState<Set<string>>(new Set());
  const updateWidgetFilter = async (id: string, key: keyof DashboardWidgetFilters, value: string) => {
    const current = draft.find((widget) => widget.widget_id === id);
    if (!current) return;
    const updated: DashboardWidget = { ...current, filters: { ...current.filters, [key]: value }, baseline_value: null };
    setDraft((currentDraft) => currentDraft.map((widget) => widget.widget_id === id ? updated : widget));
    setRecalculating((current) => new Set(current).add(id));
    try {
      const response = await previewDashboardWidget(updated, undefined, includeInternal);
      const result = response.widgets[0];
      if (result) setDraft((currentDraft) => currentDraft.map((widget) => widget.widget_id === id ? { ...widget, ...result, filters: updated.filters } : widget));
    } catch {
      // The applied filter stays on the draft either way; it resolves to
      // the right value once saved and reloaded even if this live
      // recalculation failed.
    } finally {
      setRecalculating((current) => { const next = new Set(current); next.delete(id); return next; });
    }
  };
  const settingsFor = (widget: DashboardWidget, index: number) => <>
    <WidgetBasicsCard widget={widget} index={index} onChange={updateWidget} />
    <WidgetDisplayCard widget={widget} index={index} onChange={updateWidget} />
    {dashboardWidgetAcceptsFilters(widget) ? <section><h4>{t('Filtros')}</h4><div className="dashboard-widget-filter-panel"><DashboardWidgetFilterControls widget={widget} disabled={preferences.saving || recalculating.has(widget.widget_id)} onChange={(key, value) => void updateWidgetFilter(widget.widget_id, key, value)} /></div></section> : null}
    <DashboardWidgetPreview widget={widget} includeInternal={includeInternal} />
  </>;
  const chartModeFor = (widget: DashboardWidget) => widget.kind === 'chart' && (widget.chart?.style === 'pie' || widget.chart?.style === 'bars') ? (widget.chart.style === 'pie' ? 'donut' as const : 'bars' as const) : undefined;
  const setChartMode = (widget: DashboardWidget, mode: 'donut' | 'bars') => widget.chart && updateWidget({ ...widget, chart: { ...widget.chart, style: mode === 'donut' ? 'pie' : 'bars' } });

  const renderVisualCard = (widget: DashboardWidget, style?: React.CSSProperties) => widget.kind === 'chart'
    ? <article className="metric-button personal-metric-button personal-chart-card" data-status={widget.data_status ?? 'available'} style={style}>
        <div className="personal-chart-heading"><span className="metric-label">{widget.title}</span><small>{dashboardWidgetDetail(widget)}</small></div>
        {widget.chart?.style === 'bars'
          ? <BarList buckets={widget.buckets ?? []} emptyHint="Sin datos para este corte." onBucketSelect={(bucket) => onWidgetNavigate(widget, bucket)} />
          : widget.chart?.style === 'pie'
            ? <PieChart buckets={widget.buckets ?? []} onBucketSelect={(bucket) => onWidgetNavigate(widget, bucket)} />
            : widget.chart ? <AdvancedChart title={widget.title} style={widget.chart.style} data={widget.chart_data} onSelect={(filterValue) => onWidgetNavigate(widget, { key: filterValue, filter_value: filterValue, count: 0 })} /> : null}
      </article>
    : <button type="button" className="metric-button personal-metric-button" data-status={widget.data_status ?? 'available'} style={style} onClick={() => onWidgetNavigate(widget)} aria-label={t('{title}: {dashboardValueLabel}. Abrir resultados', { title: widget.title, dashboardValueLabel: dashboardValueLabel(widget) })}><div className="metric dashboard-goal"><span className="metric-label">{widget.title}</span><strong>{dashboardValueLabel(widget)}<small> / {widget.target_value}</small></strong><span className="dashboard-goal-meta">{widget.period_label || t('Sin período')} · {dashboardGoalProgress(widget)}%</span><span className="dashboard-goal-track" aria-hidden="true"><span style={{ width: `${dashboardGoalProgress(widget)}%` }} /></span><small>{dashboardWidgetDetail(widget)}</small></div><ArrowRight size={15} /></button>;

  return <>
    <section ref={dashboardRef} className={`personal-dashboard pam-personal-dashboard${editing ? ' is-editing' : ''}`} aria-label={t('Mi panel de métricas')}>
      <div className="personal-dashboard-heading">
        {editing ? null : <div className="personal-dashboard-heading-actions">
          {preferences.canUndo ? <button type="button" className="button subtle" disabled={preferences.saving} title={t('Deshacer el último guardado')} onClick={() => void preferences.undo()}><Undo2 size={14} aria-hidden="true" /> {t('Deshacer')}</button> : null}
          <DashboardPresetMenu presets={DASHBOARD_PRESETS} teamTemplates={teamTemplates.templates} disabled={preferences.saving} onSelect={applyPreset} onTeamSelect={applyTeamTemplate} onReset={resetView} onClear={clearView} />
          {permissions.includes('access:roles_manage') ? <DashboardTemplatePublisher disabled={preferences.saving || teamTemplates.publishing} blockCount={preferences.widgets.length} onPublish={(roleCode) => teamTemplates.publish(roleCode, preferences.widgets)} /> : null}
          <button type="button" className="button subtle" title={t('Editar el diseño de tu vista')} onClick={startEditing}><SlidersHorizontal size={14} /> {t('Editar vista')}</button>
        </div>}
      </div>
      {editing ? <DashboardEditToolbar label={t('Edición del tablero PAM')} hint="Arrastrá o usá las flechas para ordenar" dirty={dirty} saving={preferences.saving} onCancel={requestCancel} onSave={() => void saveEditing()} /> : null}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {preferences.loading ? <StateBlock variant="loading" title={t('Cargando tu panel...')} />
        : !widgets.length && !editing
        ? <PamEmptyDashboard saving={preferences.saving} onAddData={() => requestPicker('data')} onAddChart={() => requestPicker('chart')} onUseRecommended={() => void preferences.save(RECOMMENDED_PAM_SHORTCUT_IDS.map((id, index) => createDashboardShortcut(id, index)))} />
        : <div className="personal-dashboard-content">
          {dataWidgets.length || editing ? <section className="dashboard-data-section" aria-labelledby="dashboard-data-title">
            <div className="dashboard-section-heading"><h2 id="dashboard-data-title">{t('Datos clave')}</h2></div>
            <div className={`dashboard-data-strip${editing ? ' editing' : ''}`} role={editing ? 'list' : undefined}>{dataWidgets.map((widget, index) => editing
              ? <DashboardEditItem key={widget.widget_id} id={widget.widget_id} title={widget.title} index={index} count={dataWidgets.length} saving={preferences.saving} showSize={false} onMove={moveDataWidget} onMoveBefore={dropDataWidget} onSize={resizeWidget} onRemove={removeWidget} onAnnounce={setAnnouncement} mode={chartModeFor(widget)} onMode={(mode) => setChartMode(widget, mode)} onDuplicate={duplicateWidget} settings={settingsFor(widget, index)} openSettingsOnMount={configWidgetId === widget.widget_id} onSettingsChange={(open) => setConfigWidgetId(open ? widget.widget_id : null)}><DashboardDataItem widget={widget} onNavigate={onWidgetNavigate} /></DashboardEditItem>
              : <DashboardDataItem key={widget.widget_id} widget={widget} onNavigate={onWidgetNavigate} />)}</div>
            {editing ? <DashboardWidgetPicker kind="data" eyebrow="DATOS CLAVE" heading="Elegí un dato para tu tablero" helper="Indicadores rápidos para saber qué está pasando ahora." groups={dataShortcutGroups} disabled={dataWidgets.length >= 6} limitReached={dataWidgets.length >= 6} openRequest={pickerRequest?.kind === 'data' ? pickerRequest.token : undefined} onCreateCustom={() => createCustom('data')} onAdd={addShortcut} /> : null}
          </section> : null}
          {visualWidgets.length || editing ? <section className="dashboard-visual-section" aria-labelledby="dashboard-visual-title">
            <div className="dashboard-section-heading"><h2 id="dashboard-visual-title">{t('Gráficos')}</h2></div>
            <div className={`metrics personal-dashboard-metrics ${usesCompactVisualGrid ? 'compact-visual-grid' : ''}${editing ? ' editing' : ''}`.trim()} role={editing ? 'list' : undefined}>{layout.map(({ widget, position, size }, index) => {
              const style = dashboardGridPlacement(position, size);
              return editing
                ? <DashboardEditItem key={widget.widget_id} id={widget.widget_id} title={widget.title} index={index} count={visualWidgets.length} size={size} style={style} saving={preferences.saving} onMove={moveVisualWidget} onMoveBefore={dropVisualWidget} onSize={resizeWidget} onRemove={removeWidget} onAnnounce={setAnnouncement} mode={chartModeFor(widget)} onMode={(mode) => setChartMode(widget, mode)} onDuplicate={duplicateWidget} settings={settingsFor(widget, index)} openSettingsOnMount={configWidgetId === widget.widget_id} onSettingsChange={(open) => setConfigWidgetId(open ? widget.widget_id : null)}>{renderVisualCard(widget)}</DashboardEditItem>
                : <span className="dashboard-visual-slot" key={widget.widget_id} style={style}>{renderVisualCard(widget)}</span>;
            })}</div>
            {editing ? <DashboardWidgetPicker kind="chart" eyebrow="INVENTARIO Y POSTURA" heading="Elegí un gráfico para tu tablero" helper="Comparaciones visuales para encontrar patrones y desvíos." groups={chartShortcutGroups} disabled={visualWidgets.length >= 6} limitReached={visualWidgets.length >= 6} openRequest={pickerRequest?.kind === 'chart' ? pickerRequest.token : undefined} onCreateCustom={() => createCustom('chart')} onAdd={addShortcut} /> : null}
          </section> : null}
          {editing ? null : <button type="button" className="dashboard-create-card" title={t('Editar la vista para agregar un dato o gráfico')} onClick={startEditing}><span className="dashboard-create-icon"><Plus size={18} /></span><span><strong>{t('Agregar a la vista')}</strong><small>{t('Dato compacto, gráfico u objetivo')}</small></span></button>}
        </div>}
    </section>
    {pendingCancel ? <ConfirmDialog
      icon={<Undo2 size={18} />}
      titleId="discard-dashboard-title"
      title={t('Descartar cambios')}
      descriptionId="discard-dashboard-copy"
      description={t('Vas a perder los cambios sin guardar de tu vista.')}
      onClose={() => setPendingCancel(false)}
      closeDisabled={preferences.saving}
      confirmLabel="Descartar cambios"
      confirmBusyLabel="Descartando..."
      confirmBusy={preferences.saving}
      onConfirm={() => { setPendingCancel(false); cancelEditing(); }}
      backdropClassName="dashboard-confirm-backdrop"
    /> : null}
    {pendingView ? <ConfirmDialog
      icon={pendingView.icon}
      titleId="pam-preset-title"
      title={pendingView.title}
      descriptionId="pam-preset-copy"
      description={pendingView.description}
      onClose={() => setPendingView(null)}
      closeDisabled={preferences.saving}
      confirmLabel={pendingView.confirmLabel}
      confirmBusyLabel="Aplicando..."
      confirmBusy={preferences.saving}
      confirmTone="primary"
      onConfirm={() => void confirmPendingView()}
      backdropClassName="dashboard-confirm-backdrop"
    /> : null}
  </>;
}
