import { EMPTY_NETSKOPE_DEVICE_QUERY } from './netskope-device-filters.ts';
import { formatNumber } from '../../../cross/lib/format.ts';
import { isChartMode, type ChartMode } from '../../../cross/lib/chart-mode.ts';
import type { NetskopeAaChartSummary, NetskopeAccountStatus, NetskopeAlertWindow, NetskopeChartWidgetId, NetskopeDataWidgetId, NetskopeDeviceFilterKey, NetskopeDeviceQuery, NetskopeEventAge, NetskopeMetricBucket, NetskopeUserActivityDays, NetskopeUsersDeviceCountFilter, NetskopeWidgetFilterKey, NetskopeWidgetFilters, NetskopeWidgetInstance, NetskopeWidgetSize } from '../types/netskope';
import { t } from '../../../cross/i18n/index.ts';

/* Count-only DLP aggregate widgets have no destination: Custodia does not store
   or investigate individual incidents/events, so their drill is null and the
   card stays informational. */
export type NetskopeDashboardDrill =
  | { view: 'users'; search: string; deviceCount?: NetskopeUsersDeviceCountFilter; recentDeviceAge?: NetskopeEventAge; activityDays?: NetskopeUserActivityDays; accountStatus?: NetskopeAccountStatus }
  | { view: 'devices'; query: NetskopeDeviceQuery };

/* A card drills into exactly the devices it counted: the widget's own filters (OS, company,
   classification) travel with the drill, and the clicked bucket's filter wins over them. */
function deviceQuery(filter?: { key: NetskopeDeviceFilterKey; value: string }, widgetFilters?: NetskopeWidgetFilters): NetskopeDeviceQuery {
  const fromWidget = Object.fromEntries(Object.entries(widgetFilters ?? {}).filter(([, value]) => value));
  return {
    ...EMPTY_NETSKOPE_DEVICE_QUERY,
    filters: { ...EMPTY_NETSKOPE_DEVICE_QUERY.filters, ...fromWidget, ...(filter ? { [filter.key]: filter.value } : {}) },
  };
}

const OBSERVED_USER_STATUSES = ['matched', 'ambiguous', 'unmatched'] as const;

export type NetskopeAlertDimension = 'by_alert_type' | 'by_severity' | 'by_action';

export function netskopeAlertTotalLabel(total: number | null): string {
  return total === null ? t('Sin dato') : formatNumber(total);
}

export function netskopeAlertAvailabilityLabel(
  availability: NetskopeAlertWindow['availability'] | undefined,
): string | null {
  if (availability === 'incomplete') return 'Datos incompletos';
  if (availability === 'stale') return 'Captura vencida';
  return null;
}

const UNKNOWN_ALERT_BUCKETS = new Set(['', 'unknown', 'sin dato', 'n/a', 'na', 'none', 'null', 'not available']);
const SEVERITY_LABELS: Record<string, string> = {
  critical: t('Crítica'), critica: t('Crítica'), crítica: t('Crítica'),
  high: t('Alta'), alta: t('Alta'),
  medium: t('Media'), media: t('Media'),
  low: t('Baja'), baja: t('Baja'),
  informational: 'Informativa', informative: 'Informativa', info: 'Informativa', informativa: 'Informativa',
};
const SEVERITY_ORDER = ['Crítica', 'Alta', 'Media', 'Baja', 'Informativa', 'Sin dato'];

/** Netskope may return the same aggregate category with different casing or
 * provider labels. Merge those presentation aliases while preserving the
 * exact total reported by the source snapshot. */
export function normalizeNetskopeAlertBuckets(
  dimension: NetskopeAlertDimension,
  buckets: NetskopeMetricBucket[],
): NetskopeMetricBucket[] {
  const merged = new Map<string, NetskopeMetricBucket>();
  for (const bucket of buckets) {
    const raw = bucket.key.trim().replace(/\s+/g, ' ');
    const normalized = raw.toLocaleLowerCase('es');
    const label = UNKNOWN_ALERT_BUCKETS.has(normalized)
      ? t('Sin dato')
      : dimension === 'by_severity'
        ? (SEVERITY_LABELS[normalized] ?? raw)
        : raw;
    const identity = label.toLocaleLowerCase('es');
    const current = merged.get(identity);
    if (current) current.count += bucket.count;
    else merged.set(identity, { key: label, count: bucket.count });
  }
  const result = [...merged.values()];
  if (dimension === 'by_severity') {
    result.sort((left, right) => {
      const leftIndex = SEVERITY_ORDER.indexOf(left.key);
      const rightIndex = SEVERITY_ORDER.indexOf(right.key);
      return (leftIndex < 0 ? SEVERITY_ORDER.length : leftIndex) - (rightIndex < 0 ? SEVERITY_ORDER.length : rightIndex)
        || right.count - left.count;
    });
  }
  return result;
}

/* NSK-XMET-003: the activity card carries its own window selector, so its
   drill is built from the selected window instead of being a fixed widget drill. */
export function netskopeUserActivityDrill(days: NetskopeUserActivityDays): NetskopeDashboardDrill {
  return { view: 'users', search: '', activityDays: days };
}

export function netskopeDataWidgetDrill(widget: NetskopeDataWidgetId, widgetFilters?: NetskopeWidgetFilters): NetskopeDashboardDrill | null {
  if (widget === 'users_total') return { view: 'users', search: '' };
  if (widget === 'users_recent_activity') return null;
  if (widget === 'users_without_observed_devices') return { view: 'users', search: '', deviceCount: '0' };
  if (widget.startsWith('alerts_')) return null;
  if (widget === 'devices_duplicate_hostnames') return { view: 'devices', query: { ...deviceQuery(), duplicate: 'hostname' } };
  if (widget === 'fleet_on_prem') return { view: 'devices', query: deviceQuery({ key: 'onprem_status', value: 'on-prem' }) };
  if (widget.startsWith('fleet_')) return null;
  if (widget === 'devices_observed_user_matched') return { view: 'devices', query: deviceQuery({ key: 'observed_user_status', value: 'matched' }, widgetFilters) };
  if (widget === 'devices_observed_user_unmatched') return { view: 'devices', query: deviceQuery({ key: 'observed_user_status', value: 'unmatched' }, widgetFilters) };
  // NSK-HB-001: the stale count drills into the exact devices it counts (older than 30 days).
  // It counts by age whatever the sync says, so the drill is the age filter (all inventory), not the review state.
  if (widget === 'devices_stale_30d') return { view: 'devices', query: { ...deviceQuery(undefined, widgetFilters), freshness: 'all', eventAge: 'gt_30d' } };
  // NSK-DEVREV-001: the unclassified card opens the same stale devices without a diagnosis, with the widget filters.
  return { view: 'devices', query: deviceQuery(undefined, widgetFilters) };
}

/* A count alone is ambiguous: "4.577 devices" and "4.577 resolved" read as two findings when
   one is the whole of the other. Cards that have a denominator also say what share they are. */
export type NetskopeCardShare = { part: number; total: number; share: string; ratio: number; label: string };

/** Never round a partial figure up to 100 % or a non-zero one down to 0 %: a manager acts on those two. */
export function netskopeShareLabel(part: number, total: number): string {
  if (part === 0) return '0 %';
  if (part === total) return '100 %';
  const percent = (part / total) * 100;
  if (percent < 1) return '<1 %';
  if (percent > 99) return '>99 %';
  return `${Math.round(percent)} %`;
}

type ShareMetrics = {
  devices_total?: number; users_total?: number; devices_stale_30d?: number;
  devices_observed_user_matched?: number; devices_observed_user_unmatched?: number; users_without_observed_devices?: number;
  fleet_devices?: number; fleet_signal_24h?: number; fleet_client_current?: number | null; fleet_client_evaluated?: number | null;
  fleet_os_supported?: number | null; fleet_os_evaluated?: number | null; fleet_on_prem?: number; fleet_location_reported?: number; devices_duplicate_hostnames?: number;
};

export function netskopeCardShare(id: NetskopeDataWidgetId, metrics: ShareMetrics | null | undefined): NetskopeCardShare | null {
  if (!metrics) return null;
  const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  let part: number | null | undefined;
  let total: number | null | undefined;
  let label = '';
  if (id === 'devices_observed_user_matched') [part, total, label] = [metrics.devices_observed_user_matched, metrics.devices_total, t('de los dispositivos con evento en 7 días')];
  else if (id === 'devices_observed_user_unmatched') [part, total, label] = [metrics.devices_observed_user_unmatched, metrics.devices_total, t('de los dispositivos con evento en 7 días')];
  else if (id === 'users_without_observed_devices') [part, total, label] = [metrics.users_without_observed_devices, metrics.users_total, t('de las identidades en inventario')];
  else if (id === 'fleet_signal_24h') [part, total, label] = [metrics.fleet_signal_24h, metrics.fleet_devices, t('de los equipos con evento en 7 días')];
  else if (id === 'fleet_client_current') [part, total, label] = [metrics.fleet_client_current, metrics.fleet_client_evaluated, t('de los equipos con versión reconocida')];
  else if (id === 'fleet_os_supported') [part, total, label] = [metrics.fleet_os_supported, metrics.fleet_os_evaluated, t('de los equipos con mínimo de SO definido')];
  else if (id === 'fleet_on_prem') [part, total, label] = [metrics.fleet_on_prem, metrics.fleet_location_reported, t('de los equipos que Netskope clasificó')];
  else if (id === 'devices_duplicate_hostnames') [part, total, label] = [metrics.devices_duplicate_hostnames, metrics.devices_total, t('de los equipos con evento en 7 días')];
  if (!isCount(part) || !isCount(total) || total === 0 || part > total) return null;
  return { part, total, share: netskopeShareLabel(part, total), ratio: part / total, label };
}

/* NSK-REF-001: Netskope's own user total (users/counts) beside the identities Custodia lists from getusers.
   They are different counts of the same tenant; the card states both and never adjusts either. */
/** NSK-USR-001: enabled/disabled users as the console counts them; only when every listed user has a status. */
export function netskopeUsersSplit(metrics: { users_total?: number; users_enabled?: number | null; users_disabled?: number | null } | null | undefined): string | null {
  if (!metrics || typeof metrics.users_total !== 'number' || typeof metrics.users_enabled !== 'number' || typeof metrics.users_disabled !== 'number') return null;
  const unknown = metrics.users_total - metrics.users_enabled - metrics.users_disabled;
  if (unknown < 0) return null;
  // No user has a status yet (the first sync after the change has not run): say so instead of "0 habilitados".
  if (metrics.users_enabled + metrics.users_disabled === 0) return metrics.users_total > 0 ? t('Estado de cuentas: se lee en el próximo sync') : null;
  return `${formatNumber(metrics.users_enabled)} habilitados · ${formatNumber(metrics.users_disabled)} deshabilitados${unknown ? ` · ${formatNumber(unknown)} sin dato de cuentas` : ''}`;
}

export type NetskopeUsersReference = { reported: number; listed: number; difference: number; label: string };

export function netskopeUsersReference(metrics: { users_total?: number; users_reported_total?: number | null } | null | undefined): NetskopeUsersReference | null {
  const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
  if (!metrics || !isCount(metrics.users_total) || !isCount(metrics.users_reported_total)) return null;
  const difference = metrics.users_total - metrics.users_reported_total;
  const gap = difference === 0 ? t('sin diferencia') : `${difference > 0 ? '+' : '−'}${formatNumber(Math.abs(difference))}`;
  return { reported: metrics.users_reported_total, listed: metrics.users_total, difference, label: `Diferencia frente a Netskope: ${gap}` };
}

const CHART_DEVICE_FILTERS: Partial<Record<NetskopeChartWidgetId, NetskopeDeviceFilterKey>> = {
  devices_by_os: 'os',
  devices_by_client: 'client_version',
  devices_by_make: 'device_make',
  devices_by_classification: 'classification_status',
  devices_by_user_status: 'user_status',
  devices_by_company: 'company',
};

export function netskopeChartBucketDrill(widget: NetskopeChartWidgetId, bucket: string): NetskopeDashboardDrill | null {
  if (widget.startsWith('alerts_')) return null;
  if (widget === 'users_by_company') return { view: 'users', search: bucket === 'Sin dato' ? '' : bucket };
  /* NSK-XMET-001: the cross charts drill with the bucket's exact value. */
  if (widget === 'devices_by_observed_user_status') {
    if (!(OBSERVED_USER_STATUSES as readonly string[]).includes(bucket)) return null;
    return { view: 'devices', query: deviceQuery({ key: 'observed_user_status', value: bucket }) };
  }
  if (widget === 'users_by_device_count') {
    if (!['0', '1', '2plus'].includes(bucket)) return null;
    return { view: 'users', search: '', deviceCount: bucket as NetskopeUsersDeviceCountFilter };
  }
  if (widget === 'users_by_recent_device_age') {
    if (!['lt_24h', 'd1_7', 'd7_30', 'gt_30d', 'unknown'].includes(bucket)) return null;
    return { view: 'users', search: '', recentDeviceAge: bucket as NetskopeEventAge };
  }
  if (widget === 'coverage_risk_devices_by_user') {
    if (!bucket) return null;
    return {
      view: 'devices',
      query: {
        ...deviceQuery(),
        freshness: 'all',
        coverageRisk: '1',
        filters: { ...EMPTY_NETSKOPE_DEVICE_QUERY.filters, observed_user: bucket },
      },
    };
  }
  const filter = CHART_DEVICE_FILTERS[widget];
  return { view: 'devices', query: deviceQuery(filter ? { key: filter, value: bucket } : undefined) };
}

const ALL_DEVICE_FILTER_KEYS: NetskopeWidgetFilterKey[] = ['os', 'company', 'classification_status'];

/* VIEW-002/VIEW-007: every widget declares its source, permission, data
   status, default size and which per-widget filters it supports. */
export type NetskopeWidgetDefinition = {
  id: NetskopeDataWidgetId | NetskopeChartWidgetId;
  kind: 'data' | 'chart';
  title: string;
  description: string;
  source: 'netskope';
  permission: 'netskope:read';
  dataStatus: 'confirmed' | 'pending';
  defaultSize: NetskopeWidgetSize;
  filterKeys: NetskopeWidgetFilterKey[];
  /** Period and unit a person declared for a tenant-defined Advanced Analytics chart. */
  aa?: { period: string; unit: string };
};

const ALL_NETSKOPE_DATA_WIDGETS: ReadonlyArray<NetskopeWidgetDefinition> = [
  { id: 'users_total', kind: 'data', title: t('Usuarios en inventario'), description: t('Identidades con al menos una cuenta no borrada en Netskope, habilitadas o no; no implica actividad reciente.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: ['company'] },
  { id: 'users_recent_activity', kind: 'data', title: t('Usuarios con actividad reciente'), description: t('Identidades con al menos un dispositivo vinculado por coincidencia exacta que reportó un evento en la ventana elegida.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: ['company'] },
  { id: 'devices_total', kind: 'data', title: 'Dispositivos', description: t('Endpoints con evento en los últimos 7 días.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'devices_stale_30d', kind: 'data', title: t('Equipos sin señal hace más de 30 días'), description: t('Equipos activos cuyo último evento tiene más de 30 días; candidatos a revisar su asignación, no una baja.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'devices_with_observed_user', kind: 'data', title: 'Con usuario observado', description: t('Endpoints con evento en los últimos 7 días y una referencia textual de usuario.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: ALL_DEVICE_FILTER_KEYS },
  /* NSK-XMET-001: cross user-device KPIs over the exact NSK-DEV-001 match. */
  { id: 'devices_observed_user_matched', kind: 'data', title: 'Con usuario resuelto', description: t('Dispositivos con evento en los últimos 7 días cuyo username coincide exactamente con un único usuario activo (id o email).'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'devices_observed_user_unmatched', kind: 'data', title: t('Sin usuario resuelto'), description: t('Dispositivos con evento en los últimos 7 días sin ninguna coincidencia exacta de usuario; no incluye ambigüedades.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'users_without_observed_devices', kind: 'data', title: t('Usuarios sin dispositivos'), description: t('Identidades vigentes en el inventario sin ningún dispositivo resuelto por coincidencia exacta.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: ['company'] },
  { id: 'fleet_signal_24h', kind: 'data', title: t('Equipos con señal en 24 h'), description: t('Equipos con evento en los últimos 7 días que reportaron en las últimas 24 horas; la diferencia son equipos que se están quedando callados.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: [] },
  { id: 'fleet_client_current', kind: 'data', title: t('Cliente al día'), description: t('Equipos cuya versión del cliente es la de la línea base de versiones, sobre los de versión reconocida. Sin línea base no se evalúa.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: [] },
  { id: 'fleet_os_supported', kind: 'data', title: t('SO en el mínimo exigido'), description: t('Equipos cuyo sistema operativo alcanza el mínimo configurado, sobre los de SO con mínimo definido. Sin mínimos no se evalúa.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: [] },
  { id: 'fleet_on_prem', kind: 'data', title: t('Equipos en oficina'), description: t('Equipos que Netskope detectó en la oficina (On-Premises Detection), sobre los que clasificó como oficina o remoto; sin dato no cuenta como remoto.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: [] },
  { id: 'devices_duplicate_hostnames', kind: 'data', title: t('Posibles duplicados por hostname'), description: t('Equipos con evento en los últimos 7 días que comparten hostname con otro; suelen ser reasignaciones o reimágenes, no se fusionan ni se dan de baja desde aquí.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: [] },
  { id: 'alerts_7d', kind: 'data', title: t('Alertas Netskope agregadas · 7 días'), description: t('Conteo agregado de alertas Netskope (todos los tipos) en los últimos 7 días; DLP es una de las dimensiones.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: [] },
  { id: 'alerts_30d', kind: 'data', title: t('Alertas Netskope agregadas · 30 días'), description: t('Conteo agregado de alertas Netskope (todos los tipos) en los últimos 30 días; DLP es una de las dimensiones.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: [] },
  { id: 'alerts_90d', kind: 'data', title: t('Alertas Netskope agregadas · 90 días'), description: t('Conteo agregado de alertas Netskope (todos los tipos) en los últimos 90 días; DLP es una de las dimensiones.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'sm', filterKeys: [] },
];

const ALL_NETSKOPE_CHART_WIDGETS: ReadonlyArray<NetskopeWidgetDefinition> = [
  { id: 'devices_by_os', kind: 'chart', title: t('Dispositivos por sistema operativo'), description: t('Distribución del SO entre equipos con evento en los últimos 7 días.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'devices_by_client', kind: 'chart', title: t('Dispositivos por cliente'), description: t('Distribución de versiones entre equipos con evento en los últimos 7 días.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'devices_by_make', kind: 'chart', title: t('Dispositivos por fabricante'), description: t('Distribución del fabricante entre equipos con evento en los últimos 7 días.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'devices_by_classification', kind: 'chart', title: t('Dispositivos por clasificación'), description: t('Distribución de la clasificación entre equipos con evento en los últimos 7 días.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'devices_by_user_status', kind: 'chart', title: t('Dispositivos por estado de usuario'), description: t('Distribución del estado de usuario entre equipos con evento en los últimos 7 días.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'devices_by_company', kind: 'chart', title: t('Dispositivos por empresa'), description: t('Distribución por empresa del usuario observado entre equipos con evento en los últimos 7 días.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'users_by_company', kind: 'chart', title: t('Usuarios por empresa'), description: t('Distribución de identidades por el dominio corporativo del correo.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: ['company'] },
  /* NSK-XMET-001: cross user-device KPIs over the exact NSK-DEV-001 match. */
  { id: 'devices_by_observed_user_status', kind: 'chart', title: t('Dispositivos por usuario observado'), description: t('Estados de la coincidencia exacta (resuelto, ambiguo, sin resolver) entre dispositivos con evento en los últimos 7 días.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'users_by_device_count', kind: 'chart', title: t('Usuarios por cantidad de dispositivos'), description: t('Identidades vigentes en el inventario con 0, 1 o 2+ dispositivos resueltos.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: ['company'] },
  { id: 'users_by_recent_device_age', kind: 'chart', title: t('Usuarios por antigüedad de su dispositivo más reciente'), description: t('Antigüedad del evento más nuevo del dispositivo resuelto de cada identidad; "Sin dato" es un dispositivo sin timestamp numérico.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: ['company'] },
  { id: 'coverage_risk_devices_by_user', kind: 'chart', title: t('Último evento de desinstalación o deshabilitación por usuario'), description: t('Dispositivos con último evento de desinstalación o deshabilitación (Uninstalled, Disconnected By Uninstall, Admin Disabled), agrupados por el usuario resuelto.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: ALL_DEVICE_FILTER_KEYS },
  { id: 'alerts_by_severity', kind: 'chart', title: t('Alertas Netskope por severidad'), description: t('Agregado AA disponible sólo con definición, período y unidad validados; no persiste resultados localmente.'), source: 'netskope', permission: 'netskope:read', dataStatus: 'pending', defaultSize: 'md', filterKeys: [] },
];

/** Widgets no longer offered in the picker or the presets (board
 * simplification). Their definitions stay so a saved view that already holds
 * one keeps rendering and the backend keeps accepting its id. */
const RETIRED_NETSKOPE_WIDGET_IDS: ReadonlySet<string> = new Set([
  'devices_observed_user_matched', 'users_without_observed_devices',
  // The aggregate alert counts (22 M / 108 M / 339 M) are not actionable; a saved view that holds one keeps rendering.
  'alerts_7d', 'alerts_30d', 'alerts_90d',
  'devices_by_make', 'devices_by_client', 'devices_by_user_status', 'devices_by_observed_user_status', 'users_by_device_count',
  'users_by_recent_device_age', 'coverage_risk_devices_by_user',
  // NSK-AA-001: replaced by the tenant chart map (`aa_<key>`); a view that still holds it keeps rendering.
  'alerts_by_severity',
]);

export const NETSKOPE_DATA_WIDGETS: ReadonlyArray<NetskopeWidgetDefinition> = ALL_NETSKOPE_DATA_WIDGETS.filter((widget) => !RETIRED_NETSKOPE_WIDGET_IDS.has(widget.id));
export const NETSKOPE_CHART_WIDGETS: ReadonlyArray<NetskopeWidgetDefinition> = ALL_NETSKOPE_CHART_WIDGETS.filter((widget) => !RETIRED_NETSKOPE_WIDGET_IDS.has(widget.id));

const NETSKOPE_WIDGETS_BY_ID = new Map(
  [...ALL_NETSKOPE_DATA_WIDGETS, ...ALL_NETSKOPE_CHART_WIDGETS].map((widget) => [widget.id, widget]),
);

/* Tenant-declared AA charts arrive from the server (`GET /cmdb/netskope/aa/charts`) and are
   registered here so every definition lookup resolves them like a static widget. */
const NETSKOPE_AA_CHARTS = new Map<string, NetskopeWidgetDefinition>();

export const NETSKOPE_AA_PREFIX = 'aa_';
export const isNetskopeAaChartId = (id: string): id is `aa_${string}` => id.startsWith(NETSKOPE_AA_PREFIX);

export function registerNetskopeAaCharts(charts: ReadonlyArray<NetskopeAaChartSummary>): NetskopeWidgetDefinition[] {
  NETSKOPE_AA_CHARTS.clear();
  for (const chart of charts) {
    NETSKOPE_AA_CHARTS.set(chart.id, {
      id: chart.id, kind: 'chart', title: chart.title,
      description: t('Gráfico de Advanced Analytics · {unit} · {period}.', { unit: chart.unit, period: chart.period }),
      source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: [],
      aa: { period: chart.period, unit: chart.unit },
    });
  }
  return [...NETSKOPE_AA_CHARTS.values()];
}

export function netskopeWidgetDefinition(id: NetskopeDataWidgetId | NetskopeChartWidgetId): NetskopeWidgetDefinition | undefined {
  const known = NETSKOPE_WIDGETS_BY_ID.get(id) ?? NETSKOPE_AA_CHARTS.get(id);
  if (known || !isNetskopeAaChartId(id)) return known;
  // A saved view can load before the chart list: keep the block until the list names it.
  return { id, kind: 'chart', title: t('Gráfico Advanced Analytics'), description: '', source: 'netskope', permission: 'netskope:read', dataStatus: 'confirmed', defaultSize: 'md', filterKeys: [], aa: { period: '', unit: '' } };
}

export const DEFAULT_NETSKOPE_DATA_WIDGETS: NetskopeDataWidgetId[] = [
  'users_recent_activity', 'devices_total', 'devices_stale_30d', 'fleet_signal_24h',
];
export const DEFAULT_NETSKOPE_CHART_WIDGETS: NetskopeChartWidgetId[] = [
  'devices_by_os', 'devices_by_company', 'devices_by_classification',
];

export const DEFAULT_NETSKOPE_WIDGETS: NetskopeWidgetInstance[] = [
  ...DEFAULT_NETSKOPE_DATA_WIDGETS.map((id) => ({ id, size: 'sm' as const })),
  ...DEFAULT_NETSKOPE_CHART_WIDGETS.map((id) => ({ id, size: 'md' as const })),
];

/* Suggested first board for an empty Netskope view: fleet size, devices
   without a signal for 30 days, recent DLP alerts and two confirmed distributions. It is only
   applied when the operator accepts it from the empty state, never
   automatically. */
export const RECOMMENDED_NETSKOPE_WIDGETS: NetskopeWidgetInstance[] = [
  { id: 'devices_total', size: 'sm' },
  { id: 'devices_stale_30d', size: 'sm' },
  { id: 'devices_observed_user_unmatched', size: 'sm' },
  { id: 'fleet_signal_24h', size: 'sm' },
  { id: 'devices_by_os', size: 'md' },
  { id: 'devices_by_classification', size: 'md' },
];

export type NetskopeDashboardPreset = {
  id: 'manager' | 'operations' | 'audit';
  label: string;
  description: string;
  widgets: NetskopeWidgetInstance[];
};

/** Role presets for the Netskope board (VIEW-003): three distinct starting
 * sets of registered widgets. Applying one replaces the saved view only
 * after the operator confirms it in the dialog. */
export const NETSKOPE_DASHBOARD_PRESETS: NetskopeDashboardPreset[] = [
  {
    id: 'manager', label: 'Manager',
    description: t('Tamaño de la flota, equipos sin señal hace más de 30 días y distribución por empresa.'),
    widgets: [
      { id: 'users_recent_activity', size: 'sm' }, { id: 'devices_total', size: 'sm' }, { id: 'devices_stale_30d', size: 'sm' },
      { id: 'devices_by_company', size: 'md' }, { id: 'users_by_company', size: 'md' }, { id: 'devices_by_os', size: 'md' },
    ],
  },
  {
    id: 'operations', label: 'Operaciones',
    description: t('Equipos sin señal y atributos de flota para priorizar el trabajo diario.'),
    widgets: [
      { id: 'devices_total', size: 'sm' }, { id: 'devices_stale_30d', size: 'sm' }, { id: 'devices_observed_user_unmatched', size: 'sm' },
      { id: 'devices_by_classification', size: 'md' }, { id: 'devices_by_os', size: 'md' },
    ],
  },
  {
    id: 'audit', label: t('Auditoría'),
    description: t('Salud de la flota (señal, cliente y SO) y la clasificación de los equipos.'),
    widgets: [
      { id: 'devices_total', size: 'sm' }, { id: 'fleet_client_current', size: 'sm' }, { id: 'fleet_os_supported', size: 'sm' },
      { id: 'devices_by_os', size: 'md' }, { id: 'devices_by_classification', size: 'md' },
    ],
  },
];

export function netskopeDataWidgetIds(widgets: NetskopeWidgetInstance[]): NetskopeDataWidgetId[] {
  return widgets
    .map((widget) => widget.id)
    .filter((id): id is NetskopeDataWidgetId => netskopeWidgetDefinition(id)?.kind === 'data');
}

export function netskopeChartWidgetIds(widgets: NetskopeWidgetInstance[]): NetskopeChartWidgetId[] {
  return widgets
    .map((widget) => widget.id)
    .filter((id): id is NetskopeChartWidgetId => netskopeWidgetDefinition(id)?.kind === 'chart');
}

export function netskopeWidgetSize(widgets: NetskopeWidgetInstance[], id: NetskopeDataWidgetId | NetskopeChartWidgetId): NetskopeWidgetSize {
  return widgets.find((widget) => widget.id === id)?.size ?? netskopeWidgetDefinition(id)?.defaultSize ?? 'sm';
}

export function netskopeWidgetFilters(widget: NetskopeWidgetInstance): NetskopeWidgetFilters {
  return widget.filters ?? {};
}

export function netskopeFiltersActive(filters?: NetskopeWidgetFilters): boolean {
  return Boolean(filters && (filters.os || filters.company || filters.classification_status));
}

/** Stable identity for a filter combination, used to group metric requests. */
export function netskopeFilterKey(filters?: NetskopeWidgetFilters): string {
  const normalized = filters ?? {};
  return [normalized.os ?? '', normalized.company ?? '', normalized.classification_status ?? ''].join('\u0000');
}

export function netskopeFiltersFromKey(key: string): NetskopeWidgetFilters {
  const [os, company, classification] = key.split('\u0000');
  const filters: NetskopeWidgetFilters = {};
  if (os) filters.os = os;
  if (company) filters.company = company;
  if (classification) filters.classification_status = classification;
  return filters;
}

/** Move a widget one position earlier/later among widgets of its own kind. */
export function moveNetskopeWidget(widgets: NetskopeWidgetInstance[], id: NetskopeWidgetInstance['id'], direction: -1 | 1): NetskopeWidgetInstance[] {
  const kind = netskopeWidgetDefinition(id)?.kind;
  const indices = widgets
    .map((widget, index) => (netskopeWidgetDefinition(widget.id)?.kind === kind ? index : -1))
    .filter((index) => index >= 0);
  const position = indices.findIndex((index) => widgets[index].id === id);
  const target = position + direction;
  if (position < 0 || target < 0 || target >= indices.length) return widgets;
  const next = [...widgets];
  const from = indices[position];
  const to = indices[target];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Drop a dragged widget at another widget's position, same kind only. */
export function moveNetskopeWidgetBefore(widgets: NetskopeWidgetInstance[], draggedId: NetskopeWidgetInstance['id'], targetId: NetskopeWidgetInstance['id']): NetskopeWidgetInstance[] {
  const kind = netskopeWidgetDefinition(draggedId)?.kind;
  if (!kind || netskopeWidgetDefinition(targetId)?.kind !== kind || draggedId === targetId) return widgets;
  const from = widgets.findIndex((widget) => widget.id === draggedId);
  const to = widgets.findIndex((widget) => widget.id === targetId);
  if (from < 0 || to < 0) return widgets;
  const next = [...widgets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/* Accepts both the VIEW-002 widget instances and the legacy id arrays, so a
   dashboard saved before the shape change keeps loading unchanged. */
export function normalizeNetskopeWidgets(response: {
  widgets?: NetskopeWidgetInstance[] | null;
  data_widgets?: NetskopeDataWidgetId[] | null;
  chart_widgets?: NetskopeChartWidgetId[] | null;
}): NetskopeWidgetInstance[] {
  if (Array.isArray(response.widgets)) {
    return response.widgets.map((widget) => ({
      id: widget.id,
      size: widget.size ?? 'sm',
      // The saved donut/bars choice survives reloads, undo and role templates.
      ...(netskopeChartHasMode(widget.id) && isChartMode(widget.style) ? { style: widget.style } : {}),
      // Older servers accepted device filters on users/alerts, where they
      // were ignored. Keep only effective filters before rendering or saving.
      filters: Object.fromEntries(Object.entries(widget.filters ?? {}).filter(([key]) =>
        netskopeWidgetDefinition(widget.id)?.filterKeys.includes(key as NetskopeWidgetFilterKey))),
    }));
  }
  return [
    ...(response.data_widgets ?? []).map((id) => ({ id, size: 'sm' as const, filters: {} })),
    ...(response.chart_widgets ?? []).map((id) => ({ id, size: 'md' as const, filters: {} })),
  ];
}

export function toggleNetskopeWidget<T extends string>(selected: T[], widget: T): T[] {
  return selected.includes(widget) ? selected.filter((item) => item !== widget) : [...selected, widget];
}

/** Rankings of many categories read better as bars; the per-user risk list is a Top-10 sample and has no other reading. */
const BARS_BY_DEFAULT: ReadonlySet<NetskopeWidgetInstance['id']> = new Set(['devices_by_company', 'users_by_company', 'coverage_risk_devices_by_user']);

/** Category distributions can be drawn as a donut or as bars; the AA severity chart, the Top-10 risk sample and the data tiles cannot. */
export function netskopeChartHasMode(id: NetskopeWidgetInstance['id']): boolean {
  return netskopeWidgetDefinition(id)?.kind === 'chart' && id !== 'alerts_by_severity' && id !== 'coverage_risk_devices_by_user';
}

/** The presentation a chart has until someone picks another: shared by the catalog, the card and its settings. */
export function netskopeDefaultChartMode(id: NetskopeWidgetInstance['id']): ChartMode {
  return BARS_BY_DEFAULT.has(id) ? 'bars' : 'donut';
}

export function netskopeChartMode(instance: Pick<NetskopeWidgetInstance, 'id' | 'style'>): ChartMode {
  return netskopeChartHasMode(instance.id) && isChartMode(instance.style) ? instance.style : netskopeDefaultChartMode(instance.id);
}
