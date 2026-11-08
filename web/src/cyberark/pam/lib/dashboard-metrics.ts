import type { AnalyticsBucket, ClassificationStatus, SafeHealthFilter, WorkflowStatus } from '../types/safe';
import type { DashboardWidgetSize } from '../../../cross/lib/dashboard-layout';
import { formatDate } from '../../../cross/lib/format.ts';
import { localeTag } from '../../../cross/i18n/index.ts';
import { t } from '../../../cross/i18n/index.ts';

export type DashboardWidgetFilters = {
  workflow_status: WorkflowStatus | '';
  classification_status: ClassificationStatus | '';
  inventory_scope: 'pending' | 'business' | 'internal' | '';
  data_quality_status: 'pending' | 'clean' | 'obsolete' | 'duplicate' | '';
  health_filter: SafeHealthFilter;
};

export type DashboardMeasure = 'safes' | 'accounts' | 'connections' | 'pam_users' | 'pam_roles' | 'sia_policies' | 'pam_sia_coverage' | 'zsp_coverage' | 'account_platform_coverage' | 'safe_account_coverage' | 'cyberark_compliance' | 'kr1_safe_bu_coverage' | 'kr2_connection_coverage';
export type DashboardChartStyle = 'pie' | 'bars' | 'line' | 'heatmap' | 'scatter' | 'combo';
export type DashboardChartDimension =
  | 'workflow_status' | 'classification_status' | 'inventory_scope' | 'data_quality_status'
  | 'business_unit' | 'responsible' | 'next_action' | 'account_type'
  | 'inventory_trend' | 'business_unit_workflow' | 'workflow_next_action' | 'safe_accounts_members' | 'business_unit_inventory';

export type DashboardChart = { style: DashboardChartStyle; group_by: DashboardChartDimension };
export type DashboardChartData = {
  labels?: string[];
  filter_values?: string[];
  series?: Array<{ key: string; label: string; values: number[] }>;
  x_labels?: string[];
  y_labels?: string[];
  cells?: Array<{ x: number; y: number; value: number; filter_value?: string }>;
  points?: Array<{ key: string; label: string; x: number; y: number; filter_value?: string }>;
};

export type DashboardWidget = {
  widget_id: string;
  title: string;
  kind: 'count' | 'goal' | 'chart';
  measure: DashboardMeasure;
  filters: DashboardWidgetFilters;
  chart: DashboardChart | null;
  target_value: number | null;
  target_direction: 'at_least' | 'at_most' | null;
  period_label: string | null;
  baseline_value: number | null;
  value_format: 'count' | 'percentage';
  size: DashboardWidgetSize;
  position: number | null;
  value: number;
  data_status?: 'available' | 'pending' | 'unavailable';
  total_accounts?: number;
  compliant_accounts?: number;
  measured_at?: string;
  covered_count?: number;
  total_count?: number;
  buckets?: AnalyticsBucket[];
  chart_data?: DashboardChartData;
};

export const EMPTY_DASHBOARD_FILTERS: DashboardWidgetFilters = {
  workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '',
};

/** Canonical identity of a widget definition (kind + measure + filters +
 * chart), independent of object key order. Used to know whether a shortcut
 * is already on the board. */
export function dashboardWidgetSignature(widget: Pick<DashboardWidget, 'kind' | 'measure' | 'filters' | 'chart'>): string {
  const filters = { ...EMPTY_DASHBOARD_FILTERS, ...widget.filters };
  return [
    widget.kind,
    widget.measure,
    ...Object.values(filters),
    widget.chart?.style ?? '',
    widget.chart?.group_by ?? '',
  ].join('|');
}

export const DASHBOARD_MEASURE_LABELS: Record<DashboardMeasure, string> = {
  safes: t('Safes'), accounts: t('Cuentas'), connections: t('Conexiones migradas'), pam_users: t('Usuarios PAM'), pam_roles: t('Roles PAM'), sia_policies: t('Políticas SIA'),
  pam_sia_coverage: t('Cobertura PAM + SIA'), zsp_coverage: t('Cobertura ZSP'), account_platform_coverage: t('Cuentas con plataforma'), safe_account_coverage: t('KR1 · Safes con cuentas'), cyberark_compliance: t('Compliance CyberArk'), kr1_safe_bu_coverage: t('Safes con unidad asignada'), kr2_connection_coverage: t('KR2 · Cobertura de conexiones migradas'),
};

export const DASHBOARD_PERCENTAGE_MEASURES = new Set<DashboardMeasure>(['pam_sia_coverage', 'zsp_coverage', 'account_platform_coverage', 'safe_account_coverage', 'cyberark_compliance', 'kr1_safe_bu_coverage', 'kr2_connection_coverage']);

/** Chart groupings backed by a dedicated cross-cut query (evolution, a
 * heatmap cross, a scatter, a combo) rather than the plain Safe/account
 * filter path -- mirrors the ADVANCED_STYLE_DIMENSION map in
 * components/dashboard-widget-config.tsx, which is the source of truth for
 * which style implies which dimension; kept here too so a
 * workflow_status/classification_status/etc. filter offer can be gated
 * without importing a component module. */
export const DASHBOARD_ADVANCED_CHART_DIMENSIONS = new Set<DashboardChartDimension>([
  'inventory_trend', 'business_unit_workflow', 'workflow_next_action', 'safe_accounts_members', 'business_unit_inventory',
]);

/** The dedicated grouping each advanced chart style reads; the plain styles (donut, bars) take any basic dimension. */
export const ADVANCED_STYLE_DIMENSION: Partial<Record<'line' | 'heatmap' | 'scatter' | 'combo', DashboardChartDimension>> = {
  line: 'inventory_trend', heatmap: 'business_unit_workflow', scatter: 'safe_accounts_members', combo: 'business_unit_inventory',
};

/** Switching style keeps what the chart groups by whenever both styles read the same grouping (donut and bars always do). */
export function withChartStyle(widget: DashboardWidget, style: DashboardChartStyle): DashboardWidget {
  const advancedDimension = ADVANCED_STYLE_DIMENSION[style as keyof typeof ADVANCED_STYLE_DIMENSION];
  const current = widget.chart?.group_by;
  const keepsGrouping = !advancedDimension && current !== undefined && !DASHBOARD_ADVANCED_CHART_DIMENSIONS.has(current);
  return {
    ...widget,
    measure: advancedDimension ? 'safes' : widget.measure,
    chart: { style, group_by: advancedDimension ?? (keepsGrouping ? current : DASHBOARD_DIMENSIONS[0]) },
    filters: advancedDimension ? { ...EMPTY_DASHBOARD_FILTERS } : widget.filters,
    size: advancedDimension ? 'md' : widget.size,
  };
}

/** Whether a widget's value/buckets can be narrowed with the Safe filter set
 * (workflow, classification, scope, quality, health signal) -- true for a
 * plain Safes/accounts count or a basic-dimension chart, false for the
 * global cross-cut measures (KR1/KR2/compliance/…) and the advanced chart
 * groupings, which compute from their own dedicated query. */
export function dashboardWidgetAcceptsFilters(widget: Pick<DashboardWidget, 'measure' | 'chart'>): boolean {
  return (widget.measure === 'safes' || widget.measure === 'accounts')
    && !(widget.chart && DASHBOARD_ADVANCED_CHART_DIMENSIONS.has(widget.chart.group_by));
}

/** Whether an evaluated widget is empty because of its active filters: a
 * filter-narrowable Safes/accounts block whose real result is 0. A source
 * that is genuinely unavailable (`data_status`) is excluded -- that is not a
 * filter problem. The editor preview uses this to warn instead of showing a
 * bare 0. */
export function dashboardWidgetEmptyAfterFilters(widget: Pick<DashboardWidget, 'measure' | 'chart' | 'filters' | 'value' | 'data_status'>): boolean {
  return dashboardWidgetAcceptsFilters(widget)
    && widget.data_status !== 'unavailable'
    && widget.value === 0
    && Object.values(widget.filters).some((value) => value !== '');
}

export const DASHBOARD_SHORTCUT_GROUPS: { id: DashboardShortcutGroup; label: string; hint: string }[] = [
  { id: 'coverage', label: t('Cobertura y alcance'), hint: t('Qué inventarios tenemos y cuánto está cubierto') },
  { id: 'operations', label: t('Trabajo operativo'), hint: t('Dónde hay trabajo pendiente o en curso') },
  { id: 'quality', label: t('Configuración'), hint: t('Qué configuraciones requieren revisión') },
];

export const DASHBOARD_DIMENSION_LABELS: Record<DashboardChartDimension, string> = {
  workflow_status: 'estado',
  classification_status: t('clasificación'),
  inventory_scope: 'alcance',
  data_quality_status: 'calidad',
  business_unit: 'unidad',
  responsible: 'responsable',
  next_action: t('próxima acción'),
  account_type: t('tipo de cuenta'),
  inventory_trend: 'tiempo',
  business_unit_workflow: t('empresa y estado'),
  workflow_next_action: t('estado y decisión'),
  safe_accounts_members: t('cuentas y miembros'),
  business_unit_inventory: 'empresa',
};

export const DASHBOARD_DIMENSIONS: DashboardChartDimension[] = [
  'workflow_status', 'classification_status', 'inventory_scope', 'business_unit', 'responsible', 'next_action', 'account_type',
];

const WORKFLOW_LABELS: Record<string, string> = { pending: t('Pendiente'), in_progress: t('En curso'), blocked: t('Bloqueado'), resolved: t('Resuelto'), retired: t('Retirado'), retention_hold: t('Baja retenida') };
const CLASSIFICATION_LABELS: Record<string, string> = { pending: t('Pendiente'), assigned: t('Asignada'), review: t('En revisión') };
const SCOPE_LABELS: Record<string, string> = { pending: t('Pendiente'), business: t('Negocio'), internal: t('Interno CyberArk') };
const QUALITY_LABELS: Record<string, string> = { pending: t('Pendiente'), clean: t('Depurado'), obsolete: t('Obsoleto'), duplicate: t('Duplicado') };
const HEALTH_LABELS: Record<string, string> = { missing_cpm: t('Sin CPM'), no_accounts: t('Sin cuentas'), retention_unconfigured: t('Sin retención'), manage_safe_concentration: t('Manage Safe compartido') };

export function createDashboardWidget(index: number): DashboardWidget {
  return {
    widget_id: `custom-${Date.now()}-${index}`,
    title: t('Nueva métrica'),
    kind: 'count',
    measure: 'safes',
    filters: { ...EMPTY_DASHBOARD_FILTERS },
    chart: null,
    target_value: null,
    target_direction: null,
    period_label: null,
    baseline_value: null,
    value_format: 'count',
    size: 'sm',
    position: null,
    value: 0,
  };
}

export type DashboardShortcutId =
  | 'kr1-safe-coverage'
  | 'safe-bu-coverage'
  | 'kr2-connection-coverage'
  | 'kr6-cyberark-compliance'
  | 'safes-by-company'
  | 'accounts-by-company'
  | 'status-distribution'
  | 'without-accounts'
  | 'pending-classification'
  | 'connection-inventory'
  | 'pam-users'
  | 'pam-roles'
  | 'sia-policies'
  | 'accounts-by-type'
  | 'safes-by-action'
  | 'without-cpm'
  | 'without-retention'
  | 'in-progress'
  | 'pam-sia-coverage'
  | 'zsp-coverage'
  | 'account-platform-coverage'
  | 'inventory-trend'
  | 'workflow-heatmap'
  | 'workflow-next-action'
  | 'safe-accounts-members'
  | 'inventory-combo';

export type DashboardShortcutGroup = 'coverage' | 'operations' | 'quality';

export type DashboardShortcut = {
  id: DashboardShortcutId;
  title: string;
  detail: string;
  kind: DashboardWidget['kind'];
  measure: DashboardMeasure;
  chart: DashboardChart | null;
  filters: Partial<DashboardWidgetFilters>;
  group: DashboardShortcutGroup;
  size?: DashboardWidgetSize;
};

export const DASHBOARD_UNAVAILABLE_CHARTS = [
  { id: 'geographic-map', title: t('Mapa geográfico'), detail: t('Requiere país, región o coordenadas verificadas en el inventario.') },
] as const;

const ALL_DASHBOARD_SHORTCUTS: DashboardShortcut[] = [
  { id: 'kr1-safe-coverage', title: t('KR1 · Safes con cuentas'), detail: t('KR1 · Safes activos con cuentas / total de Safes activos; mide completitud, no depuración'), kind: 'count', measure: 'safe_account_coverage', chart: null, filters: {}, group: 'coverage' },
  { id: 'safe-bu-coverage', title: t('Safes con unidad asignada'), detail: t('Safes activos con unidad de negocio asignada / total de Safes activos'), kind: 'count', measure: 'kr1_safe_bu_coverage', chart: null, filters: {}, group: 'coverage' },
  { id: 'kr2-connection-coverage', title: t('KR2 · Cobertura de conexiones migradas'), detail: t('Conexiones del CSV cubiertas por PAM o SIA / total de conexiones importadas'), kind: 'count', measure: 'kr2_connection_coverage', chart: null, filters: {}, group: 'coverage' },
  { id: 'kr6-cyberark-compliance', title: t('KR6 · Compliance CyberArk'), detail: t('Cuentas compliant / total de cuentas, según el último cálculo publicado'), kind: 'count', measure: 'cyberark_compliance', chart: null, filters: {}, group: 'quality' },
  { id: 'connection-inventory', title: t('Filas de conexiones migradas'), detail: t('Filas de la última carga de conexiones migradas'), kind: 'count', measure: 'connections', chart: null, filters: {}, group: 'coverage' },
  { id: 'safes-by-company', title: t('Safes por empresa'), detail: t('Compará cuántos Safes tiene cada unidad o empresa'), kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'business_unit' }, filters: {}, group: 'coverage' },
  { id: 'accounts-by-company', title: t('Cuentas por empresa'), detail: t('Cuántas cuentas activas tiene cada unidad o empresa'), kind: 'chart', measure: 'accounts', chart: { style: 'pie', group_by: 'business_unit' }, filters: {}, group: 'coverage' },
  { id: 'accounts-by-type', title: t('Cuentas por tipo'), detail: t('Cómo se distribuyen las cuentas clasificadas'), kind: 'chart', measure: 'accounts', chart: { style: 'pie', group_by: 'account_type' }, filters: {}, group: 'coverage' },
  { id: 'pam-users', title: t('Usuarios PAM'), detail: t('Usuarios activos observados en el inventario PAM'), kind: 'count', measure: 'pam_users', chart: null, filters: {}, group: 'coverage' },
  { id: 'pam-roles', title: t('Roles PAM'), detail: t('Roles activos observados en el inventario PAM'), kind: 'count', measure: 'pam_roles', chart: null, filters: {}, group: 'coverage' },
  { id: 'sia-policies', title: t('Políticas SIA'), detail: t('Políticas activas observadas en SIA'), kind: 'count', measure: 'sia_policies', chart: null, filters: {}, group: 'coverage' },
  { id: 'status-distribution', title: t('Estado del trabajo sobre los Safes'), detail: t('Pendientes, en curso y resueltos'), kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'workflow_status' }, filters: {}, group: 'operations' },
  { id: 'safes-by-action', title: t('Safes por próxima acción'), detail: t('Qué trabajo operativo está pendiente'), kind: 'chart', measure: 'safes', chart: { style: 'bars', group_by: 'next_action' }, filters: {}, group: 'operations' },
  { id: 'inventory-trend', title: t('Evolución del inventario'), detail: t('Safes recibidos en las últimas sincronizaciones'), kind: 'chart', measure: 'safes', chart: { style: 'line', group_by: 'inventory_trend' }, filters: {}, group: 'coverage', size: 'md' },
  { id: 'workflow-heatmap', title: t('Estado por empresa'), detail: t('Cruce de empresa y estado operativo en un mapa de calor'), kind: 'chart', measure: 'safes', chart: { style: 'heatmap', group_by: 'business_unit_workflow' }, filters: {}, group: 'operations', size: 'md' },
  { id: 'workflow-next-action', title: t('Decisiones pendientes'), detail: t('Pendientes y en curso por migración a SIA o baja'), kind: 'chart', measure: 'safes', chart: { style: 'heatmap', group_by: 'workflow_next_action' }, filters: {}, group: 'operations', size: 'md' },
  { id: 'safe-accounts-members', title: t('Cuentas vs. miembros'), detail: t('Dispersión de cuentas y miembros por Safe'), kind: 'chart', measure: 'safes', chart: { style: 'scatter', group_by: 'safe_accounts_members' }, filters: {}, group: 'coverage', size: 'md' },
  { id: 'inventory-combo', title: t('Safes y cuentas por empresa'), detail: t('Barras de Safes y línea de cuentas para cada empresa'), kind: 'chart', measure: 'safes', chart: { style: 'combo', group_by: 'business_unit_inventory' }, filters: {}, group: 'coverage', size: 'md' },
  { id: 'without-accounts', title: t('Safes sin cuentas'), detail: t('Safes activos que aún no tienen cuentas'), kind: 'count', measure: 'safes', chart: null, filters: { health_filter: 'no_accounts' }, group: 'operations' },
  { id: 'in-progress', title: t('Safes en curso'), detail: t('Safes con trabajo de remediación iniciado'), kind: 'count', measure: 'safes', chart: null, filters: { workflow_status: 'in_progress' }, group: 'operations' },
  { id: 'pending-classification', title: t('Pendientes de clasificar'), detail: t('Safes que todavía necesitan una clasificación'), kind: 'count', measure: 'safes', chart: null, filters: { classification_status: 'pending' }, group: 'quality' },
  { id: 'without-cpm', title: t('Safes sin CPM'), detail: t('Señal técnica para revisar configuración CPM'), kind: 'count', measure: 'safes', chart: null, filters: { health_filter: 'missing_cpm' }, group: 'quality' },
  { id: 'without-retention', title: t('Safes sin retención'), detail: t('Safes sin retención o purga configurada'), kind: 'count', measure: 'safes', chart: null, filters: { health_filter: 'retention_unconfigured' }, group: 'quality' },
  { id: 'pam-sia-coverage', title: t('Cobertura PAM + SIA'), detail: t('Conexiones migradas con coincidencia exacta en ambos sistemas'), kind: 'count', measure: 'pam_sia_coverage', chart: null, filters: {}, group: 'coverage' },
  { id: 'zsp-coverage', title: t('Cobertura ZSP'), detail: t('Conexiones migradas del inventario con ZSP implementado'), kind: 'count', measure: 'zsp_coverage', chart: null, filters: {}, group: 'coverage' },
  { id: 'account-platform-coverage', title: t('Cuentas con plataforma'), detail: t('Cuentas activas con plataforma informada'), kind: 'count', measure: 'account_platform_coverage', chart: null, filters: {}, group: 'quality' },
];

/** Shortcuts no longer offered in the picker or the presets (board
 * simplification). Their definitions stay so a block already saved from one of
 * them keeps resolving; they are just not suggested any more. */
const RETIRED_SHORTCUT_IDS: ReadonlySet<DashboardShortcutId> = new Set<DashboardShortcutId>([
  'connection-inventory', 'pam-users', 'pam-roles', 'sia-policies', 'in-progress', 'pending-classification',
  'without-cpm', 'without-retention', 'pam-sia-coverage', 'zsp-coverage', 'account-platform-coverage',
  'workflow-heatmap', 'workflow-next-action', 'safe-accounts-members', 'inventory-combo', 'inventory-trend',
]);

export const DASHBOARD_SHORTCUTS: DashboardShortcut[] = ALL_DASHBOARD_SHORTCUTS.filter((shortcut) => !RETIRED_SHORTCUT_IDS.has(shortcut.id));

/** Suggested first board for an empty PAM view: two operational counters,
 * one classification counter, and three basic-dimension charts. Only
 * applied when the operator accepts it from the empty state, never
 * automatically -- mirrors RECOMMENDED_NETSKOPE_WIDGETS in
 * lib/netskope-dashboard.ts. */
export const RECOMMENDED_PAM_SHORTCUT_IDS: DashboardShortcutId[] = [
  'without-accounts', 'kr1-safe-coverage', 'safe-bu-coverage',
  'safes-by-company', 'accounts-by-type', 'status-distribution',
];

/** Factory default PAM board (VIEW-003): mirrors DEFAULT_DASHBOARD_WIDGETS in
 * services/dashboard_preferences.py, the three basic charts a fresh view
 * shows. "Restablecer a predeterminada" saves exactly this set. */
export const DEFAULT_PAM_SHORTCUT_IDS: DashboardShortcutId[] = ['safes-by-company', 'accounts-by-company', 'status-distribution'];

export type DashboardPreset = {
  id: 'manager' | 'operations' | 'audit';
  label: string;
  description: string;
  shortcutIds: DashboardShortcutId[];
};

/** Role presets for the PAM board (VIEW-003): three distinct starting sets
 * built from the shortcut catalog. Applying one replaces the saved view only
 * after the operator confirms it in the dialog. */
export const DASHBOARD_PRESETS: DashboardPreset[] = [
  {
    id: 'manager', label: t('Manager'),
    description: t('Cobertura y avance para reportar: KR1/KR2 y distribución por empresa.'),
    shortcutIds: ['kr1-safe-coverage', 'safe-bu-coverage', 'kr2-connection-coverage', 'safes-by-company', 'accounts-by-company'],
  },
  {
    id: 'operations', label: t('Operaciones'),
    description: t('Trabajo pendiente y en curso: remediación, estados y próximas decisiones.'),
    shortcutIds: ['without-accounts', 'safes-by-action', 'status-distribution'],
  },
  {
    id: 'audit', label: t('Auditoría'),
    description: t('Clasificación, calidad técnica y compliance para revisar controles.'),
    shortcutIds: ['kr6-cyberark-compliance', 'safe-bu-coverage', 'accounts-by-type'],
  },
];

export function createDashboardShortcut(id: DashboardShortcutId, index: number): DashboardWidget {
  const shortcut = ALL_DASHBOARD_SHORTCUTS.find((item) => item.id === id);
  if (!shortcut) throw new Error(`Atajo de dashboard desconocido: ${id}`);

  const base = createDashboardWidget(index);
  return {
    ...base,
    widget_id: `shortcut-${id}-${Date.now()}-${index}`,
    title: shortcut.title,
    kind: shortcut.kind,
    measure: shortcut.measure,
    filters: { ...EMPTY_DASHBOARD_FILTERS, ...shortcut.filters },
    chart: shortcut.chart,
    size: shortcut.size ?? base.size,
    value_format: DASHBOARD_PERCENTAGE_MEASURES.has(shortcut.measure) ? 'percentage' : 'count',
  };
}

export function toDashboardPreferencePayload(widgets: DashboardWidget[]) {
  return widgets.map(({ value: _value, buckets: _buckets, chart_data: _chartData,
    data_status: _dataStatus, total_accounts: _totalAccounts,
    compliant_accounts: _compliantAccounts, measured_at: _measuredAt,
    covered_count: _coveredCount, total_count: _totalCount, ...widget }) => widget);
}

function widgetFilterLabels(widget: DashboardWidget): string[] {
  return [
    widget.filters.workflow_status ? `Estado: ${WORKFLOW_LABELS[widget.filters.workflow_status]}` : '',
    widget.filters.classification_status ? `Clasificación: ${CLASSIFICATION_LABELS[widget.filters.classification_status]}` : '',
    widget.filters.inventory_scope ? `Alcance: ${SCOPE_LABELS[widget.filters.inventory_scope]}` : '',
    widget.filters.data_quality_status ? `Calidad: ${QUALITY_LABELS[widget.filters.data_quality_status]}` : '',
    widget.filters.health_filter ? `Señal: ${HEALTH_LABELS[widget.filters.health_filter]}` : '',
  ].filter(Boolean);
}

/** Compact local label for a widget's measurement timestamp (VIEW-004). */
function measuredAtLabel(measuredAt: string): string {
  return formatDate(measuredAt);
}

const RUN_FRESHNESS_MEASURES = new Set<DashboardMeasure>(['safes', 'accounts', 'pam_users', 'pam_roles', 'sia_policies']);

/** Freshness suffix for synchronized inventory measures (VIEW-004): the
 * pending state with its run date (a confirmed run adds nothing), or the missing-inventory note.
 * Compliance, connections and the percentage measures render their own. */
function inventoryFreshnessLabel(widget: DashboardWidget): string {
  if (!RUN_FRESHNESS_MEASURES.has(widget.measure)) return '';
  if (widget.data_status === 'unavailable') return t(' · Sin inventario sincronizado');
  if (!widget.measured_at) return widget.data_status === 'pending' ? t(' · Pendiente') : '';
  const measured = measuredAtLabel(widget.measured_at);
  return widget.data_status === 'pending' ? ` · Pendiente: corrida del ${measured}` : '';
}

const COVERAGE_DETAIL_MEASURES = new Set<DashboardMeasure>(['kr1_safe_bu_coverage', 'kr2_connection_coverage', 'safe_account_coverage', 'pam_sia_coverage', 'zsp_coverage', 'account_platform_coverage']);
const COVERAGE_DETAIL_FALLBACKS: Partial<Record<DashboardMeasure, string>> = {
  kr1_safe_bu_coverage: t('Safes con unidad de negocio asignada'),
  safe_account_coverage: t('Safes con al menos una cuenta activa'),
  kr2_connection_coverage: t('Conexiones migradas cubiertas por PAM o SIA'),
  pam_sia_coverage: t('Conexiones migradas cubiertas por PAM y SIA'),
  zsp_coverage: t('Conexiones migradas con ZSP implementado'),
  account_platform_coverage: t('Cuentas con plataforma informada'),
};

export function dashboardWidgetDetail(widget: DashboardWidget): string {
  if (COVERAGE_DETAIL_MEASURES.has(widget.measure)) {
    if (widget.data_status === 'unavailable') return t('Sin inventario disponible');
    const unit = widget.measure === 'account_platform_coverage' ? 'cuentas' : widget.measure === 'safe_account_coverage' || widget.measure === 'kr1_safe_bu_coverage' ? t('Safes') : t('conexiones migradas');
    if (widget.covered_count !== undefined && widget.total_count !== undefined) return `${widget.covered_count} de ${widget.total_count} ${unit}`;
    return COVERAGE_DETAIL_FALLBACKS[widget.measure] ?? '';
  }
  if (widget.measure === 'cyberark_compliance') {
    if (widget.data_status === 'unavailable') return t('Sin cálculo publicado');
    if (widget.total_accounts !== undefined && widget.compliant_accounts !== undefined) {
      const counts = `${widget.compliant_accounts} de ${widget.total_accounts} cuentas`;
      if (!widget.measured_at) return counts;
      const measured = measuredAtLabel(widget.measured_at);
      return widget.data_status === 'pending' ? `${counts} · Pendiente: cálculo del ${measured}` : counts;
    }
    return t('Último cálculo publicado por el script');
  }
  const labels = widgetFilterLabels(widget);
  const freshness = inventoryFreshnessLabel(widget);
  if (widget.kind === 'chart' && widget.chart) {
    const base = `${DASHBOARD_MEASURE_LABELS[widget.measure]} por ${DASHBOARD_DIMENSION_LABELS[widget.chart.group_by]}`;
    return labels.length ? `${base} · ${labels.join(' · ')}${freshness}` : `${base}${freshness}`;
  }
  if (labels.length) return `${labels.join(' · ')}${freshness}`;
  if (widget.measure === 'accounts') return `Todas las cuentas activas${freshness}`;
  if (widget.measure === 'connections') {
    if (widget.data_status === 'unavailable') return t('Sin carga de conexiones migradas publicada');
    const base = widget.measured_at ? `Última carga del ${measuredAtLabel(widget.measured_at)}` : 'Última carga de conexiones migradas';
    return widget.data_status === 'pending' ? `${base} · Pendiente de actualizar` : base;
  }
  if (DASHBOARD_PERCENTAGE_MEASURES.has(widget.measure)) return t('Porcentaje sobre el universo disponible');
  const base = widget.measure === 'pam_users' ? 'Usuarios PAM activos'
    : widget.measure === 'pam_roles' ? 'Roles PAM activos'
      : widget.measure === 'sia_policies' ? t('Políticas SIA activas') : t('Todos los Safes activos');
  return `${base}${freshness}`;
}

export type DashboardWidgetExplanation = {
  includes: string;
  source: string;
  next: string;
};

const DASHBOARD_MEASURE_EXPLANATIONS: Record<DashboardMeasure, { includes: string; source: string; next: string }> = {
  safes: { includes: t('Safes activos del inventario según los filtros aplicados.'), source: t('Inventario de Safes sincronizado desde CyberArk.'), next: t('Abrí el resultado para revisar los Safes que forman el total.') },
  accounts: { includes: t('Cuentas activas observadas según los filtros aplicados.'), source: t('Inventario operativo de cuentas sincronizado desde CyberArk; no incluye secretos.'), next: t('Abrí el resultado para revisar las cuentas que forman el total.') },
  connections: { includes: t('Filas de conexiones migradas incluidas en la última carga.'), source: t('Archivo CSV de inventario de conexiones importado en Custodia.'), next: t('Abrí Inventario para revisar IP, instancia, puerto y cobertura.') },
  pam_users: { includes: t('Usuarios activos observados en la cadena PAM.'), source: t('Inventario PAM sincronizado desde CyberArk.'), next: t('Abrí Identidades para revisar roles y Safes alcanzables.') },
  pam_roles: { includes: t('Roles activos observados en la cadena PAM.'), source: t('Inventario PAM sincronizado desde CyberArk.'), next: t('Abrí Identidades para revisar miembros y alcance.') },
  sia_policies: { includes: t('Políticas de acceso activas disponibles en SIA.'), source: t('Políticas sincronizadas desde Secure Infrastructure Access.'), next: t('Abrí SIA para revisar grantees y destinos de cada política.') },
  pam_sia_coverage: { includes: t('Conexiones importadas con coincidencia exacta tanto en PAM como en SIA.'), source: t('Cruce entre activos y conexiones importadas, y la cobertura registrada por PAM y SIA.'), next: t('Abrí Inventario para revisar coincidencias y brechas.') },
  zsp_coverage: { includes: t('Conexiones importadas marcadas con ZSP implementado.'), source: t('Campo de cobertura ZSP de la última carga de conexiones.'), next: t('Abrí Inventario para revisar las conexiones pendientes.') },
  account_platform_coverage: { includes: t('Cuentas activas con una plataforma informada.'), source: t('Inventario operativo de cuentas sincronizado desde CyberArk.'), next: t('Abrí Cuentas para revisar las que no tienen plataforma.') },
  safe_account_coverage: { includes: t('Safes activos que contienen al menos una cuenta activa, divididos por todos los Safes activos. Mide completitud del inventario; no prueba clasificación ni depuración y no representa el KR1 formal completo.'), source: t('Cruce del inventario de Safes y cuentas sincronizado desde CyberArk.'), next: t('Abrí Safes para revisar los que no tienen cuentas.') },
  cyberark_compliance: { includes: t('Cuentas con compliance.isCompliant=true dividido por todas las cuentas devueltas por CyberArk. Si falla alguna consulta, no se publica un porcentaje nuevo.'), source: t('Último resumen agregado publicado por el script de compliance de CyberArk; no mide rotación SRS.'), next: t('Ejecutá el script con --publish para actualizar el resultado. No se guardan detalles por cuenta.') },
  kr1_safe_bu_coverage: { includes: t('Safes activos con unidad de negocio asignada sobre todos los Safes activos del alcance seleccionado. Es clasificación de Safes, no el KR1 completo ni la depuración.'), source: t('Inventario de Safes y asignación local de unidad de negocio en Custodia.'), next: t('Abrí Safes para identificar los que aún no tienen unidad asignada.') },
  kr2_connection_coverage: { includes: t('Conexiones importadas con coincidencia exacta en PAM, SIA o ambos, divididas por todas las conexiones de la última carga.'), source: t('Inventario de conexiones importado desde CSV y coincidencias exactas con PAM y SIA. Es un proxy por conexión, no por cuenta elegible.'), next: t('Abrí Inventario para revisar las filas sin cobertura.') },
};

export function dashboardWidgetExplanation(widget: DashboardWidget): DashboardWidgetExplanation {
  const base = DASHBOARD_MEASURE_EXPLANATIONS[widget.measure];
  const labels = widgetFilterLabels(widget);
  const includes = labels.length ? `${base.includes} Filtros: ${labels.join(' · ')}.` : base.includes;
  const source = (widget.filters.classification_status || widget.filters.workflow_status || widget.filters.inventory_scope || widget.filters.data_quality_status)
    ? `${base.source} La clasificación, alcance y estado operativo se mantienen localmente en Custodia.`
    : base.source;
  return { includes, source, next: base.next };
}

export function dashboardValueLabel(widget: Pick<DashboardWidget, 'value' | 'value_format' | 'data_status'>): string {
  if (widget.data_status === 'unavailable') return t('Sin datos');
  const value = widget.value.toLocaleString(localeTag());
  return widget.value_format === 'percentage' ? `${value}%` : value;
}

export function dashboardGoalProgress(widget: DashboardWidget): number {
  if (widget.kind !== 'goal' || widget.target_value === null) return 0;
  const baseline = widget.baseline_value ?? 0;
  if (widget.target_direction === 'at_most' && widget.value <= widget.target_value) return 100;
  if (widget.target_direction === 'at_least' && widget.value >= widget.target_value) return 100;
  const distance = widget.target_direction === 'at_most'
    ? baseline - widget.target_value
    : widget.target_value - baseline;
  if (distance <= 0) return 0;
  const travelled = widget.target_direction === 'at_most'
    ? baseline - widget.value
    : widget.value - baseline;
  const ratio = travelled / distance;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}
