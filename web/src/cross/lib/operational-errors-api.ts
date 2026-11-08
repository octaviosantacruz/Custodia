import { api } from './api';

export type OperationalErrorEntry = {
  event_id: number;
  occurred_at: string;
  request_id: string;
  method: string;
  path: string;
  error_kind: string;
  status_code: number;
  metadata: Record<string, unknown>;
};

export function listOperationalErrors(page: number, pageSize: number, q: string): Promise<{ rows: OperationalErrorEntry[]; total: number }> {
  return api(`/operational-errors?limit=${pageSize}&offset=${page * pageSize}&q=${encodeURIComponent(q)}`);
}
