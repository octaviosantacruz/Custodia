import { api } from '../../../cross/lib/api';
import type { NetskopeRetiredActivity, NetskopeExperienceDevices, NetskopeExperienceDetail, NetskopeExperienceScore, NetskopeExperienceWindow } from '../types/netskope';
import { EMPTY_NETSKOPE_DEVICE_QUERY, netskopeDevicesQuery, netskopeUsersQuery } from './netskope-device-filters';
import { netskopeDlpQueryString } from './netskope-dlp';
import type { NetskopeAaChart, NetskopeAaChartSummary, NetskopeAdminRoleDetail, NetskopeAdminRolesResponse, NetskopeAdminsQuery, NetskopeAdminsResponse, NetskopeAaSeverity, NetskopeAlertAggregates, NetskopeBaselines, NetskopeClientEvents, NetskopeDashboardPreferences, NetskopeDeviceChanges, NetskopeDeviceFacets, NetskopeDeviceQuery, NetskopeDeviceReviewSummary, NetskopeDlpAlerts, NetskopeDlpQuery, NetskopeDlpStatus, NetskopeDlpPolicies, NetskopeDuplicates, NetskopeFleetGroupBy, NetskopeFleetGroups, NetskopeListResponse, NetskopePostureResponse, NetskopeSelectedMetrics, NetskopeAnomalies, NetskopeAttention, NetskopeUciCompaniesResponse, NetskopeUciResponse, NetskopeUsersFilters, NetskopeWidgetFilters } from '../types/netskope';

export function fetchNetskopeExperienceDevices(userId: number, hours: 2 | 24 | 48, signal?: AbortSignal) {
  return api<NetskopeExperienceDevices>(`/cmdb/netskope/users/${userId}/experience/devices?hours=${hours}`, { signal });
}

export function fetchNetskopeExperienceScore(userId: number, hours: 2 | 24 | 48, signal?: AbortSignal) {
  return api<NetskopeExperienceScore>(`/cmdb/netskope/users/${userId}/experience/score?hours=${hours}`, { signal });
}

export function fetchNetskopeExperienceDetail(userId: number, deviceId: string, window: NetskopeExperienceWindow, signal?: AbortSignal) {
  const params = new URLSearchParams({ window_start: String(window.window_start), window_end: String(window.window_end) });
  return api<NetskopeExperienceDetail>(`/cmdb/netskope/users/${userId}/experience/devices/${encodeURIComponent(deviceId)}?${params}`, { signal });
}

export { EMPTY_NETSKOPE_DEVICE_FILTERS, NETSKOPE_PAGE_SIZE } from './netskope-device-filters';

export function fetchNetskopeUsers(search: string, page: number, filters: NetskopeUsersFilters, signal?: AbortSignal): Promise<NetskopeListResponse> {
  return api<NetskopeListResponse>(`/cmdb/netskope/users?${netskopeUsersQuery(search, page, filters)}`, { signal });
}

export function fetchNetskopeDevices(search: string, page: number, query: NetskopeDeviceQuery, signal?: AbortSignal): Promise<NetskopeListResponse> {
  return api<NetskopeListResponse>(`/cmdb/netskope/devices?${netskopeDevicesQuery(search, page, query.filters, query.eventAge, query.change, query.clientCompliance, query.osCompliance, query.duplicate, query.freshness, query.coverageRisk, query)}`, { signal });
}

/** Every inventory device linked to a user, page by page (the list is paged at NETSKOPE_PAGE_SIZE), bounded at 10 pages. */
export async function fetchNetskopeUserDevices(userId: number, signal?: AbortSignal): Promise<NetskopeListResponse> {
  const query = { ...EMPTY_NETSKOPE_DEVICE_QUERY, freshness: 'all' as const, observedUserId: userId };
  const first = await fetchNetskopeDevices('', 0, query, signal);
  const rows = [...first.rows];
  for (let page = 1; page < 10 && rows.length < first.total; page += 1) {
    const next = await fetchNetskopeDevices('', page, query, signal);
    if (!next.rows.length) break;
    rows.push(...next.rows);
  }
  return { ...first, rows };
}

export function fetchNetskopeRetiredActivity(days: 7 | 14 | 30, signal?: AbortSignal): Promise<NetskopeRetiredActivity> {
  return api<NetskopeRetiredActivity>(`/cmdb/netskope/users/retired-activity?days=${days}`, { signal });
}

export function fetchNetskopeDeviceFacets(signal?: AbortSignal): Promise<NetskopeDeviceFacets> {
  return api<NetskopeDeviceFacets>('/cmdb/netskope/devices/facets', { signal });
}

export function fetchNetskopeDeviceChanges(signal?: AbortSignal): Promise<NetskopeDeviceChanges> {
  return api<NetskopeDeviceChanges>('/cmdb/netskope/devices/changes', { signal });
}

/* VIS-NSK-HIST-001: allowlisted snapshots of one device, newest first. */
export function fetchNetskopeClientEvents(signal?: AbortSignal): Promise<NetskopeClientEvents> {
  return api<NetskopeClientEvents>('/cmdb/netskope/devices/client-events', { signal });
}

export function fetchNetskopeMetrics(filters?: NetskopeWidgetFilters, signal?: AbortSignal, widgets?: readonly string[]): Promise<NetskopeSelectedMetrics> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value) params.set(key, value);
  }
  for (const widget of widgets ?? []) params.append('widgets', widget);
  const query = params.toString();
  return api<NetskopeSelectedMetrics>(`/cmdb/netskope/metrics${query ? `?${query}` : ''}`, { signal });
}

export function fetchNetskopeAlertAggregates(signal?: AbortSignal): Promise<NetskopeAlertAggregates> {
  return api<NetskopeAlertAggregates>('/cmdb/netskope/alerts', { signal });
}

/* NSK-UBA-002: strict route (netskope:uba_read); one page covers every rated user. */
export const NETSKOPE_UCI_LIMIT = 500;
export function fetchNetskopeUci(signal?: AbortSignal): Promise<NetskopeUciResponse> {
  return api<NetskopeUciResponse>(`/cmdb/netskope/uci?limit=${NETSKOPE_UCI_LIMIT}`, { signal });
}

export function fetchNetskopeUciCompanies(signal?: AbortSignal): Promise<NetskopeUciCompaniesResponse> {
  return api<NetskopeUciCompaniesResponse>('/cmdb/netskope/uci/companies', { signal });
}

export function fetchNetskopeUserAnomalies(userId: number, signal?: AbortSignal): Promise<NetskopeAnomalies> {
  return api<NetskopeAnomalies>(`/cmdb/netskope/users/${userId}/anomalies`, { signal });
}

export function fetchNetskopeAttention(signal?: AbortSignal): Promise<NetskopeAttention> {
  return api<NetskopeAttention>('/cmdb/netskope/experience/attention', { signal });
}

/* NSK-POSTURE-001: one read carries every check with its bounded sample. */
export function fetchNetskopePosture(signal?: AbortSignal): Promise<NetskopePostureResponse> {
  return api<NetskopePostureResponse>('/cmdb/netskope/posture', { signal });
}

/* NSK-EXP-ONPREM-001: counts only; one read carries the whole macro view. */
export function fetchNetskopeDashboardPreferences(signal?: AbortSignal): Promise<NetskopeDashboardPreferences> {
  return api<NetskopeDashboardPreferences>('/dashboard/netskope/preferences', { signal });
}

export function saveNetskopeDashboardPreferences(
  widgets: NetskopeDashboardPreferences['widgets'],
): Promise<NetskopeDashboardPreferences> {
  return api<NetskopeDashboardPreferences>('/dashboard/netskope/preferences', {
    method: 'PUT',
    body: JSON.stringify({ widgets }),
  });
}

export function fetchNetskopeFleetGroups(groupBy: NetskopeFleetGroupBy, signal?: AbortSignal): Promise<NetskopeFleetGroups> {
  return api<NetskopeFleetGroups>(`/cmdb/netskope/devices/fleet-groups?group_by=${encodeURIComponent(groupBy)}`, { signal });
}

export function fetchNetskopeBaselines(): Promise<NetskopeBaselines> {
  return api<NetskopeBaselines>('/netskope/baselines');
}

export function saveNetskopeGoldenReleases(releases: string[], note: string) {
  return api('/netskope/baselines/client-golden-releases', { method: 'PUT', body: JSON.stringify({ releases, note: note || null }) });
}

export function saveNetskopeOsMinimums(minimums: Record<string, string>, note: string) {
  return api('/netskope/baselines/os-minimum-versions', { method: 'PUT', body: JSON.stringify({ minimums, note: note || null }) });
}

export function fetchNetskopeDuplicates(signal?: AbortSignal): Promise<NetskopeDuplicates> {
  return api<NetskopeDuplicates>('/cmdb/netskope/devices/duplicates?freshness=all', { signal });
}

/* NSK-DLP-001: read-only minimal DLP alerts. Every route requires
   netskope:dlp_read; no response carries file/content/URL/hash/IP. */
export function fetchNetskopeDlpPolicies(signal?: AbortSignal): Promise<NetskopeDlpPolicies> {
  return api<NetskopeDlpPolicies>('/cmdb/netskope/dlp/policies', { signal });
}

export function fetchNetskopeDlpStatus(signal?: AbortSignal): Promise<NetskopeDlpStatus> {
  return api<NetskopeDlpStatus>('/cmdb/netskope/dlp/status', { signal });
}

export function fetchNetskopeDlpAlerts(query: NetskopeDlpQuery, offset: number, limit: number, signal?: AbortSignal): Promise<NetskopeDlpAlerts> {
  return api<NetskopeDlpAlerts>(`/cmdb/netskope/investigations?${netskopeDlpQueryString(query, offset, limit)}`, { signal });
}


export function fetchNetskopeAaCharts(signal?: AbortSignal): Promise<NetskopeAaChartSummary[]> {
  return api<NetskopeAaChartSummary[]>('/cmdb/netskope/aa/charts', { signal });
}

export function fetchNetskopeAaChart(key: string, signal?: AbortSignal): Promise<NetskopeAaChart> {
  return api<NetskopeAaChart>(`/cmdb/netskope/aa/charts/${encodeURIComponent(key)}`, { signal });
}

export function fetchNetskopeAaSeverity(signal?: AbortSignal): Promise<NetskopeAaSeverity> {
  return api<NetskopeAaSeverity>('/cmdb/netskope/aa/severity', { signal });
}

/* NSK-INV-002: the stale devices grouped by what Netskope explains (Postura). */
export function fetchNetskopeDeviceReviewSummary(signal?: AbortSignal): Promise<NetskopeDeviceReviewSummary> {
  return api<NetskopeDeviceReviewSummary>('/cmdb/netskope/device-reviews/summary', { signal });
}

/* NSK-RBAC-001: strict routes (netskope:admin_inventory_read). The list pages on the server. */
export const NETSKOPE_ADMINS_PAGE_SIZE = 50;
export function fetchNetskopeAdmins(query: NetskopeAdminsQuery, signal?: AbortSignal): Promise<NetskopeAdminsResponse> {
  const params = new URLSearchParams({ limit: String(NETSKOPE_ADMINS_PAGE_SIZE), offset: String(query.page * NETSKOPE_ADMINS_PAGE_SIZE) });
  if (query.search.trim()) params.set('search', query.search.trim());
  if (query.recordType) params.set('record_type', query.recordType);
  if (query.state) params.set('state', query.state);
  if (query.role) params.set('role', query.role);
  return api<NetskopeAdminsResponse>(`/cmdb/netskope/admins?${params}`, { signal });
}

export function fetchNetskopeAdminRoles(signal?: AbortSignal): Promise<NetskopeAdminRolesResponse> {
  return api<NetskopeAdminRolesResponse>('/cmdb/netskope/admin-roles', { signal });
}

export function fetchNetskopeAdminRole(roleId: string, signal?: AbortSignal): Promise<NetskopeAdminRoleDetail> {
  return api<NetskopeAdminRoleDetail>(`/cmdb/netskope/admin-roles/${encodeURIComponent(roleId)}`, { signal });
}
