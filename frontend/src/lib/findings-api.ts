import { api } from './api';
import type { Finding, FindingListResponse, FindingSeverity, FindingStatus } from '../types/findings';

export const FINDING_PAGE_SIZE = 50;

export type FindingFilters = { status: FindingStatus | ''; ruleId: string; severity: FindingSeverity | ''; page: number; limit?: number; includeInternal?: boolean };

export async function fetchFindings(filters: FindingFilters): Promise<FindingListResponse> {
  const params = new URLSearchParams({ limit: String(filters.limit || FINDING_PAGE_SIZE), offset: String(filters.page * FINDING_PAGE_SIZE) });
  if (filters.status) params.set('status', filters.status);
  if (filters.ruleId) params.set('rule_id', filters.ruleId);
  if (filters.severity) params.set('severity', filters.severity);
  params.set('include_internal', String(filters.includeInternal !== false));
  return api<FindingListResponse>(`/findings?${params.toString()}`);
}

export async function updateFinding(findingId: number, payload: { status: FindingStatus; exception_reason?: string | null; exception_until?: string | null }): Promise<Finding> {
  return api<Finding>(`/findings/${findingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function refreshFindings(): Promise<{ status: string; current_findings: number }> {
  return api<{ status: string; current_findings: number }>('/findings/refresh', { method: 'POST' });
}
