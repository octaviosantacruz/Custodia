import { api } from './api';
import type { DashboardWidget } from './dashboard-metrics';

export type DashboardPreferences = { widgets: DashboardWidget[]; is_default: boolean };

export function fetchDashboardPreferences(includeInternal = true): Promise<DashboardPreferences> {
  return api<DashboardPreferences>(`/dashboard/preferences?include_internal=${includeInternal}`);
}

function toPayload(widgets: DashboardWidget[]) {
  return widgets.map(({ value: _value, buckets: _buckets, chart_data: _chartData, ...widget }) => widget);
}

export function saveDashboardPreferences(widgets: DashboardWidget[], includeInternal = true): Promise<DashboardPreferences> {
  return api<DashboardPreferences>(`/dashboard/preferences?include_internal=${includeInternal}`, {
    method: 'PUT',
    body: JSON.stringify({ widgets: toPayload(widgets) }),
  });
}

export function previewDashboardWidget(widget: DashboardWidget, signal?: AbortSignal, includeInternal = true): Promise<{ widgets: DashboardWidget[] }> {
  return api<{ widgets: DashboardWidget[] }>(`/dashboard/preferences/preview?include_internal=${includeInternal}`, {
    method: 'POST',
    body: JSON.stringify({ widgets: toPayload([widget]) }),
    signal,
  });
}
