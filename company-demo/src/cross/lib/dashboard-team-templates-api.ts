import { api } from './api';

export type DashboardTeamTemplate<T> = {
  role_code: string;
  role_name: string;
  version: number;
  widgets: T[];
  published_at: string;
};

export function fetchDashboardTeamTemplates<T>(source: 'cyberark' | 'netskope', signal?: AbortSignal): Promise<{ templates: DashboardTeamTemplate<T>[] }> {
  const prefix = source === 'netskope' ? '/dashboard/netskope' : '/dashboard';
  return api(`${prefix}/preferences/templates`, { signal });
}

export function publishDashboardTeamTemplate<T>(source: 'cyberark' | 'netskope', roleCode: string, widgets: T[]): Promise<DashboardTeamTemplate<T>> {
  const prefix = source === 'netskope' ? '/dashboard/netskope' : '/dashboard';
  return api(`${prefix}/preferences/templates/${encodeURIComponent(roleCode)}`, {
    method: 'PUT', body: JSON.stringify({ widgets }),
  });
}
