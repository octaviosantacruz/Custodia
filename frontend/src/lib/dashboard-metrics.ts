import type { AnalyticsBucket, ClassificationStatus, SafeHealthFilter, WorkflowStatus } from '../types/safe';
import type { DashboardWidgetSize } from './dashboard-layout';

export type DashboardWidgetFilters = {
  workflow_status: WorkflowStatus | '';
  classification_status: ClassificationStatus | '';
  inventory_scope: 'pending' | 'business' | 'internal' | '';
  data_quality_status: 'pending' | 'clean' | 'obsolete' | 'duplicate' | '';
  health_filter: SafeHealthFilter;
};

export type DashboardMeasure = 'safes' | 'accounts' | 'connections' | 'pam_users' | 'pam_roles' | 'sia_policies' | 'pam_sia_coverage' | 'zsp_coverage' | 'account_platform_coverage' | 'safe_account_coverage';
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
  buckets?: AnalyticsBucket[];
  chart_data?: DashboardChartData;
};

export const EMPTY_DASHBOARD_FILTERS: DashboardWidgetFilters = {
  workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '',
};

export const DASHBOARD_MEASURE_LABELS: Record<DashboardMeasure, string> = {
  safes: 'Safes', accounts: 'Cuentas', connections: 'Conexiones', pam_users: 'Usuarios PAM', pam_roles: 'Roles PAM', sia_policies: 'Políticas SIA',
  pam_sia_coverage: 'Cobertura PAM + SIA', zsp_coverage: 'Cobertura ZSP', account_platform_coverage: 'Cuentas con plataforma', safe_account_coverage: 'Safes con cuentas',
};

export const DASHBOARD_PERCENTAGE_MEASURES = new Set<DashboardMeasure>(['pam_sia_coverage', 'zsp_coverage', 'account_platform_coverage', 'safe_account_coverage']);

export const DASHBOARD_SHORTCUT_GROUPS: { id: DashboardShortcutGroup; label: string; hint: string }[] = [
  { id: 'coverage', label: 'Cobertura y alcance', hint: 'Qué inventarios tenemos y cuánto está cubierto' },
  { id: 'operations', label: 'Trabajo operativo', hint: 'Dónde hay trabajo pendiente o en curso' },
  { id: 'quality', label: 'Configuración', hint: 'Qué configuraciones requieren revisión' },
];

export const DASHBOARD_DIMENSION_LABELS: Record<DashboardChartDimension, string> = {
  workflow_status: 'estado',
  classification_status: 'clasificación',
  inventory_scope: 'alcance',
  data_quality_status: 'calidad',
  business_unit: 'unidad',
  responsible: 'responsable',
  next_action: 'próxima acción',
  account_type: 'tipo de cuenta',
  inventory_trend: 'tiempo',
  business_unit_workflow: 'empresa y estado',
  workflow_next_action: 'estado y decisión',
  safe_accounts_members: 'cuentas y miembros',
  business_unit_inventory: 'empresa',
};

export const DASHBOARD_DIMENSIONS: DashboardChartDimension[] = [
  'workflow_status', 'classification_status', 'inventory_scope', 'business_unit', 'responsible', 'next_action', 'account_type',
];

const WORKFLOW_LABELS: Record<string, string> = { pending: 'Pendiente', in_progress: 'En curso', blocked: 'Bloqueado', resolved: 'Resuelto', retired: 'Retirado' };
const CLASSIFICATION_LABELS: Record<string, string> = { pending: 'Pendiente', assigned: 'Asignada', review: 'En revisión' };
const SCOPE_LABELS: Record<string, string> = { pending: 'Pendiente', business: 'Negocio', internal: 'Interno CyberArk' };
const QUALITY_LABELS: Record<string, string> = { pending: 'Pendiente', clean: 'Depurado', obsolete: 'Obsoleto', duplicate: 'Duplicado' };
const HEALTH_LABELS: Record<string, string> = { missing_cpm: 'Sin CPM', no_accounts: 'Sin cuentas', retention_unconfigured: 'Sin retención', manage_safe_concentration: 'Manage Safe compartido' };

export function createDashboardWidget(index: number): DashboardWidget {
  return {
    widget_id: `custom-${Date.now()}-${index}`,
    title: 'Nueva métrica',
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
  | 'safe-account-coverage'
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
  { id: 'geographic-map', title: 'Mapa geográfico', detail: 'Requiere país, región o coordenadas verificadas en el inventario.' },
] as const;

export const DASHBOARD_SHORTCUTS: DashboardShortcut[] = [
  { id: 'connection-inventory', title: 'Conexiones inventariadas', detail: 'Filas de la última carga de conexiones migradas', kind: 'count', measure: 'connections', chart: null, filters: {}, group: 'coverage' },
  { id: 'safes-by-company', title: 'Safes por empresa', detail: 'Cuántos Safes tiene cada unidad o empresa', kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'business_unit' }, filters: {}, group: 'coverage' },
  { id: 'accounts-by-company', title: 'Cuentas por empresa', detail: 'Cuántas cuentas activas tiene cada unidad o empresa', kind: 'chart', measure: 'accounts', chart: { style: 'bars', group_by: 'business_unit' }, filters: {}, group: 'coverage' },
  { id: 'accounts-by-type', title: 'Cuentas por tipo', detail: 'Cómo se distribuyen las cuentas clasificadas', kind: 'chart', measure: 'accounts', chart: { style: 'bars', group_by: 'account_type' }, filters: {}, group: 'coverage' },
  { id: 'pam-users', title: 'Usuarios PAM', detail: 'Usuarios activos observados en el inventario PAM', kind: 'count', measure: 'pam_users', chart: null, filters: {}, group: 'coverage' },
  { id: 'pam-roles', title: 'Roles PAM', detail: 'Roles activos observados en el inventario PAM', kind: 'count', measure: 'pam_roles', chart: null, filters: {}, group: 'coverage' },
  { id: 'sia-policies', title: 'Políticas SIA', detail: 'Políticas activas observadas en SIA', kind: 'count', measure: 'sia_policies', chart: null, filters: {}, group: 'coverage' },
  { id: 'status-distribution', title: 'Safes por estado', detail: 'Pendientes, en curso y resueltos', kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'workflow_status' }, filters: {}, group: 'operations' },
  { id: 'safes-by-action', title: 'Safes por próxima acción', detail: 'Qué trabajo operativo está pendiente', kind: 'chart', measure: 'safes', chart: { style: 'bars', group_by: 'next_action' }, filters: {}, group: 'operations' },
  { id: 'inventory-trend', title: 'Evolución del inventario', detail: 'Safes recibidos en las últimas sincronizaciones', kind: 'chart', measure: 'safes', chart: { style: 'line', group_by: 'inventory_trend' }, filters: {}, group: 'coverage', size: 'md' },
  { id: 'workflow-heatmap', title: 'Estado por empresa', detail: 'Cruce de empresa y estado operativo en un mapa de calor', kind: 'chart', measure: 'safes', chart: { style: 'heatmap', group_by: 'business_unit_workflow' }, filters: {}, group: 'operations', size: 'md' },
  { id: 'workflow-next-action', title: 'Decisiones pendientes', detail: 'Pendientes y en curso por migración a SIA o baja', kind: 'chart', measure: 'safes', chart: { style: 'heatmap', group_by: 'workflow_next_action' }, filters: {}, group: 'operations', size: 'md' },
  { id: 'safe-accounts-members', title: 'Cuentas vs. miembros', detail: 'Dispersión de cuentas y miembros por Safe', kind: 'chart', measure: 'safes', chart: { style: 'scatter', group_by: 'safe_accounts_members' }, filters: {}, group: 'coverage', size: 'md' },
  { id: 'inventory-combo', title: 'Safes y cuentas por empresa', detail: 'Barras de Safes y línea de cuentas para cada empresa', kind: 'chart', measure: 'safes', chart: { style: 'combo', group_by: 'business_unit_inventory' }, filters: {}, group: 'coverage', size: 'md' },
  { id: 'without-accounts', title: 'Safes sin cuentas', detail: 'Safes activos que aún no tienen cuentas', kind: 'count', measure: 'safes', chart: null, filters: { health_filter: 'no_accounts' }, group: 'operations' },
  { id: 'in-progress', title: 'Safes en curso', detail: 'Safes con trabajo de remediación iniciado', kind: 'count', measure: 'safes', chart: null, filters: { workflow_status: 'in_progress' }, group: 'operations' },
  { id: 'pending-classification', title: 'Pendientes de clasificar', detail: 'Safes que todavía necesitan una clasificación', kind: 'count', measure: 'safes', chart: null, filters: { classification_status: 'pending' }, group: 'quality' },
  { id: 'without-cpm', title: 'Safes sin CPM', detail: 'Señal técnica para revisar configuración CPM', kind: 'count', measure: 'safes', chart: null, filters: { health_filter: 'missing_cpm' }, group: 'quality' },
  { id: 'without-retention', title: 'Safes sin retención', detail: 'Safes sin retención o purga configurada', kind: 'count', measure: 'safes', chart: null, filters: { health_filter: 'retention_unconfigured' }, group: 'quality' },
  { id: 'pam-sia-coverage', title: 'Cobertura PAM + SIA', detail: 'Conexiones con coincidencia exacta en ambos sistemas', kind: 'count', measure: 'pam_sia_coverage', chart: null, filters: {}, group: 'coverage' },
  { id: 'zsp-coverage', title: 'Cobertura ZSP', detail: 'Conexiones del inventario con ZSP implementado', kind: 'count', measure: 'zsp_coverage', chart: null, filters: {}, group: 'coverage' },
  { id: 'account-platform-coverage', title: 'Cuentas con plataforma', detail: 'Cuentas activas con plataforma informada', kind: 'count', measure: 'account_platform_coverage', chart: null, filters: {}, group: 'quality' },
  { id: 'safe-account-coverage', title: 'Safes con cuentas', detail: 'Safes activos que contienen al menos una cuenta', kind: 'count', measure: 'safe_account_coverage', chart: null, filters: {}, group: 'quality' },
];

export function createDashboardShortcut(id: DashboardShortcutId, index: number): DashboardWidget {
  const shortcut = DASHBOARD_SHORTCUTS.find((item) => item.id === id);
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

function widgetFilterLabels(widget: DashboardWidget): string[] {
  return [
    widget.filters.workflow_status ? `Estado: ${WORKFLOW_LABELS[widget.filters.workflow_status]}` : '',
    widget.filters.classification_status ? `Clasificación: ${CLASSIFICATION_LABELS[widget.filters.classification_status]}` : '',
    widget.filters.inventory_scope ? `Alcance: ${SCOPE_LABELS[widget.filters.inventory_scope]}` : '',
    widget.filters.data_quality_status ? `Calidad: ${QUALITY_LABELS[widget.filters.data_quality_status]}` : '',
    widget.filters.health_filter ? `Señal: ${HEALTH_LABELS[widget.filters.health_filter]}` : '',
  ].filter(Boolean);
}

export function dashboardWidgetDetail(widget: DashboardWidget): string {
  const labels = widgetFilterLabels(widget);
  if (widget.kind === 'chart' && widget.chart) {
    const base = `${DASHBOARD_MEASURE_LABELS[widget.measure]} por ${DASHBOARD_DIMENSION_LABELS[widget.chart.group_by]}`;
    return labels.length ? `${base} · ${labels.join(' · ')}` : base;
  }
  if (labels.length) return labels.join(' · ');
  if (widget.measure === 'accounts') return 'Todas las cuentas activas';
  if (widget.measure === 'connections') return 'Última carga de conexiones';
  if (DASHBOARD_PERCENTAGE_MEASURES.has(widget.measure)) return 'Porcentaje sobre el universo disponible';
  return widget.measure === 'pam_users' ? 'Usuarios PAM activos'
    : widget.measure === 'pam_roles' ? 'Roles PAM activos'
      : widget.measure === 'sia_policies' ? 'Políticas SIA activas' : 'Todos los Safes activos';
}

export type DashboardWidgetExplanation = {
  includes: string;
  source: string;
  next: string;
};

const DASHBOARD_MEASURE_EXPLANATIONS: Record<DashboardMeasure, { includes: string; source: string; next: string }> = {
  safes: { includes: 'Safes activos del inventario según los filtros aplicados.', source: 'Inventario de Safes sincronizado desde CyberArk.', next: 'Abrí el resultado para revisar los Safes que forman el total.' },
  accounts: { includes: 'Cuentas activas observadas según los filtros aplicados.', source: 'Inventario operativo de cuentas sincronizado desde CyberArk; no incluye secretos.', next: 'Abrí el resultado para revisar las cuentas que forman el total.' },
  connections: { includes: 'Filas de conexiones migradas incluidas en la última carga.', source: 'Archivo CSV de inventario de conexiones importado en DS Hub.', next: 'Abrí el inventario para revisar IP, instancia, puerto y cobertura.' },
  pam_users: { includes: 'Usuarios activos observados en la cadena PAM.', source: 'Inventario PAM sincronizado desde CyberArk.', next: 'Abrí Identidades para revisar roles y Safes alcanzables.' },
  pam_roles: { includes: 'Roles activos observados en la cadena PAM.', source: 'Inventario PAM sincronizado desde CyberArk.', next: 'Abrí Identidades para revisar miembros y alcance.' },
  sia_policies: { includes: 'Políticas de acceso activas disponibles en SIA.', source: 'Políticas sincronizadas desde Secure Infrastructure Access.', next: 'Abrí SIA para revisar grantees y destinos de cada política.' },
  pam_sia_coverage: { includes: 'Conexiones importadas con coincidencia exacta tanto en PAM como en SIA.', source: 'Cruce entre activos y conexiones importadas, y la cobertura registrada por PAM y SIA.', next: 'Abrí Activos y conexiones para revisar coincidencias y brechas.' },
  zsp_coverage: { includes: 'Conexiones importadas marcadas con ZSP implementado.', source: 'Campo de cobertura ZSP de la última carga de conexiones.', next: 'Abrí Activos y conexiones para revisar las conexiones pendientes.' },
  account_platform_coverage: { includes: 'Cuentas activas con una plataforma informada.', source: 'Inventario operativo de cuentas sincronizado desde CyberArk.', next: 'Abrí Cuentas para revisar las que no tienen plataforma.' },
  safe_account_coverage: { includes: 'Safes activos que contienen al menos una cuenta activa.', source: 'Cruce del inventario de Safes y cuentas sincronizado desde CyberArk.', next: 'Abrí Safes para revisar los que no tienen cuentas.' },
};

export function dashboardWidgetExplanation(widget: DashboardWidget): DashboardWidgetExplanation {
  const base = DASHBOARD_MEASURE_EXPLANATIONS[widget.measure];
  const labels = widgetFilterLabels(widget);
  const includes = labels.length ? `${base.includes} Filtros: ${labels.join(' · ')}.` : base.includes;
  const source = (widget.filters.classification_status || widget.filters.workflow_status || widget.filters.inventory_scope || widget.filters.data_quality_status)
    ? `${base.source} La clasificación, alcance y estado operativo se mantienen localmente en DS Hub.`
    : base.source;
  return { includes, source, next: base.next };
}

export function dashboardValueLabel(widget: Pick<DashboardWidget, 'value' | 'value_format'>): string {
  const value = widget.value.toLocaleString('es-AR');
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
