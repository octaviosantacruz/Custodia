import { api, download } from './api';

export type ActivityEntry = {
  audit_id: number;
  actor_id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};

export type ActivityFilters = { page: number; pageSize: number; action: string; entityType: string; q: string };

export async function listActivity(filters: ActivityFilters): Promise<{ rows: ActivityEntry[]; total: number }> {
  const query = '/activity?limit=' + filters.pageSize + '&offset=' + (filters.page * filters.pageSize)
    + '&action=' + encodeURIComponent(filters.action)
    + '&entity_type=' + encodeURIComponent(filters.entityType)
    + '&q=' + encodeURIComponent(filters.q);
  return api<{ rows: ActivityEntry[]; total: number }>(query);
}

export function exportActivity(filters: Pick<ActivityFilters, 'action' | 'entityType' | 'q'>): Promise<void> {
  const query = '/activity/export.csv?action=' + encodeURIComponent(filters.action)
    + '&entity_type=' + encodeURIComponent(filters.entityType)
    + '&q=' + encodeURIComponent(filters.q);
  return download(query, 'dshub-actividad.csv');
}
