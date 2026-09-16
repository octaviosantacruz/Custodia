import { api } from './api';

export type ActivityEvent = {
  event_id: number;
  kind: 'sync' | 'import' | 'classification';
  actor_id: string;
  actor_name: string;
  created_at: string;
};

export async function listActivityEvents(since: number): Promise<{ rows: ActivityEvent[] }> {
  return api<{ rows: ActivityEvent[] }>('/events?since=' + encodeURIComponent(String(since)));
}
