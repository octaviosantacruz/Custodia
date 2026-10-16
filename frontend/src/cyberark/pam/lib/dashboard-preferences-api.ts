import { api } from '../../../cross/lib/api';
import { toDashboardPreferencePayload, type DashboardWidget } from './dashboard-metrics';

export type DashboardPreferences = { widgets: DashboardWidget[]; is_default: boolean };

export function fetchDashboardPreferences(includeInternal = true): Promise<DashboardPreferences> {
  return api<DashboardPreferences>(`/dashboard/preferences?include_internal=${includeInternal}`);
}

export function saveDashboardPreferences(widgets: DashboardWidget[], includeInternal = true): Promise<DashboardPreferences> {
  return api<DashboardPreferences>(`/dashboard/preferences?include_internal=${includeInternal}`, {
    method: 'PUT',
    body: JSON.stringify({ widgets: toDashboardPreferencePayload(widgets) }),
  });
}

/** The preview route accepts up to 6 data widgets and 6 charts per call
 * (same cap as a saved view), so a caller previewing more than one kind at
 * once must chunk into homogeneous-kind batches itself. */
export function previewDashboardWidgets(widgets: DashboardWidget[], signal?: AbortSignal, includeInternal = true): Promise<{ widgets: DashboardWidget[] }> {
  return api<{ widgets: DashboardWidget[] }>(`/dashboard/preferences/preview?include_internal=${includeInternal}`, {
    method: 'POST',
    body: JSON.stringify({ widgets: toDashboardPreferencePayload(widgets) }),
    signal,
  });
}

export function previewDashboardWidget(widget: DashboardWidget, signal?: AbortSignal, includeInternal = true): Promise<{ widgets: DashboardWidget[] }> {
  return previewDashboardWidgets([widget], signal, includeInternal);
}
