import type { ClassificationStatus, WorkflowStatus } from '../types/safe';
import { t } from '../../../cross/i18n/index.ts';

export const statusLabel = (value: ClassificationStatus) =>
  ({ pending: t('Pendiente'), assigned: t('Asignada'), review: t('Revisión') })[value];

// Daily Safe workflow choices remain limited to these three statuses;
// historical statuses remain readable and filterable when already present.
export const WORKFLOW_STATUSES: WorkflowStatus[] = ['pending', 'in_progress', 'retention_hold', 'resolved'];

export const workflowStatusesFor = (current?: WorkflowStatus): WorkflowStatus[] =>
  current && !WORKFLOW_STATUSES.includes(current) ? [...WORKFLOW_STATUSES, current] : WORKFLOW_STATUSES;

const ALL_WORKFLOW_STATUSES: WorkflowStatus[] = ['pending', 'in_progress', 'blocked', 'retention_hold', 'resolved', 'retired'];

export function workflowStatusesFromCounts(
  buckets: { key: string; count: number }[],
  current: WorkflowStatus | '' = '',
): WorkflowStatus[] {
  const observed = new Set(buckets.filter((bucket) => bucket.count > 0).map((bucket) => bucket.key));
  if (current) observed.add(current);
  return ALL_WORKFLOW_STATUSES.filter((status) => observed.has(status));
}

export const workflowLabel = (value: WorkflowStatus) =>
  ({
    pending: t('Pendiente'),
    in_progress: t('En curso'),
    blocked: t('Bloqueada'),
    resolved: t('Resuelto'),
    retired: t('Retirada'),
    retention_hold: t('Baja retenida'),
  })[value];

/** Retention CyberArk reports for a Safe, as shown next to a decommission in
 *  progress. Describes configuration only; it is not a deletion date. */
export function retentionLabel(days?: number | null, versions?: number | null): string {
  const parts = [
    days != null ? `${days} ${days === 1 ? t('día') : t('días')}` : '',
    versions != null ? `${versions} ${versions === 1 ? t('versión') : 'versiones'}` : '',
  ].filter(Boolean);
  return parts.length ? `Retención: ${parts.join(' / ')}` : 'Retención no informada';
}

/** A decommission is blocked by CyberArk's retention when accounts were deleted but the Safe is still there. */
export const showsRetiredAccounts = (safe: { workflow_status: string; next_action: string | null; retired_account_count?: number }): boolean =>
  (safe.retired_account_count ?? 0) > 0 && (safe.workflow_status === 'retention_hold' || (safe.next_action || '').trim().toLowerCase() === 'dar de baja');

export const retiredAccountsLabel = (count: number, detectedAt: string | null | undefined, format: (value: string | null) => string): string =>
  `${count} ${count === 1 ? t('cuenta retirada') : t('cuentas retiradas')}${detectedAt ? ` · detectada ${format(detectedAt)}` : ''}`;
