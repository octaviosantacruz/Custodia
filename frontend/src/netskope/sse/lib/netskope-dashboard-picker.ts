import { formatDate, formatNumber } from '../../../cross/lib/format.ts';
import {
  netskopeAlertAvailabilityLabel,
  netskopeAlertTotalLabel,
  type NetskopeWidgetDefinition,
} from './netskope-dashboard.ts';
import type {
  NetskopeAlertWindow,
  NetskopeMetricBucket,
  NetskopeSelectedMetrics,
} from '../types/netskope.ts';

export type NetskopeMetricGroupId = 'inventory' | 'alerts' | 'analytics';

export type NetskopeMetricPickerGroup = {
  id: NetskopeMetricGroupId;
  title: string;
  description: string;
  options: NetskopeWidgetDefinition[];
};

const GROUPS: ReadonlyArray<Omit<NetskopeMetricPickerGroup, 'options'>> = [
  {
    id: 'inventory',
    title: 'Inventario y cobertura',
    description: 'Identidades, dispositivos y cobertura observada.',
  },
  {
    id: 'alerts',
    title: 'Alertas y protección',
    description: 'Capturas agregadas de alertas Netskope y sus dimensiones.',
  },
  {
    id: 'analytics',
    title: 'Advanced Analytics',
    description: 'Gráficos de Netskope declarados para este tenant; DS Hub no guarda sus resultados.',
  },
];

/* Registered widgets the picker does not offer any more (NSK-HB-001: the 10 inventory options became 7). They stay in the
 * registry so an existing view that holds one keeps rendering; "with observed user" is a subset of resolved/unresolved. */
export const NETSKOPE_PICKER_HIDDEN_WIDGETS: ReadonlySet<NetskopeWidgetDefinition['id']> = new Set(['devices_with_observed_user']);

/* Explicit product allocation. Do not classify from title/prefix: the metric
 * registry owns the definitions, and this list owns the picker's grouping. */
const GROUP_BY_WIDGET_ID: Partial<Record<NetskopeWidgetDefinition['id'], NetskopeMetricGroupId>> = {
  users_total: 'inventory',
  users_recent_activity: 'inventory',
  devices_total: 'inventory',
  devices_stale_30d: 'inventory',
  devices_observed_user_matched: 'inventory',
  devices_observed_user_unmatched: 'inventory',
  users_without_observed_devices: 'inventory',
  devices_by_os: 'inventory',
  devices_by_client: 'inventory',
  devices_by_make: 'inventory',
  devices_by_classification: 'inventory',
  devices_by_user_status: 'inventory',
  devices_by_company: 'inventory',
  users_by_company: 'inventory',
  devices_by_observed_user_status: 'inventory',
  users_by_device_count: 'inventory',
  users_by_recent_device_age: 'inventory',
  coverage_risk_devices_by_user: 'inventory',
  alerts_7d: 'alerts',
  alerts_30d: 'alerts',
  alerts_90d: 'alerts',
  alerts_by_severity: 'alerts',
};

const INVENTORY_PERIODS: Partial<Record<NetskopeWidgetDefinition['id'], string>> = {
  users_total: 'Inventario vigente',
  users_recent_activity: 'Eventos de 7, 14 o 30 días (seleccionable en el widget)',
  devices_total: 'Eventos de los últimos 7 días',
  devices_stale_30d: 'Último evento de más de 30 días · inventario vigente',
  devices_with_observed_user: 'Eventos de los últimos 7 días',
  devices_observed_user_matched: 'Eventos de los últimos 7 días',
  devices_observed_user_unmatched: 'Eventos de los últimos 7 días',
  users_without_observed_devices: 'Inventario vigente',
  devices_by_os: 'Eventos de los últimos 7 días',
  devices_by_client: 'Eventos de los últimos 7 días',
  devices_by_make: 'Eventos de los últimos 7 días',
  devices_by_classification: 'Eventos de los últimos 7 días',
  devices_by_user_status: 'Eventos de los últimos 7 días',
  devices_by_company: 'Eventos de los últimos 7 días',
  users_by_company: 'Inventario vigente',
  devices_by_observed_user_status: 'Eventos de los últimos 7 días',
  users_by_device_count: 'Inventario vigente',
  users_by_recent_device_age: 'Edad del último evento en dispositivos resueltos',
  coverage_risk_devices_by_user: 'Último evento de desinstalación o deshabilitación · inventario vigente',
};

const CHART_BUCKET_FIELDS: Partial<Record<NetskopeWidgetDefinition['id'], keyof NetskopeSelectedMetrics>> = {
  devices_by_os: 'devices_by_os',
  devices_by_client: 'devices_by_client',
  devices_by_make: 'devices_by_make',
  devices_by_classification: 'devices_by_classification',
  devices_by_user_status: 'devices_by_user_status',
  devices_by_company: 'devices_by_company',
  users_by_company: 'users_by_company',
};

const ALERT_DATA_DAYS: Partial<Record<NetskopeWidgetDefinition['id'], NetskopeAlertWindow['days']>> = {
  alerts_7d: 7,
  alerts_30d: 30,
  alerts_90d: 90,
};

export function topBuckets(buckets: NetskopeMetricBucket[] | undefined): NetskopeMetricBucket[] | undefined {
  if (!buckets?.length) return undefined;
  return [...buckets].filter((bucket) => bucket.count > 0).sort((left, right) => right.count - left.count).slice(0, 5);
}

function formattedDate(value: string | null | undefined): string | undefined {
  if (!value || Number.isNaN(new Date(value).getTime())) return undefined;
  return formatDate(value);
}

function alertWindowLabel(window: NetskopeAlertWindow | undefined): string {
  if (!window) return 'Sin snapshot disponible';
  const availability = netskopeAlertAvailabilityLabel(window.availability)
    ?? (window.availability === 'complete' ? 'Captura completa' : 'Disponibilidad no informada');
  const start = formattedDate(window.window_start);
  const end = formattedDate(window.window_end);
  const captured = formattedDate(window.captured_at);
  const period = start && end ? ` · período ${start} – ${end}` : '';
  const capture = captured ? ` · capturada ${captured}` : '';
  return `${availability}${period}${capture}`;
}

/** Groups only registered options and omits categories that currently have
 * no real bindings (notably the reserved policies/use category). */
export function groupNetskopeWidgetDefinitions(
  definitions: readonly NetskopeWidgetDefinition[],
): NetskopeMetricPickerGroup[] {
  const options = new Map<NetskopeMetricGroupId, NetskopeWidgetDefinition[]>(GROUPS.map((group) => [group.id, []]));
  for (const definition of definitions) {
    const groupId = definition.aa ? 'analytics' : GROUP_BY_WIDGET_ID[definition.id];
    if (groupId) options.get(groupId)?.push(definition);
  }
  return GROUPS.flatMap((group) => {
    const groupOptions = options.get(group.id) ?? [];
    return groupOptions.length ? [{ ...group, options: groupOptions }] : [];
  });
}

export type NetskopeWidgetPickerDetails = {
  sourceLabel: string;
  previewLabel?: string;
  previewBuckets?: NetskopeMetricBucket[];
  unavailable?: boolean;
};

/** Presents only provenance and values already in memory; it never fetches a
 * contract or converts an absent projection/snapshot into a numerical zero. */
export function netskopeWidgetPickerDetails(
  definition: NetskopeWidgetDefinition,
  metrics: NetskopeSelectedMetrics | null,
  alertWindows: readonly NetskopeAlertWindow[],
): NetskopeWidgetPickerDetails {
  if (definition.dataStatus === 'pending') {
    return {
      sourceLabel: 'Fuente: Advanced Analytics · Período: sin binding aprobado · Disponibilidad: requiere definición validada',
      unavailable: true,
    };
  }

  if (definition.aa) {
    return { sourceLabel: `Fuente: Advanced Analytics · Período: ${definition.aa.period || 'no informado'} · Unidad: ${definition.aa.unit || 'no informada'}` };
  }

  const alertDataDays = ALERT_DATA_DAYS[definition.id];
  if (alertDataDays) {
    const days = alertDataDays;
    const window = alertWindows.find((item) => item.days === days);
    const period = `Captura de ${days} días`;
    const source = definition.source === 'netskope' ? 'Captura de alertas Netskope' : definition.source;
    const sourceLabel = `Fuente: ${source} · Período: ${period} · Disponibilidad: ${alertWindowLabel(window)}`;
    return {
      sourceLabel,
      previewLabel: window
        ? [netskopeAlertTotalLabel(window.total), netskopeAlertAvailabilityLabel(window.availability)].filter(Boolean).join(' · ')
        : undefined,
    };
  }

  const period = INVENTORY_PERIODS[definition.id] ?? 'Período no informado';
  const observation = formattedDate(metrics?.last_observed_at);
  const availability = metrics === null
    ? 'Sin dato'
    : observation ? `Inventario observado ${observation}` : 'Fecha de observación no informada';
  const source = definition.source === 'netskope' ? 'Inventario Netskope' : definition.source;
  const sourceLabel = `Fuente: ${source} · Período: ${period} · Disponibilidad: ${availability}`;

  if (definition.id === 'users_recent_activity') {
    const value = metrics?.users_with_device_activity_7d;
    return { sourceLabel, previewLabel: typeof value === 'number' ? formatNumber(value) : undefined };
  }
  const chartField = CHART_BUCKET_FIELDS[definition.id];
  if (chartField) return { sourceLabel, previewBuckets: topBuckets(metrics?.[chartField] as NetskopeMetricBucket[] | undefined) };
  if (metrics && definition.id in metrics) {
    const value = (metrics as unknown as Record<string, unknown>)[definition.id];
    return { sourceLabel, previewLabel: typeof value === 'number' ? formatNumber(value) : undefined };
  }
  return { sourceLabel };
}
