import { api } from './api';

export type OperationalLogEntry = {
  log_id: number;
  occurred_at: string;
  level: 'info' | 'warning' | 'error';
  source_system: string;
  event: string;
  message: string;
  run_id: string | null;
  metadata: Record<string, unknown>;
};

export function listOperationalLogs(page: number, pageSize: number, q: string, level: string, source: string): Promise<{ rows: OperationalLogEntry[]; total: number }> {
  return api(`/operational-logs?limit=${pageSize}&offset=${page * pageSize}&q=${encodeURIComponent(q)}&level=${encodeURIComponent(level)}&source_system=${encodeURIComponent(source)}`);
}
