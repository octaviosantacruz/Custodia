import { DateTime } from '../../../cross/components/date-time';
import { useToolSyncPresentation } from '../../../cross/hooks/use-tool-sync-presentation';
import { NETSKOPE_SYNC_PRESENTATION } from '../lib/netskope-sync-evidence';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, CircleGauge, LayoutDashboard, LayoutTemplate, MonitorSmartphone, Plus, RotateCcw, Trash2, Search, ShieldAlert, SlidersHorizontal, Undo2, UserRound, UsersRound, X } from 'lucide-react';
import { StateBlock } from '../../../cross/components/state-block';
import { ErrorDetailsButton } from '../../../cross/components/error-details';
import { type ErrorDetails } from '../../../cross/lib/error-details';
import { LoadMore } from '../../../cross/components/load-more';
import { ConfirmDialog } from '../../../cross/components/confirm-dialog';
import { DashboardPresetMenu } from '../../../cross/components/dashboard-presets';
import { DashboardTemplatePublisher } from '../../../cross/components/dashboard-template-publisher';
import { DashboardEditToolbar } from '../../../cross/components/dashboard-edit-item';
import { NetskopeAddWidget, NetskopeEditableItem } from './netskope-dashboard-editor';
import { formatDate, formatNumber, dateTimeHint, relativeTime } from '../../../cross/lib/format';
import { useNetskopeInventory, type NetskopeView } from '../hooks/use-netskope-inventory';
import { useNetskopeDashboardPreferences } from '../hooks/use-netskope-dashboard-preferences';
import { useNetskopeFilteredMetrics } from '../hooks/use-netskope-filtered-metrics';
import { useUnsavedChangesWarning } from '../../../cross/hooks/use-unsaved-changes-warning';
import { useDashboardTeamTemplates } from '../../../cross/hooks/use-dashboard-team-templates';
import { NETSKOPE_PAGE_SIZE, fetchNetskopeAaCharts, fetchNetskopeAlertAggregates, fetchNetskopeDeviceFacets } from '../lib/netskope-api';
import { EMPTY_NETSKOPE_USERS_FILTERS, isNetskopeDeviceQueryActive, isNetskopeUsersFiltersActive } from '../lib/netskope-device-filters';
import type { NetskopeAccountStatus, NetskopeChartWidgetId, NetskopeDataWidgetId, NetskopeDeviceFacets, NetskopeDeviceFilterKey, NetskopeDeviceQuery, NetskopeMetricBucket, NetskopeSelectedMetrics as NetskopeMetrics, NetskopeRow, NetskopeUsersFilters, NetskopeWidgetFilters, NetskopeWidgetInstance, NetskopeWidgetSize } from '../types/netskope';
import { StatusBadge } from '../../../cross/components/semantic';
import { HelpHint } from '../../../cross/components/help-hint';
import { CompactSelect } from '../../../cross/components/compact-select';
import { DEFAULT_NETSKOPE_WIDGETS, NETSKOPE_CHART_WIDGETS, NETSKOPE_DATA_WIDGETS, NETSKOPE_DASHBOARD_PRESETS, RECOMMENDED_NETSKOPE_WIDGETS, netskopeChartMode, moveNetskopeWidget, moveNetskopeWidgetBefore, netskopeAlertAvailabilityLabel, netskopeAlertTotalLabel, netskopeCardShare, netskopeChartBucketDrill, netskopeUsersReference, netskopeUsersSplit, netskopeDataWidgetDrill, netskopeUserActivityDrill, netskopeWidgetDefinition, registerNetskopeAaCharts, type NetskopeDashboardDrill, type NetskopeDashboardPreset } from '../lib/netskope-dashboard';
import { companyFromIdentity } from '../lib/netskope-company';
import { deviceMakeModelLabel } from '../lib/netskope-device-labels';
import { useNetskopeAaPreviews } from '../hooks/use-netskope-aa-previews';
import { NetskopeDetailDrawer } from './netskope-detail-drawer';
import { DEVICE_EVIDENCE_LABELS } from '../lib/netskope-device-labels';
import { NetskopeDeviceDetail } from './netskope-device-detail';
import { NetskopeUserDrawer, type NetskopeUserSelection } from './netskope-user-drawer';
import { NetskopeDeviceFilters } from './netskope-device-filters';
import { hasNetskopeMetricReading, NetskopeChartHelp, NetskopeDataHelp } from './netskope-metric-reading';
import { CategoryChart } from '../../../cross/components/category-chart';
import type { ChartMode } from '../../../cross/lib/chart-mode';
import { dashboardGridPlacement, resolveDashboardRenderLayout } from '../../../cross/lib/dashboard-layout';
import { useNetskopePanel } from '../hooks/use-netskope-panel';
import { NetskopeRetiredActivity } from './netskope-retired-activity';
import { NetskopeOperationsView } from './netskope-operations-view';
import { NetskopeAaChart } from './netskope-aa-chart';
import { NetskopeAaSeverity } from './netskope-aa-severity';
import './netskope-workspace.css';
import { navigateInApp } from '../../../cross/components/section-nav';
import { t } from '../../../cross/i18n/index.ts';

type Props = { view: NetskopeView; refreshKey?: number; permissions: string[]; authChecked: boolean; authenticated: boolean; onUnauthorized: () => void; onError: (message: string) => void; onNotice: (message: string) => void; onNavigate: (view: NetskopeView) => void; onOpenPosture?: (checks: string[]) => void };
type UserActivityWindow = 7 | 14 | 30;
const NETSKOPE_ALERT_DATA_IDS = new Set<NetskopeDataWidgetId>(['alerts_7d', 'alerts_30d', 'alerts_90d']);
const NETSKOPE_ALERT_CHART_IDS = new Set<NetskopeChartWidgetId>(['alerts_by_severity']);
const NETSKOPE_RANKING_LIMITS: Partial<Record<NetskopeChartWidgetId, number>> = {
  devices_by_os: 8,
  devices_by_client: 8,
  devices_by_make: 8,
  devices_by_classification: 8,
  devices_by_user_status: 8,
  devices_by_company: 40,
  users_by_company: 40,
};

/** A preset or reset waiting for the operator's explicit confirmation before
 * it replaces the saved view (VIEW-003). */
type PendingView = {
  title: string;
  description: string;
  confirmLabel: string;
  notice: string;
  icon: React.ReactNode;
  widgets: NetskopeWidgetInstance[];
};

function value(row: Record<string, string | number | boolean | null>, key: string): string {
  const current = row[key];
  return current === null || current === undefined || current === '' ? '—' : String(current);
}

function percent(value: number, total: number): string {
  return total ? `${Math.round((value / total) * 100)}%` : 'No calculable';
}

function netskopeDataCardMeta(id: NetskopeDataWidgetId | NetskopeChartWidgetId, description?: string) {
  const help = description ? `${description} · Fuente: Netskope` : 'Fuente: Netskope';
  if (id.startsWith('alerts')) return { icon: <ShieldAlert size={14} aria-hidden="true" />, tone: 'warning', help };
  if (id === 'devices_stale_30d') return { icon: <MonitorSmartphone size={14} aria-hidden="true" />, tone: 'warning', help };
  if (id === 'devices_with_observed_user' || id === 'devices_observed_user_matched') return { icon: <UserRound size={14} aria-hidden="true" />, tone: id === 'devices_observed_user_matched' ? 'success' : 'neutral', help };
  if (id === 'devices_observed_user_unmatched' || id === 'users_without_observed_devices') return { icon: <UserRound size={14} aria-hidden="true" />, tone: 'warning', help };
  if (id === 'users_total' || id === 'users_recent_activity') return { icon: <UsersRound size={14} aria-hidden="true" />, tone: id === 'users_recent_activity' ? 'success' : 'neutral', help };
  if (id === 'fleet_signal_24h' || id === 'fleet_client_current' || id === 'fleet_os_supported' || id === 'fleet_on_prem') return { icon: <MonitorSmartphone size={14} aria-hidden="true" />, tone: 'success', help };
  if (id === 'devices_duplicate_hostnames') return { icon: <MonitorSmartphone size={14} aria-hidden="true" />, tone: 'warning', help };
  if (id === 'devices_total') return { icon: <MonitorSmartphone size={14} aria-hidden="true" />, tone: 'neutral', help };
  return { icon: <CircleGauge size={14} aria-hidden="true" />, tone: 'neutral', help };
}

/* NSK-XMET-001: the cross KPIs must state denominator, applied filters and
   freshness on the card, and their charts drill with the raw bucket value. */
const OBSERVED_USER_STATUS_LABELS: Record<string, string> = { matched: 'Con usuario resuelto', ambiguous: 'Ambiguo', unmatched: 'Sin resolver' };
const ACCOUNT_STATUS_LABELS: Record<string, string> = { enabled: 'Habilitado', disabled: 'Deshabilitado', unknown: 'Sin dato de cuentas' };
const DEVICE_COUNT_LABELS: Record<string, string> = { '0': t('Sin dispositivos'), '1': t('1 dispositivo'), '2plus': t('2 o más') };
const DEVICE_AGE_LABELS: Record<string, string> = { lt_24h: 'Menos de 24 h', d1_7: '1 a 7 días', d7_30: '7 a 30 días', gt_30d: 'Más de 30 días', unknown: 'Sin dato' };
/** One-line reading of the fleet-health cards (their share line carries the denominator). */
const FLEET_CARD_DETAIL: Record<string, string> = {
  fleet_signal_24h: 'Reportaron en las últimas 24 horas',
  fleet_client_current: 'Versión del cliente al día',
  fleet_os_supported: 'SO en el mínimo exigido',
  fleet_on_prem: 'Detectados en la oficina por Netskope',
  devices_duplicate_hostnames: 'Comparten hostname con otro equipo',
};
const WIDGET_FILTER_LABELS: Record<string, string> = { os: 'SO', company: 'Empresa', classification_status: 'Clasificación' };

function widgetFilterSuffix(filters?: NetskopeWidgetFilters): string {
  const entries = Object.entries(filters ?? {}).filter(([, value]) => value);
  if (!entries.length) return '';
  return ` · filtros: ${entries.map(([key, value]) => `${WIDGET_FILTER_LABELS[key] ?? key}=${value}`).join(', ')}`;
}

function heartbeatSuffix(metrics: NetskopeMetrics): string {
  const heartbeat = metrics.devices_last_event_dem;
  return typeof heartbeat === 'number' && typeof metrics.devices_total === 'number'
    ? ` · ${formatNumber(heartbeat)} con un latido de DEM como último evento y ${formatNumber(metrics.devices_total - heartbeat)} con eventos de túnel o sistema`
    : '';
}

function freshnessSuffix(metrics: NetskopeMetrics, includeDate = true): string {
  return includeDate && metrics.last_observed_at ? ` · al ${formatDate(metrics.last_observed_at)}` : '';
}

function metricCount(value: number | undefined): string {
  return typeof value === 'number' ? formatNumber(value) : 'no informado';
}

function bucketCount(buckets: NetskopeMetricBucket[] | undefined, key: string): number {
  return buckets?.find((bucket) => (bucket.filter_value ?? bucket.key) === key)?.count ?? 0;
}

function NetskopeEmptyDashboard({ saving, onAddData, onAddChart, onUseRecommended }: {
  saving: boolean;
  onAddData: () => void;
  onAddChart: () => void;
  onUseRecommended: () => void;
}) {
  return <section className="dashboard-empty-state" aria-labelledby="netskope-empty-title">
    <div className="dashboard-empty-copy">
      <div className="workspace-intro-heading"><h2 id="netskope-empty-title">{t('Todavía no elegiste qué seguir')}</h2><HelpHint label={t('Vista recomendada')}><p>Armá tu tablero con indicadores del inventario (dispositivos, equipos sin señal, alertas DLP agregadas) y comparaciones por sistema operativo, empresa o estado de usuario. Podés empezar con la vista sugerida y ajustarla después.</p><p>La vista sugerida incluye dispositivos totales, equipos sin señal hace más de 30 días, alertas DLP agregadas de 7 días y dos distribuciones. Se guarda sólo si la aceptás; también podés elegir bloque por bloque.</p></HelpHint></div>
      <p>{t('Elegí datos o gráficos para armar tu tablero.')}</p>
    </div>
    <div className="dashboard-empty-actions">
      <button type="button" className="button primary" onClick={onAddData}><Plus size={14} aria-hidden="true" /> {t('Agregar datos')}</button>
      <button type="button" className="button subtle" onClick={onAddChart}><Plus size={14} aria-hidden="true" /> {t('Agregar gráficos')}</button>
      <button type="button" className="button subtle" onClick={onUseRecommended} disabled={saving}><LayoutDashboard size={14} aria-hidden="true" /> {saving ? t('Guardando…') : t('Usar vista recomendada')}</button>
    </div>
  </section>;
}

function NetskopeMetricsView({ onDrill, permissions, authChecked, authenticated, onUnauthorized, onError, onNotice, refreshKey }: {
  onDrill: (drill: NetskopeDashboardDrill) => void;
  permissions: string[];
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  refreshKey?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NetskopeWidgetInstance[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [pendingCancel, setPendingCancel] = useState(false);
  const [pendingView, setPendingView] = useState<PendingView | null>(null);
  const [pickerRequest, setPickerRequest] = useState<{ kind: 'data' | 'chart'; token: number } | null>(null);
  const [dataPreviewIds, setDataPreviewIds] = useState<string[]>([]);
  const [chartPreviewIds, setChartPreviewIds] = useState<string[]>([]);
  const [userActivityWindow, setUserActivityWindow] = useState<UserActivityWindow>(7);
  const dashboardRef = useRef<HTMLElement>(null);
  const preferences = useNetskopeDashboardPreferences({ authChecked, authenticated, onUnauthorized, onError, onNotice });
  const teamTemplates = useDashboardTeamTemplates<NetskopeWidgetInstance>({ source: 'netskope', enabled: authChecked && authenticated, onUnauthorized, onError, onNotice });
  const widgets = editing ? draft : preferences.widgets;
  const previewIds = editing ? [...dataPreviewIds, ...chartPreviewIds] : [];
  const needsLegacyAlerts = [...widgets.map((widget) => widget.id), ...previewIds].some((id) => id.startsWith('alerts_') && id !== 'alerts_by_severity');
  const alerts = useNetskopePanel({ cacheKey: ['alert-aggregates'], enabled: authChecked && authenticated && !preferences.loading && needsLegacyAlerts, refreshKey, onUnauthorized, load: fetchNetskopeAlertAggregates });
  // The tenant's AA chart map names the extra blocks the picker offers; saved blocks resolve against it.
  const aaCharts = useNetskopePanel({ cacheKey: ['aa', 'charts'], enabled: authChecked && authenticated && !preferences.loading, refreshKey, onUnauthorized, load: fetchNetskopeAaCharts });
  const aaDefinitions = registerNetskopeAaCharts(Array.isArray(aaCharts.data) ? aaCharts.data : []);
  // Only the AA tiles the picker is showing are queried, and only while editing.
  const aaPreviews = useNetskopeAaPreviews(chartPreviewIds, authChecked && authenticated && editing, refreshKey);
  // Facets only power the widget filter controls. Loading their eight grouped
  // queries while the board is read-only competes with the filtered metrics
  // that are needed to paint the saved view.
  const facets = useNetskopePanel({ cacheKey: ['device-facets'], enabled: authChecked && authenticated && editing, refreshKey, onUnauthorized, load: fetchNetskopeDeviceFacets });
  const filtered = useNetskopeFilteredMetrics({
    widgets: [...widgets, ...previewIds.flatMap((id) => {
      const definition = netskopeWidgetDefinition(id as NetskopeWidgetInstance['id']);
      return definition ? [{ id: definition.id, size: definition.defaultSize, filters: {} }] : [];
    })],
    enabled: authChecked && authenticated && !preferences.loading,
    refreshKey,
    onUnauthorized,
  });
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(preferences.widgets);
  useUnsavedChangesWarning(dirty);
  const metrics = filtered.metricsFor();
  if (preferences.loading) return <section className="list-panel netskope-metrics-state"><StateBlock variant="loading" title={t('Cargando métricas Netskope…')} /></section>;

  const dataInstances = widgets.filter((widget) => netskopeWidgetDefinition(widget.id)?.kind === 'data');
  const chartInstances = widgets.filter((widget) => netskopeWidgetDefinition(widget.id)?.kind === 'chart');
  const alertDataInstances = dataInstances.filter((widget) => NETSKOPE_ALERT_DATA_IDS.has(widget.id as NetskopeDataWidgetId));
  const alertChartInstances = chartInstances.filter((widget) => NETSKOPE_ALERT_CHART_IDS.has(widget.id as NetskopeChartWidgetId));
  const inventoryDataInstances = dataInstances.filter((widget) => !NETSKOPE_ALERT_DATA_IDS.has(widget.id as NetskopeDataWidgetId));
  const inventoryChartInstances = chartInstances.filter((widget) => !NETSKOPE_ALERT_CHART_IDS.has(widget.id as NetskopeChartWidgetId));
  const startEditing = () => { setDraft(preferences.widgets); setEditing(true); setAnnouncement('Edición del tablero activada'); };
  const requestPicker = (kind: 'data' | 'chart') => { setPickerRequest({ kind, token: Date.now() }); startEditing(); };
  const cancelEditing = () => { setDraft([]); setEditing(false); setAnnouncement('Cambios descartados'); };
  const requestCancel = () => { if (dirty) setPendingCancel(true); else cancelEditing(); };
  const saveEditing = async () => { if (await preferences.save(draft)) { setEditing(false); setDraft([]); setAnnouncement('Vista guardada'); } };
  // VIEW-003: choosing a preset or the factory default only stages it; the
  // saved view changes when the operator confirms the dialog.
  const applyPreset = (preset: NetskopeDashboardPreset) => setPendingView({
    title: `Aplicar vista "${preset.label}"`,
    description: `${preset.description} Reemplaza tu vista guardada de Netskope (${preset.widgets.length} bloques). Hasta que confirmes, tu vista actual no cambia.`,
    confirmLabel: 'Aplicar vista',
    notice: `Vista "${preset.label}" aplicada`,
    icon: <LayoutTemplate size={18} aria-hidden="true" />,
    widgets: preset.widgets.map((widget) => ({ ...widget, filters: { ...(widget.filters ?? {}) } })),
  });
  const applyTeamTemplate = (template: (typeof teamTemplates.templates)[number]) => setPendingView({
    title: `Restaurar vista de ${template.role_name}`,
    description: `Aplica la versión ${template.version} como una copia personalizable (${template.widgets.length} bloques). No modifica la plantilla del equipo.`,
    confirmLabel: 'Usar esta vista', notice: `Vista de ${template.role_name} aplicada`,
    icon: <LayoutTemplate size={18} aria-hidden="true" />,
    widgets: template.widgets.map((widget) => ({ ...widget, filters: { ...(widget.filters ?? {}) } })),
  });
  const resetView = () => setPendingView({
    title: t('Restablecer a predeterminada'),
    description: `Vuelve a los ${DEFAULT_NETSKOPE_WIDGETS.length} bloques por defecto de Netskope y reemplaza tu vista guardada.`,
    confirmLabel: 'Restablecer',
    notice: 'Vista predeterminada restablecida',
    icon: <RotateCcw size={18} aria-hidden="true" />,
    widgets: DEFAULT_NETSKOPE_WIDGETS.map((widget) => ({ ...widget, filters: { ...(widget.filters ?? {}) } })),
  });
  const clearView = () => setPendingView({
    title: t('Vaciar vista'),
    description: t('Quita todos los bloques de tu vista de Netskope y la deja vacía para armarla desde cero. Hasta que confirmes, tu vista actual no cambia.'),
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
  const updateDraft = (updater: (current: NetskopeWidgetInstance[]) => NetskopeWidgetInstance[]) => setDraft(updater);
  const focusFirstEditItem = () => {
    requestAnimationFrame(() => {
      dashboardRef.current?.querySelector<HTMLElement>('.dashboard-edit-item')?.focus();
    });
  };
  const editorHandlers = {
    onMove: (id: NetskopeWidgetInstance['id'], direction: -1 | 1) => updateDraft((current) => moveNetskopeWidget(current, id, direction)),
    onMoveBefore: (draggedId: NetskopeWidgetInstance['id'], targetId: NetskopeWidgetInstance['id']) => updateDraft((current) => moveNetskopeWidgetBefore(current, draggedId, targetId)),
    onSize: (id: NetskopeWidgetInstance['id'], size: NetskopeWidgetSize) => updateDraft((current) => current.map((widget) => widget.id === id ? { ...widget, size } : widget)),
    onRemove: (id: NetskopeWidgetInstance['id']) => { updateDraft((current) => current.filter((widget) => widget.id !== id)); focusFirstEditItem(); },
    onFilters: (id: NetskopeWidgetInstance['id'], filters: NetskopeWidgetFilters) => updateDraft((current) => current.map((widget) => widget.id === id ? { ...widget, filters } : widget)),
    onStyle: (id: NetskopeWidgetInstance['id'], mode: ChartMode) => updateDraft((current) => current.map((widget) => widget.id === id ? { ...widget, style: mode } : widget)),
    onAnnounce: setAnnouncement,
  };
  const addWidget = (id: NetskopeWidgetInstance['id']) => updateDraft((current) => [...current, { id, size: netskopeWidgetDefinition(id)?.defaultSize ?? 'sm', filters: {} }]);
  const wrap = (instance: NetskopeWidgetInstance, index: number, count: number, card: React.ReactNode, style?: React.CSSProperties) => editing
    ? <NetskopeEditableItem key={instance.id} instance={instance} index={index} count={count} saving={preferences.saving} facets={facets.data} style={style} {...editorHandlers}>{card}</NetskopeEditableItem>
    : style ? <span className="dashboard-visual-slot" key={instance.id} style={style}>{card}</span> : card;

  const dataCard = (instance: NetskopeWidgetInstance) => {
    const widgetId = instance.id;
    if (widgetId === 'alerts_by_severity') return <article className={`metric-button personal-metric-button personal-chart-card${editing ? '' : ` size-${instance.size}`}`} key={instance.id}>
      <NetskopeAaSeverity enabled={authChecked && authenticated && !preferences.loading} refreshKey={refreshKey} onUnauthorized={onUnauthorized} />
    </article>;
    const widgetMetrics = filtered.metricsFor(instance.filters);
    const alertDays = widgetId === 'alerts_7d' ? 7 : widgetId === 'alerts_30d' ? 30 : widgetId === 'alerts_90d' ? 90 : null;
    const alertMetric = alertDays ? alerts.data?.windows.find((window) => window.days === alertDays) : null;
    const alertAvailable = Boolean(alertDays && alertMetric);
    const alertAvailability = netskopeAlertAvailabilityLabel(alertMetric?.availability);
    const title = netskopeWidgetDefinition(widgetId)?.title ?? widgetId;
    const meta = netskopeDataCardMeta(widgetId, netskopeWidgetDefinition(widgetId)?.description);
    const activityValue = widgetMetrics && widgetId === 'users_recent_activity'
      ? widgetMetrics[`users_with_device_activity_${userActivityWindow}d`]
      : null;
    const activityAvailable = typeof activityValue === 'number';
    const rawValue = widgetId === 'users_recent_activity'
      ? activityValue
      : alertDays ? alertMetric?.total : (widgetMetrics as unknown as Record<string, unknown> | null)?.[widgetId];
    const numericValue = typeof rawValue === 'number' ? rawValue : 0;
    const detail = alertDays
        ? alertAvailable ? `Conteo agregado hasta ${alertMetric?.captured_at ? formatDate(alertMetric.captured_at) : 'la última sincronización'}${alertAvailability ? ` · ${alertAvailability}` : ''}` : alerts.error ? 'No se pudo cargar el agregado' : alerts.data?.configured === false ? t('Fuente count-only no configurada') : t('Sin snapshot agregado disponible')
        : !widgetMetrics
          ? filtered.loading ? 'Cargando métricas…' : filtered.error ? t('No se pudieron cargar las métricas') : t('Sin datos para este filtro')
        : widgetId === 'devices_observed_user_matched' || widgetId === 'devices_observed_user_unmatched'
          ? `${formatNumber(widgetMetrics.devices_total)} dispositivos con evento en 7 días · resueltos ${metricCount(widgetMetrics.devices_observed_user_matched)} · ambiguos ${metricCount(widgetMetrics.devices_observed_user_ambiguous)} · sin resolver ${metricCount(widgetMetrics.devices_observed_user_unmatched)}${freshnessSuffix(widgetMetrics, !hasNetskopeMetricReading(instance.id))}${widgetFilterSuffix(instance.filters)}`
        : widgetId === 'users_without_observed_devices'
          ? `${formatNumber(widgetMetrics.users_total)} ${widgetMetrics.users_total === 1 ? 'identidad' : 'identidades'} en inventario · con 1 dispositivo ${formatNumber(bucketCount(widgetMetrics.users_by_device_count, '1'))} · con 2+ ${formatNumber(bucketCount(widgetMetrics.users_by_device_count, '2plus'))}${freshnessSuffix(widgetMetrics, !hasNetskopeMetricReading(instance.id))}${widgetFilterSuffix(instance.filters)}`
        : widgetId === 'devices_stale_30d' ? `Último evento de más de 30 días${widgetFilterSuffix(instance.filters)}`
        : widgetId === 'fleet_client_current' && rawValue === null ? 'Sin línea base de versiones del cliente: no se evalúa'
        : widgetId === 'fleet_os_supported' && rawValue === null ? 'Sin mínimos de SO definidos: no se evalúa'
        : widgetId in FLEET_CARD_DETAIL ? FLEET_CARD_DETAIL[widgetId]
        : widgetId === 'users_total' ? [netskopeUsersSplit(widgetMetrics), typeof widgetMetrics.users_with_device_activity_7d === 'number'
          ? `${formatNumber(widgetMetrics.users_with_device_activity_7d)} con actividad de dispositivo en 7 días`
          : 'Total del último inventario; no implica actividad reciente'].filter(Boolean).join(' · ')
        : widgetId === 'users_recent_activity' ? activityAvailable
          ? `${percent(numericValue, widgetMetrics.users_total)} de ${formatNumber(widgetMetrics.users_total)} ${widgetMetrics.users_total === 1 ? 'identidad' : 'identidades'} en inventario · al menos un dispositivo con evento`
          : 'Métrica no disponible en esta versión de Custodia'
        : widgetId === 'devices_total' ? `Endpoints con evento en los últimos 7 días${heartbeatSuffix(widgetMetrics)}${freshnessSuffix(widgetMetrics, !hasNetskopeMetricReading(instance.id))}`
        : 'Referencia textual informada';
    // Keep the scan line short; the existing help retains the complete
    // population, filters and capture instead of clipping that evidence.
    const summary = !widgetMetrics ? detail
      : alertDays ? (alertAvailability ?? (alertAvailable ? 'Agregado disponible' : detail))
      : widgetId === 'users_recent_activity' ? activityAvailable ? `${percent(numericValue, widgetMetrics.users_total)} de ${formatNumber(widgetMetrics.users_total)} · ${userActivityWindow} días` : 'Métrica no disponible'
      : widgetId === 'users_total' ? (netskopeUsersSplit(widgetMetrics)?.replace('deshabilitados', 'deshab.').replace('sin dato de cuentas', 'sin dato') ?? 'Identidades en inventario')
      : widgetId === 'devices_total' ? 'Eventos en los últimos 7 días'
      : widgetId === 'devices_stale_30d' ? 'Último evento > 30 días'
      : widgetId in FLEET_CARD_DETAIL && typeof rawValue === 'number' ? FLEET_CARD_DETAIL[widgetId]
      : widgetId === 'devices_observed_user_matched' || widgetId === 'devices_observed_user_unmatched' ? `De ${formatNumber(widgetMetrics.devices_total)} con evento en 7 días`
      : widgetId === 'users_without_observed_devices' ? `De ${formatNumber(widgetMetrics.users_total)} ${widgetMetrics.users_total === 1 ? 'identidad' : 'identidades'}`
      : detail;
    const hasFilters = Object.values(instance.filters ?? {}).some(Boolean);
    const drill = netskopeDataWidgetDrill(widgetId as NetskopeDataWidgetId, instance.filters);
    if (widgetId === 'users_recent_activity') {
      return <div className={`dashboard-data-item netskope-data-card netskope-user-activity-card tone-${meta.tone}${editing ? '' : ` size-${instance.size}`}`} key={instance.id} title={meta.help}>
        <div className="dashboard-data-open netskope-data-open is-static">
          <span className="dashboard-data-title netskope-data-title">{meta.icon}{title}</span>
          <strong>{widgetMetrics && activityAvailable ? formatNumber(numericValue) : '—'}</strong>
          <small>{summary}</small>{hasFilters ? <span className="netskope-data-filter-status">{t('Con filtros')}</span> : null}
          <div className="netskope-activity-window" role="group" aria-label={t('Ventana de actividad de usuarios')}>
            {([7, 14, 30] as const).map((days) => <button key={days} type="button" aria-pressed={userActivityWindow === days} disabled={editing || !activityAvailable} onClick={() => setUserActivityWindow(days)}>{days} días</button>)}
            <button type="button" className="netskope-activity-open" disabled={editing || !activityAvailable} onClick={() => onDrill(netskopeUserActivityDrill(userActivityWindow))}>{t('Ver usuarios')} <span aria-hidden="true">→</span></button>
          </div>
          {editing ? null : <NetskopeRetiredActivity days={userActivityWindow} enabled={authChecked && authenticated && activityAvailable} refreshKey={refreshKey} onUnauthorized={onUnauthorized} />}
        </div>
        <NetskopeDataHelp instance={instance} />
      </div>;
    }
    const displayValue = alertDays
      ? alertMetric ? netskopeAlertTotalLabel(alertMetric.total) : '—'
      : !widgetMetrics ? '—' : typeof rawValue !== 'number' ? 'No calculable' : formatNumber(numericValue);
    const share = alertDays ? null : netskopeCardShare(widgetId as NetskopeDataWidgetId, widgetMetrics);
    const reference = widgetId === 'users_total' ? netskopeUsersReference(widgetMetrics) : null;
    const content = <><span className="dashboard-data-title netskope-data-title">{meta.icon}{title}</span><strong>{displayValue}</strong>
      {share ? <span className="netskope-data-share"><span className="netskope-data-share-bar" aria-hidden="true"><span style={{ width: `${Math.max(share.ratio * 100, share.part ? 2 : 0)}%` }} /></span><b>{share.share}</b> {share.label}</span> : null}
      {reference ? <span className="netskope-data-reference">{reference.label}</span> : null}
      <small>{summary}</small>{hasFilters ? <span className="netskope-data-filter-status">{t('Con filtros')}</span> : null}{drill ? <ArrowRight size={14} aria-hidden /> : null}</>;
    return <div className={`dashboard-data-item netskope-data-card tone-${meta.tone}${editing ? '' : ` size-${instance.size}`}`} key={instance.id} title={meta.help}>
      {!editing && drill
        ? <button type="button" className="dashboard-data-open netskope-data-open" onClick={() => onDrill(drill)}>{content}</button>
        : <div className="dashboard-data-open netskope-data-open is-static" aria-disabled={editing ? undefined : true}>{content}</div>}
      <NetskopeDataHelp instance={instance} />
    </div>;
  };

  const chartCard = (instance: NetskopeWidgetInstance) => {
    const widgetId = instance.id;
    if (widgetId === 'alerts_by_severity') return <article className={`metric-button personal-metric-button personal-chart-card${editing ? '' : ` size-${instance.size}`}`} key={instance.id}>
      <NetskopeAaSeverity enabled={authChecked && authenticated && !preferences.loading} refreshKey={refreshKey} onUnauthorized={onUnauthorized} />
    </article>;
    if (widgetId.startsWith('aa_')) return <article className={`metric-button personal-metric-button personal-chart-card${editing ? '' : ` size-${instance.size}`}`} key={instance.id}>
      <NetskopeAaChart widgetId={widgetId} mode={netskopeChartMode(instance)} enabled={authChecked && authenticated && !preferences.loading} refreshKey={refreshKey} onUnauthorized={onUnauthorized} />
    </article>;
    const widgetMetrics = filtered.metricsFor(instance.filters);
    const definition = netskopeWidgetDefinition(widgetId);
    const rawBuckets: NetskopeMetricBucket[] = (widgetMetrics as unknown as Record<string, NetskopeMetricBucket[]> | null)?.[widgetId] || [];
    /* NSK-XMET-001: Spanish labels on screen, raw bucket value in the drill. */
    const crossChart = widgetId === 'devices_by_observed_user_status' || widgetId === 'users_by_device_count' || widgetId === 'users_by_recent_device_age';
    const crossLabels = widgetId === 'devices_by_observed_user_status' ? OBSERVED_USER_STATUS_LABELS : widgetId === 'users_by_device_count' ? DEVICE_COUNT_LABELS : DEVICE_AGE_LABELS;
    const buckets: NetskopeMetricBucket[] = crossChart
      ? rawBuckets.map((bucket) => ({ ...bucket, key: crossLabels[bucket.key] ?? bucket.key, filter_value: bucket.key }))
      : rawBuckets;
    const isCompanyChart = widgetId === 'devices_by_company' || widgetId === 'users_by_company';
    const hint = !widgetMetrics ? (filtered.loading ? t('Cargando métricas…') : t('Sin datos para este filtro'))
      : widgetId === 'devices_by_observed_user_status' ? `${formatNumber(widgetMetrics.devices_total)} dispositivos con evento en 7 días · resueltos, ambiguos y sin resolver${freshnessSuffix(widgetMetrics, !hasNetskopeMetricReading(instance.id))}${widgetFilterSuffix(instance.filters)}`
      : widgetId === 'users_by_device_count' ? `${formatNumber(widgetMetrics.users_total)} ${widgetMetrics.users_total === 1 ? 'identidad' : 'identidades'} en inventario${freshnessSuffix(widgetMetrics, !hasNetskopeMetricReading(instance.id))}${widgetFilterSuffix(instance.filters)}`
      : widgetId === 'users_by_recent_device_age' ? `Identidades con al menos un dispositivo resuelto · ${formatNumber(widgetMetrics.users_total)} en inventario${freshnessSuffix(widgetMetrics, !hasNetskopeMetricReading(instance.id))}${widgetFilterSuffix(instance.filters)}`
      : widgetId === 'coverage_risk_devices_by_user' ? `${metricCount(widgetMetrics.devices_active_total)} dispositivos activos, todo el inventario · Uninstalled/Disconnected/Admin Disabled${freshnessSuffix(widgetMetrics, !hasNetskopeMetricReading(instance.id))}${widgetFilterSuffix(instance.filters)}`
      : '';
    const limit = NETSKOPE_RANKING_LIMITS[widgetId as NetskopeChartWidgetId] ?? 10;
    const isUserRanking = widgetId === 'users_by_company';
    const population = !widgetMetrics ? undefined
      : isUserRanking ? widgetMetrics.users_total
        : widgetId === 'devices_by_observed_user_status' ? widgetMetrics.devices_total
          : widgetId === 'users_by_device_count' ? widgetMetrics.users_total
              : NETSKOPE_RANKING_LIMITS[widgetId as NetskopeChartWidgetId] ? widgetMetrics.devices_total ?? null : undefined;
    const populationLabel = isUserRanking || widgetId === 'users_by_device_count' ? t('identidades en inventario') : t('dispositivos con evento en 7 días');
    return <article className={`metric-button personal-metric-button personal-chart-card${editing ? '' : ` size-${instance.size}`}${isCompanyChart ? ' company-chart-card' : ''}`} key={instance.id}>
      <div className="personal-chart-heading"><span className="metric-label">{definition?.title}</span>{hint ? <small title={widgetMetrics?.last_observed_at ? dateTimeHint(widgetMetrics.last_observed_at) : undefined}>{hint}</small> : null}</div>
      <CategoryChart title={definition?.title ?? widgetId} mode={netskopeChartMode(instance)} buckets={!widgetMetrics ? [] : buckets} population={population} populationLabel={populationLabel} limit={limit} sampleLabel={widgetId === 'coverage_risk_devices_by_user' ? `Los ${formatNumber(limit)} usuarios con más equipos sin cobertura · sin porcentaje` : undefined} onBucketSelect={editing ? undefined : (bucket) => {
        const drill = netskopeChartBucketDrill(widgetId as NetskopeChartWidgetId, bucket.filter_value || bucket.key);
        if (drill) onDrill(drill);
      }} />
      <NetskopeChartHelp instance={instance} metrics={widgetMetrics} />
    </article>;
  };

  const alertOverview = !editing && (alertDataInstances.length || alertChartInstances.length) ? <section className="netskope-alert-overview" aria-labelledby="netskope-alert-overview-title">
    <div className="netskope-alert-overview-heading">
      <div><div className="section-title"><ShieldAlert size={17} aria-hidden="true" /><h2 id="netskope-alert-overview-title">{t('Alertas Netskope agregadas')}</h2><HelpHint label={t('Alcance de las alertas agregadas')}><p>Sólo conteos por ventana y severidad. Los totales incluyen todos los tipos de alerta; cada bloque indica su fuente y período.</p><p>Cada dimensión tiene su período y alcance; no deben sumarse entre sí. La severidad se consulta en Advanced Analytics sin guardar sus resultados en la base local.</p></HelpHint></div></div>
    </div>
    {alertDataInstances.length ? <div className="netskope-alert-kpis" role="group" aria-label={t('Volumen de alertas Netskope agregadas')}>
      {alertDataInstances.map((instance) => {
        const days = instance.id === 'alerts_7d' ? 7 : instance.id === 'alerts_30d' ? 30 : 90;
        const window = alerts.data?.windows.find((item) => item.days === days);
        const dlp = window?.by_alert_type.find((bucket) => bucket.key.toLocaleLowerCase('es') === 'dlp')?.count;
        const updated = window?.captured_at ? <>{t('Actualizado')} <DateTime value={window.captured_at} /></> : alerts.error ? t('Agregado no disponible') : t('Sin snapshot agregado');
        const availability = netskopeAlertAvailabilityLabel(window?.availability);
        return <div className="netskope-alert-kpi" key={instance.id}>
          <span>Últimos {days} días</span><strong>{window ? netskopeAlertTotalLabel(window.total) : '—'}</strong><small>{updated}{availability ? ` · ${availability}` : ''}{typeof dlp === 'number' ? ` · DLP: ${formatNumber(dlp)}` : ''}</small>
        </div>;
      })}
    </div> : null}
    {alertChartInstances.length ? <div className="netskope-alert-dimensions" role="group" aria-label={t('Dimensiones de alertas Netskope agregadas')}>
      {alertChartInstances.map((instance) => <article className="netskope-alert-dimension" key={instance.id}>
        <NetskopeAaSeverity compact enabled={authChecked && authenticated && !preferences.loading} refreshKey={refreshKey} onUnauthorized={onUnauthorized} />
      </article>)}
    </div> : null}
  </section> : null;

  return <>
    <section ref={dashboardRef} className={`personal-dashboard netskope-personal-dashboard${editing ? ' is-editing' : ''}`} aria-label={t('Mi panel de métricas Netskope')}>
      <div className="personal-dashboard-heading">{editing ? null : <div className="personal-dashboard-heading-actions">
        {preferences.canUndo ? <button type="button" className="button subtle" disabled={preferences.saving} title={t('Deshacer el último guardado')} onClick={() => void preferences.undo()}><Undo2 size={14} aria-hidden="true" /> {t('Deshacer')}</button> : null}
        <DashboardPresetMenu presets={NETSKOPE_DASHBOARD_PRESETS} teamTemplates={teamTemplates.templates} disabled={preferences.saving} onSelect={applyPreset} onTeamSelect={applyTeamTemplate} onReset={resetView} onClear={clearView} />
        {permissions.includes('access:roles_manage') ? <DashboardTemplatePublisher disabled={preferences.saving || teamTemplates.publishing} blockCount={preferences.widgets.length} onPublish={(roleCode) => teamTemplates.publish(roleCode, preferences.widgets)} /> : null}
        <button type="button" className="button subtle" onClick={startEditing}><SlidersHorizontal size={14} /> {t('Editar vista')}</button>
      </div>}</div>
      {editing ? <DashboardEditToolbar label={t('Edición del tablero Netskope')} hint="Arrastrá o usá las flechas para ordenar" dirty={dirty} saving={preferences.saving} onCancel={requestCancel} onSave={() => void saveEditing()} /> : null}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {filtered.error ? <div className="notice warning" role="status"><span>{t('No se pudieron cargar las métricas de algunos bloques.')}</span><span className="notice-actions"><button type="button" className="button subtle" onClick={() => filtered.reload()}>{t('Reintentar')}</button>{filtered.errorInfo ? <ErrorDetailsButton details={filtered.errorInfo} /> : null}</span></div> : null}
      {!widgets.length && !editing
        ? <NetskopeEmptyDashboard saving={preferences.saving} onAddData={() => requestPicker('data')} onAddChart={() => requestPicker('chart')} onUseRecommended={() => void preferences.save(RECOMMENDED_NETSKOPE_WIDGETS)} />
        : <div className="personal-dashboard-content">
          {inventoryDataInstances.length || editing ? <section className="dashboard-data-section" aria-labelledby="netskope-data-title">
            <div className="dashboard-section-heading"><h2 id="netskope-data-title">{t('Datos clave')}</h2><ul className="netskope-color-legend" aria-label={t('Significado de los tonos de las métricas')}><li><i className="is-warning" />{t('Atención según el indicador')}</li><li><i className="is-success" />{t('Indicador favorable')}</li><li><i className="is-neutral" />{t('Referencia informativa')}</li></ul></div>
            <div className={`dashboard-data-strip netskope-data-strip${editing ? ' editing' : ''}`} role={editing ? 'list' : undefined}>{(editing ? dataInstances : inventoryDataInstances).map((instance, index) => wrap(instance, index, dataInstances.length, dataCard(instance)))}</div>
            {editing ? <NetskopeAddWidget kind="data" definitions={NETSKOPE_DATA_WIDGETS} addedIds={widgets.map((widget) => widget.id)} disabled={preferences.saving} limitReached={dataInstances.length >= 6} openRequest={pickerRequest?.kind === 'data' ? pickerRequest.token : undefined} metrics={metrics} alertWindows={alerts.data?.windows ?? []} onAdd={addWidget} onVisibleOptionsChange={setDataPreviewIds} activityChecked={dataPreviewIds.includes('users_recent_activity') && Boolean(metrics)} /> : null}
          </section> : null}
          {alertOverview}
          {inventoryChartInstances.length || editing ? <section className="dashboard-visual-section" aria-labelledby="netskope-visual-title">
            <div className="dashboard-section-heading"><h2 id="netskope-visual-title">{t('Gráficos')}</h2><p className="netskope-chart-color-note">{t('Hacé clic en una categoría para abrir el inventario. Los colores distinguen grupos, no gravedad.')}</p></div>
            <div className={`metrics personal-dashboard-metrics netskope-chart-grid${editing ? ' editing' : ''}`} role={editing ? 'list' : undefined}>{resolveDashboardRenderLayout(editing ? chartInstances : inventoryChartInstances).map(({ widget: instance, position, size }, index) => wrap(instance, index, chartInstances.length, chartCard(instance), dashboardGridPlacement(position, size)))}</div>
            {editing ? <NetskopeAddWidget kind="chart" definitions={[...NETSKOPE_CHART_WIDGETS, ...aaDefinitions]} aaPreviews={aaPreviews} addedIds={widgets.map((widget) => widget.id)} disabled={preferences.saving} limitReached={chartInstances.length >= 6} openRequest={pickerRequest?.kind === 'chart' ? pickerRequest.token : undefined} metrics={metrics} alertWindows={alerts.data?.windows ?? []} onAdd={addWidget} onVisibleOptionsChange={setChartPreviewIds} activityChecked={false} /> : null}
          </section> : null}
          {editing ? null : <button type="button" className="dashboard-create-card" title={t('Editar la vista para agregar un dato o gráfico')} onClick={startEditing}><span className="dashboard-create-icon"><Plus size={18} /></span><span><strong>{t('Agregar a la vista')}</strong><small>{t('Dato compacto o gráfico')}</small></span></button>}
        </div>}
    </section>
    {pendingCancel ? <ConfirmDialog
      icon={<Undo2 size={18} />}
      titleId="discard-netskope-dashboard-title"
      title={t('Descartar cambios')}
      descriptionId="discard-netskope-dashboard-copy"
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
      titleId="netskope-preset-title"
      title={pendingView.title}
      descriptionId="netskope-preset-copy"
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

const MATCH_BASIS_LABELS = { source_id: 'ID de usuario', email: 'correo' } as const;

/* NSK-XMET-003: "actividad observada" is the newest event a resolved device
   reported, never a login or a live connection. */
function UserActivityCells({ activity }: { activity?: NetskopeRow['device_activity'] }) {
  if (!activity || !activity.latest_event) return <><td colSpan={3}><span className="muted">{t('Sin actividad observada')}</span></td></>;
  const basis = activity.match_basis.map((key) => MATCH_BASIS_LABELS[key]).join(' + ');
  return <>
    <td>{formatNumber(activity.device_count)}</td>
    <td title={activity.latest_device ?? ''}><span className="cell-stack"><strong className="cell-lead">{activity.latest_device || '—'}</strong>{basis ? <small className="cell-sub">Coincidencia exacta: {basis}</small> : null}</span></td>
    <td className="netskope-signal-date"><DateTime value={activity.latest_event} /></td>
  </>;
}

/* One cell for "when did it last report" and "what does Custodia make of it": the colour dot carries the state, the
   relative time is the lead and the exact moment stays in the tooltip. */
function SignalCell({ evidence }: { evidence?: NetskopeRow['device_evidence'] }) {
  const state = evidence?.state ?? 'unknown';
  const tone = state === 'review' ? 'review' : state === 'recent' ? 'recent' : 'quiet';
  const age = evidence?.age_days == null ? undefined : `Antigüedad en la evaluación: ${Math.floor(evidence.age_days)} días`;
  return <span className="cell-stack netskope-signal" title={evidence?.reason}>
    <strong className="cell-lead netskope-signal-date"><i className={`netskope-signal-dot ${tone}`} aria-hidden="true" />{evidence?.last_signal_at ? <time dateTime={evidence.last_signal_at} title={`${formatDate(evidence.last_signal_at)}${age ? ` · ${age}` : ''}`}>{relativeTime(evidence.last_signal_at)}</time> : 'Sin señal'}</strong>
    <small className="cell-sub">{DEVICE_EVIDENCE_LABELS[state]}</small>
  </span>;
}

// Keep both timestamps when they differ; equal formatted minutes do not prove
// equal observations. The raw timestamps remain in the time elements.
function ObservationCell({ first, last }: { first: string; last: string }) {
  if (first === last) return <time dateTime={first} title={`Primera y última observación · ${dateTimeHint(first)}`}>{formatDate(first)}</time>;
  return <span className="cell-stack"><time dateTime={first} title={`Primera observación · ${dateTimeHint(first)}`}>Desde {formatDate(first)}</time><time dateTime={last} title={`Última observación · ${dateTimeHint(last)}`}>Hasta {formatDate(last)}</time></span>;
}

function NetskopeInventoryTable({ view, rows, total, search, deviceQuery, usersFilters, facets, syncText, syncObservedAt, loading, error, errorInfo, onSearch, onQueryChange, onDeviceFilterChange, onUsersFilterChange, onClearFilters, onClearUsersFilters, onRetry, onLoadMore, onSelectRow, onOpenUser }: {
  view: 'users' | 'devices'; rows: NetskopeRow[]; total: number; search: string; deviceQuery: NetskopeDeviceQuery; usersFilters: NetskopeUsersFilters; facets: NetskopeDeviceFacets | null; loading: boolean; error: string; errorInfo: ErrorDetails | null;
  syncText: string;
  syncObservedAt?: string | null;
  onSearch: (value: string) => void; onQueryChange: (patch: Partial<Omit<NetskopeDeviceQuery, 'filters'>>) => void; onDeviceFilterChange: (key: NetskopeDeviceFilterKey, value: string) => void; onUsersFilterChange: (patch: Partial<NetskopeUsersFilters>) => void; onClearFilters: () => void; onClearUsersFilters: () => void; onRetry: () => void; onLoadMore: () => void; onSelectRow: (row: NetskopeRow) => void; onOpenUser: (user: NetskopeUserSelection) => void;
}) {
  const isUsers = view === 'users';
  const activityView = isUsers && usersFilters.activityDays > 0;
  const columns = isUsers ? (activityView ? 7 : 4) : 6;
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const filtered = !isUsers && isNetskopeDeviceQueryActive(deviceQuery);
  const usersFiltered = isUsers && isNetskopeUsersFiltersActive(usersFilters);
  const userChips = !isUsers ? [] : [
    ...(usersFilters.deviceCount ? [{ id: 'device-count', label: `${t('Dispositivos')}: ${DEVICE_COUNT_LABELS[usersFilters.deviceCount] ?? usersFilters.deviceCount}`, patch: { deviceCount: '' as const } }] : []),
    ...(usersFilters.activityDays ? [{ id: 'activity-days', label: `Actividad observada: últimos ${usersFilters.activityDays} días`, patch: { activityDays: 0 as const } }] : []),
    ...(usersFilters.accountStatus ? [{ id: 'account-status', label: `Estado: ${ACCOUNT_STATUS_LABELS[usersFilters.accountStatus] ?? usersFilters.accountStatus}`, patch: { accountStatus: '' as const } }] : []),
    ...(usersFilters.recentDeviceAge ? [{ id: 'device-age', label: `Antigüedad del más reciente: ${DEVICE_AGE_LABELS[usersFilters.recentDeviceAge] ?? usersFilters.recentDeviceAge}`, patch: { recentDeviceAge: '' as const } }] : []),
  ];
  return <>
    <section className="list-panel database-surface">
      <p className="database-caption netskope-inventory-source netskope-sync-status" role="status" title={syncObservedAt ? dateTimeHint(syncObservedAt) : undefined}>{syncText}</p>
      <div className="search-row">
        <label className="search-box"><Search size={16} /><input type="search" aria-label={isUsers ? t('Buscar usuarios Netskope') : t('Buscar dispositivos Netskope')} placeholder={isUsers ? t('Buscar por nombre o correo') : t('Buscar por dispositivo o usuario observado')} value={search} onChange={(event) => onSearch(event.target.value)} /></label>
        {isUsers ? <CompactSelect className="netskope-evidence-filter" ariaLabel={t('Filtrar usuarios por estado')} value={usersFilters.accountStatus ?? ''} onChange={(next) => onUsersFilterChange({ accountStatus: next as NetskopeAccountStatus })} options={[{ value: '', label: t('Cualquier estado') }, { value: 'enabled', label: t('Habilitados') }, { value: 'disabled', label: t('Deshabilitados') }, { value: 'unknown', label: t('Sin dato de cuentas') }]} /> : null}
        {!isUsers ? <>
          <CompactSelect className="netskope-evidence-filter" ariaLabel={t('Filtrar por señales del equipo')} value={deviceQuery.evidenceState || deviceQuery.freshness} onChange={(next) => onQueryChange(next === 'recent' || next === 'all' ? { freshness: next, evidenceState: '' } : { freshness: 'all', evidenceState: next as NetskopeDeviceQuery['evidenceState'], eventAge: '' })} options={[{ value: 'recent', label: t('Señal reciente · 7 días') }, { value: 'all', label: t('Todo el inventario') }, { value: 'not_recent', label: t('Sin señal reciente') }, { value: 'review', label: t('Candidatos a revisión') }, { value: 'unknown', label: t('Sin evidencia vigente') }]} />
        </> : null}
        <span className="database-toolbar-count netskope-result-count">{loading && !rows.length ? t('Cargando inventario…') : error ? '—' : `${formatNumber(total)} ${isUsers ? total === 1 ? t('usuario') : t('usuarios') : total === 1 ? t('dispositivo') : t('dispositivos')}`}</span>
      </div>
      {!isUsers ? <NetskopeDeviceFilters query={deviceQuery} facets={facets} filtered={filtered} onQueryChange={onQueryChange} onDeviceFilterChange={onDeviceFilterChange} onClearFilters={onClearFilters} evidenceLabels={DEVICE_EVIDENCE_LABELS} /> : null}
      {isUsers && usersFiltered ? <div className="netskope-filter-row" role="group" aria-label={t('Filtros de usuarios')}>
        <div className="netskope-filter-active">
          <span className="netskope-filter-count">Filtros activos ({userChips.length})</span>
          {userChips.map((chip) => <span key={chip.id} className="netskope-filter-chip">{chip.label}<button type="button" aria-label={`Quitar filtro ${chip.label}`} onClick={() => onUsersFilterChange(chip.patch)}><X size={12} aria-hidden="true" /></button></span>)}
          <button type="button" className="button subtle netskope-clear-filters" onClick={onClearUsersFilters}><X size={13} aria-hidden="true" /> {t('Limpiar todos')}</button>
        </div>
      </div> : null}
      <div className="compact-table-wrap"><table className={`compact-table netskope-table ${isUsers ? 'is-users' : 'is-devices'}${activityView ? ' has-activity' : ''}`} aria-busy={loading}><thead><tr>
        {isUsers ? <><th>{t('Usuario')}</th><th>{t('Empresa')}</th><th>{t('Estado')}</th><th>{t('Observación')}</th>{activityView ? <><th>{t('Dispositivos resueltos')}</th><th>{t('Dispositivo más reciente')}</th><th>{t('Actividad observada')}</th></> : null}</> : <><th>{t('Dispositivo')}</th><th>{t('Usuario')}</th><th>{t('Empresa')}</th><th>{t('Señal')}</th><th>{t('Sistema operativo')}</th><th>{t('Cliente')}</th></>}
      </tr></thead><tbody>
        {loading && !rows.length && Array.from({ length: 4 }).map((_, index) => <tr key={`netskope-skeleton-${index}`} className="netskope-skeleton-row" aria-hidden="true"><td colSpan={columns}><span className="skeleton-line" /></td></tr>)}
        {!loading && error && <tr><td colSpan={columns}><StateBlock variant="error" title={t('No se pudo cargar Netskope')} hint={error} action={<><button type="button" className="button subtle" onClick={onRetry}>{t('Reintentar')}</button>{errorInfo ? <ErrorDetailsButton details={errorInfo} /> : null}</>} /></td></tr>}
        {!loading && !error && !rows.length && <tr><td colSpan={columns}><StateBlock variant={search || filtered || usersFiltered ? 'no-results' : 'empty'} title={search ? 'Sin resultados para esta búsqueda' : usersFiltered ? 'Ningún usuario coincide con estos filtros' : filtered ? t('Ningún dispositivo coincide con estos filtros') : t('Todavía no hay datos Netskope')} /></td></tr>}
        {!error && rows.map((row) => isUsers
          ? <tr key={row.object_id} onClick={() => onSelectRow(row)} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); onSelectRow(row); } }} tabIndex={0}><td title={row.display_name}><span className="cell-stack"><strong className="cell-lead">{row.display_name}</strong><small className="cell-sub">{value(row.attributes, 'email')}</small></span></td><td title={companyFromIdentity(value(row.attributes, 'email'))}><strong>{companyFromIdentity(value(row.attributes, 'email'))}</strong></td><td>{ACCOUNT_STATUS_LABELS[String(row.attributes.account_status ?? '')] ?? '—'}</td><td><ObservationCell first={row.first_seen_at} last={row.last_seen_at} /></td>{activityView ? <UserActivityCells activity={row.device_activity} /> : null}</tr>
          : [<tr key={row.object_id} className={expandedId === row.object_id ? 'is-expanded' : undefined} onClick={() => setExpandedId(expandedId === row.object_id ? null : row.object_id)} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); setExpandedId(expandedId === row.object_id ? null : row.object_id); } }} tabIndex={0}><td title={value(row.attributes, 'hostname')}><span className="cell-stack netskope-device-cell"><strong className="cell-lead"><button type="button" className="netskope-row-toggle" aria-expanded={expandedId === row.object_id} aria-label={`Ver detalle de ${value(row.attributes, 'hostname')}`} tabIndex={-1} onClick={(event) => { event.stopPropagation(); setExpandedId(expandedId === row.object_id ? null : row.object_id); }}><ChevronRight size={13} aria-hidden="true" /></button>{value(row.attributes, 'hostname')}</strong><small className="cell-sub">{deviceMakeModelLabel(value(row.attributes, 'device_make'), value(row.attributes, 'device_model'))}</small></span></td><td title={row.observed_user?.display_name || value(row.attributes, 'username')}><span className="cell-stack"><strong className="cell-lead">{row.observed_user?.display_name || value(row.attributes, 'username')}</strong><small className="cell-sub">{row.observed_user?.email || value(row.attributes, 'username')}</small>{row.observed_user_status === 'ambiguous' ? <StatusBadge tone="warning">{t('Usuario ambiguo')}</StatusBadge> : row.observed_user_status === 'unmatched' ? <span className="muted">{t('Usuario no correlacionado')}</span> : null}</span></td><td title={companyFromIdentity(row.observed_user?.email || value(row.attributes, 'username'))}>{companyFromIdentity(row.observed_user?.email || value(row.attributes, 'username'))}</td><td><SignalCell evidence={row.device_evidence} /></td><td className="netskope-version" title={`${value(row.attributes, 'os')} ${value(row.attributes, 'os_version')}`}>{value(row.attributes, 'os')} {value(row.attributes, 'os_version')}</td><td className="netskope-version" title={value(row.attributes, 'client_version')}>{value(row.attributes, 'client_version')}</td></tr>,
            expandedId === row.object_id ? <tr key={`${row.object_id}-detail`} className="netskope-device-detail-row"><td colSpan={columns}><NetskopeDeviceDetail row={row} onOpenUser={onOpenUser} /></td></tr> : null])}
      </tbody></table></div>
      {!error && <LoadMore loaded={rows.length} total={total} pageSize={NETSKOPE_PAGE_SIZE} loading={loading && rows.length > 0} onLoadMore={onLoadMore} />}
    </section>
  </>;
}

export function NetskopeWorkspace({ view, refreshKey, permissions, authChecked, authenticated, onUnauthorized, onError, onNotice, onNavigate, onOpenPosture }: Props) {
  const syncPresentation = useToolSyncPresentation(NETSKOPE_SYNC_PRESENTATION, authChecked && authenticated, refreshKey);
  const listView: 'users' | 'devices' = view === 'users' ? 'users' : 'devices';
  const inventory = useNetskopeInventory({
    view: view === 'metrics' || view === 'operations' ? view : listView,
    refreshKey, authChecked, authenticated, onUnauthorized, onError,
  });
  const [selectedRow, setSelectedRow] = useState<NetskopeRow | null>(null);
  const [userCard, setUserCard] = useState<NetskopeUserSelection | null>(null);
  const userCardFocusRef = useRef<HTMLInputElement>(null);
  useEffect(() => { onError(''); setSelectedRow(null); setUserCard(null); }, [view, onError]);
  const drillToDevices = (query: NetskopeDeviceQuery) => {
    inventory.applyDeviceQuery(query);
    onNavigate('devices');
  };
  const drillFromDashboard = (drill: NetskopeDashboardDrill) => {
    if (drill.view === 'users') {
      inventory.setSearch(drill.search);
      inventory.applyUsersFilters(drill.deviceCount || drill.recentDeviceAge || drill.activityDays || drill.accountStatus
        ? { deviceCount: drill.deviceCount ?? '', recentDeviceAge: drill.recentDeviceAge ?? '', activityDays: drill.activityDays ?? 0, accountStatus: drill.accountStatus ?? '' }
        : EMPTY_NETSKOPE_USERS_FILTERS);
      onNavigate('users');
      return;
    }
    drillToDevices(drill.query);
  };
  return <section className="netskope-workspace" aria-label={t('Netskope SSE')}>
    {view === 'metrics'
      ? <NetskopeMetricsView onDrill={drillFromDashboard} permissions={permissions} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} onNotice={onNotice} refreshKey={refreshKey} />
      : view === 'operations'
      ? <NetskopeOperationsView refreshKey={refreshKey} canAdminBaselines={permissions.includes('netskope:admin')} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onNotice={onNotice} onDrill={drillToDevices} onOpenPosture={onOpenPosture} />
      : <section className="netskope-inventory" aria-label={t('Inventario Netskope')}>
        <nav className="workspace-subnav workspace-subnav-nested" aria-label={t('Tipo de inventario Netskope')}>
          {([['devices', t('Registro de equipos')], ['users', t('Registro de usuarios')]] as const).map(([id, label]) => <a key={id}
            href={`/netskope/${id}`} className={listView === id ? 'active' : undefined} aria-current={listView === id ? 'page' : undefined}
            onClick={(event) => navigateInApp(event, () => { if (listView !== id) onNavigate(id); })}><strong>{label}</strong></a>)}
        </nav>
        <NetskopeInventoryTable view={listView} rows={inventory.rows} total={inventory.total} search={inventory.search} deviceQuery={inventory.deviceQuery} usersFilters={inventory.usersFilters} facets={inventory.facets} syncText={syncPresentation?.text ?? ''} syncObservedAt={syncPresentation?.observedAt} loading={inventory.loading} error={inventory.loadError} errorInfo={inventory.loadErrorInfo} onSearch={inventory.setSearch} onQueryChange={inventory.updateDeviceQuery} onDeviceFilterChange={inventory.setDeviceFilter} onUsersFilterChange={inventory.updateUsersFilters} onClearFilters={inventory.clearDeviceFilters} onClearUsersFilters={inventory.clearUsersFilters} onRetry={() => void inventory.reload()} onLoadMore={inventory.loadMore} onSelectRow={setSelectedRow} onOpenUser={setUserCard} />
        <NetskopeDetailDrawer row={listView === 'users' ? selectedRow : null} onClose={() => setSelectedRow(null)} />
        {userCard && listView === 'devices' ? <NetskopeUserDrawer key={userCard.userId ?? userCard.email} user={userCard} refreshKey={refreshKey ?? 0} canReadUba={permissions.includes('netskope:uba_read')} onUnauthorized={onUnauthorized} onClose={() => setUserCard(null)} fallbackFocusRef={userCardFocusRef} /> : null}
      </section>}
  </section>;
}
