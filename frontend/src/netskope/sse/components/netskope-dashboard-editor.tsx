import { useEffect, useState } from 'react';
import { Activity, BarChart3, CircleGauge, MonitorSmartphone, ShieldAlert, UserRound, UserRoundCheck, UserRoundX, UsersRound } from 'lucide-react';
import { CompactSelect } from '../../../cross/components/compact-select';
import { DashboardEditItem } from '../../../cross/components/dashboard-edit-item';
import { DashboardWidgetPicker, type DashboardPickerGroup } from '../../../cross/components/dashboard-widget-picker';
import { formatNumber } from '../../../cross/lib/format';
import type { ChartMode } from '../../../cross/lib/chart-mode';
import { netskopeChartHasMode, netskopeChartMode, netskopeDefaultChartMode, netskopeWidgetDefinition, type NetskopeWidgetDefinition } from '../lib/netskope-dashboard';
import { groupNetskopeWidgetDefinitions, netskopeWidgetPickerDetails, topBuckets as topAaBuckets } from '../lib/netskope-dashboard-picker';
import type { NetskopeAlertWindow, NetskopeDeviceFacets, NetskopeMetricBucket, NetskopeSelectedMetrics as NetskopeMetrics, NetskopeWidgetFilterKey, NetskopeWidgetFilters, NetskopeWidgetInstance, NetskopeWidgetSize } from '../types/netskope';
import '../../../cross/components/dashboard-widget.css';

const FILTER_ALL_LABELS: Record<NetskopeWidgetFilterKey, string> = {
  os: 'Todos los SO',
  company: 'Todas las empresas',
  classification_status: 'Todas las clasificaciones',
};
const FILTER_LABELS: Record<NetskopeWidgetFilterKey, string> = {
  os: 'Sistema operativo',
  company: 'Empresa',
  classification_status: 'Clasificación',
};
const FILTER_ARIA_LABELS: Record<NetskopeWidgetFilterKey, string> = {
  os: 'Filtrar widget por sistema operativo',
  company: 'Filtrar widget por empresa',
  classification_status: 'Filtrar widget por clasificación',
};

function filterOptions(key: NetskopeWidgetFilterKey, facets: NetskopeDeviceFacets | null, selected: string) {
  const buckets = facets?.[key] || [];
  const options = [
    { value: '', label: FILTER_ALL_LABELS[key] },
    ...buckets.map((bucket) => ({ value: bucket.key, label: `${bucket.key} · ${formatNumber(bucket.count)}` })),
  ];
  if (selected && !buckets.some((bucket) => bucket.key === selected)) options.push({ value: selected, label: selected });
  return options;
}

export function NetskopeEditableItem({ instance, index, count, saving, facets, style, onMove, onMoveBefore, onSize, onRemove, onFilters, onStyle, onAnnounce, children }: {
  instance: NetskopeWidgetInstance;
  index: number;
  count: number;
  saving: boolean;
  facets: NetskopeDeviceFacets | null;
  /** Grid cell from the shared dashboard layout (charts only). */
  style?: React.CSSProperties;
  onMove: (id: NetskopeWidgetInstance['id'], direction: -1 | 1) => void;
  onMoveBefore: (draggedId: NetskopeWidgetInstance['id'], targetId: NetskopeWidgetInstance['id']) => void;
  onSize: (id: NetskopeWidgetInstance['id'], size: NetskopeWidgetSize) => void;
  onRemove: (id: NetskopeWidgetInstance['id']) => void;
  onFilters: (id: NetskopeWidgetInstance['id'], filters: NetskopeWidgetFilters) => void;
  onStyle: (id: NetskopeWidgetInstance['id'], mode: ChartMode) => void;
  onAnnounce: (message: string) => void;
  children: React.ReactNode;
}) {
  const definition = netskopeWidgetDefinition(instance.id);
  const title = definition?.title ?? instance.id;
  const filters = instance.filters ?? {};
  return <DashboardEditItem
    id={instance.id}
    title={title}
    index={index}
    count={count}
    size={instance.size}
    style={style}
    saving={saving}
    onMove={(id, direction) => onMove(id as NetskopeWidgetInstance['id'], direction)}
    onMoveBefore={(draggedId, targetId) => onMoveBefore(draggedId as NetskopeWidgetInstance['id'], targetId as NetskopeWidgetInstance['id'])}
    onSize={(id, size) => onSize(id as NetskopeWidgetInstance['id'], size)}
    onRemove={(id) => onRemove(id as NetskopeWidgetInstance['id'])}
    onAnnounce={onAnnounce}
    mode={netskopeChartHasMode(instance.id) ? netskopeChartMode(instance) : undefined}
    onMode={(mode) => onStyle(instance.id, mode)}
    settings={definition?.filterKeys.length ? <section><h4>Filtros</h4><div className="netskope-widget-filters">
      {definition.filterKeys.map((key) => <label key={key}><span>{FILTER_LABELS[key]}</span><CompactSelect className="netskope-widget-filter" ariaLabel={FILTER_ARIA_LABELS[key]} value={filters[key] ?? ''} onChange={(value) => onFilters(instance.id, { ...filters, [key]: value })} options={filterOptions(key, facets, filters[key] ?? '')} /></label>)}
    </div></section> : undefined}
  >{children}</DashboardEditItem>;
}

const NETSKOPE_RECOMMENDED_IDS = new Set(['devices_total', 'devices_stale_30d', 'fleet_signal_24h', 'devices_by_os', 'devices_by_classification']);

export function NetskopeAddWidget({ kind, definitions, addedIds, disabled, limitReached, openRequest, metrics, alertWindows, aaPreviews, onAdd, onVisibleOptionsChange, activityChecked = true }: {
  kind: 'data' | 'chart';
  definitions: ReadonlyArray<NetskopeWidgetDefinition>;
  addedIds: readonly string[];
  disabled: boolean;
  limitReached?: boolean;
  openRequest?: number;
  /** Already-loaded metrics/alert aggregates, so each option can preview its
   * real current data instead of a generic placeholder. */
  metrics: NetskopeMetrics | null;
  alertWindows: readonly NetskopeAlertWindow[];
  onAdd: (id: NetskopeWidgetDefinition['id']) => void;
  onVisibleOptionsChange?: (ids: string[]) => void;
  /** Real buckets of the tenant's Advanced Analytics charts that the dialog is showing. */
  aaPreviews?: Record<string, NetskopeMetricBucket[]>;
  activityChecked?: boolean;
}) {
  const recentActivitySupported = typeof metrics?.users_with_device_activity_7d === 'number'
    && typeof metrics?.users_with_device_activity_14d === 'number'
    && typeof metrics?.users_with_device_activity_30d === 'number';
  const [activitySupported, setActivitySupported] = useState<boolean | null>(null);
  useEffect(() => {
    if (recentActivitySupported) setActivitySupported(true);
    else if (activityChecked && metrics) setActivitySupported(false);
  }, [recentActivitySupported, activityChecked, metrics]);
  if (!definitions.length) return null;
  const supportedDefinitions = activitySupported === false
    ? definitions.filter((definition) => definition.id !== 'users_recent_activity')
    : definitions;
  const groups: DashboardPickerGroup[] = groupNetskopeWidgetDefinitions(supportedDefinitions).map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    icon: group.id === 'alerts' ? <ShieldAlert size={20} aria-hidden="true" /> : group.id === 'inventory' ? <CircleGauge size={20} aria-hidden="true" /> : <UsersRound size={20} aria-hidden="true" />,
    options: group.options.map((option) => {
      const previewKind = kind === 'data' ? 'number' : option.id.includes('severity') ? 'donut' : netskopeDefaultChartMode(option.id) === 'donut' ? 'donut' : 'bars';
      const details = netskopeWidgetPickerDetails(option, metrics, alertWindows);
      return {
        id: option.id,
        title: option.title,
        description: option.description,
        sourceLabel: details.sourceLabel,
        previewIcon: option.id.startsWith('alerts') ? <ShieldAlert size={23} aria-hidden="true" /> : option.id === 'devices_with_observed_user' ? <UserRound size={23} aria-hidden="true" /> : option.id === 'devices_observed_user_matched' ? <UserRoundCheck size={23} aria-hidden="true" /> : option.id === 'devices_observed_user_unmatched' ? <UserRoundX size={23} aria-hidden="true" /> : option.id === 'devices_total' ? <MonitorSmartphone size={23} aria-hidden="true" /> : option.id.startsWith('users') ? <UsersRound size={23} aria-hidden="true" /> : option.id === 'devices_stale_30d' ? <Activity size={23} aria-hidden="true" /> : kind === 'chart' ? <BarChart3 size={23} aria-hidden="true" /> : <CircleGauge size={23} aria-hidden="true" />,
        previewKind,
        previewLabel: details.previewLabel,
        previewBuckets: details.previewBuckets ?? topAaBuckets(aaPreviews?.[option.id]),
        visualization: previewKind === 'number' ? 'Indicador' : previewKind === 'donut' ? 'Dona' : 'Barras',
        added: addedIds.includes(option.id),
        recommended: NETSKOPE_RECOMMENDED_IDS.has(option.id),
        unavailable: details.unavailable,
      };
    }),
  }));
  return <DashboardWidgetPicker
    kind={kind}
    eyebrow={kind === 'data' ? 'DATOS CLAVE' : 'INVENTARIO Y POSTURA'}
    heading={kind === 'data' ? 'Elegí un dato para tu tablero' : 'Elegí un gráfico para tu tablero'}
    helper={kind === 'data' ? 'Indicadores rápidos para saber qué está pasando ahora.' : 'Comparaciones visuales para encontrar patrones y desvíos.'}
    groups={groups}
    disabled={disabled}
    limitReached={limitReached}
    openRequest={openRequest}
    onVisibleOptionsChange={onVisibleOptionsChange}
    onAdd={(id) => onAdd(id as NetskopeWidgetDefinition['id'])}
  />;
}
