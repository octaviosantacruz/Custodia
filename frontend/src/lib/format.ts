import type { ClassificationStatus, WorkflowStatus } from '../types/safe';

export const formatNumber = (value: number) => new Intl.NumberFormat('es-AR').format(value || 0);

export const resultCountLabel = (count: number) => `${formatNumber(count)} ${count === 1 ? 'resultado' : 'resultados'}`;

export const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : 'Sin dato';

export const relativeTime = (value: string | null) => {
  if (!value) return 'Sin fecha';
  const elapsed = Date.now() - new Date(value).getTime();
  if (Number.isNaN(elapsed)) return 'Sin fecha';
  const minutes = Math.round(Math.abs(elapsed) / 60000);
  if (minutes < 1) return 'Hace instantes';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `Hace ${days} d`;
  const months = Math.round(days / 30);
  if (months < 12) return `Hace ${months} mes${months === 1 ? '' : 'es'}`;
  return `Hace ${Math.round(months / 12)} a`;
};

export const statusLabel = (value: ClassificationStatus) =>
  ({ pending: 'Pendiente', assigned: 'Asignada', review: 'Revisión' })[value];

export const inventoryScopeLabel = (value: string) =>
  ({ pending: 'Pendiente de definir', business: 'Safe de negocio', internal: 'Interno CyberArk' } as Record<string, string>)[value] || value;

export const qualityStatusLabel = (value: string) =>
  ({ pending: 'Pendiente', clean: 'Depurado', obsolete: 'Obsoleto', duplicate: 'Duplicado' } as Record<string, string>)[value] || value;

export function businessUnitLabel(unit: { unit_code: string; unit_name: string }): string {
  const code = unit.unit_code.trim();
  const name = unit.unit_name.trim();
  if (!code) return name;
  if (!name || code.localeCompare(name, undefined, { sensitivity: 'base' }) === 0) return code;
  return `${code} - ${name}`;
}

// Estados operativos que se ofrecen para el trabajo diario. Los valores
// históricos siguen siendo legibles para no ocultar datos ya guardados.
export const WORKFLOW_STATUSES: WorkflowStatus[] = ['pending', 'in_progress', 'resolved'];

export const workflowStatusesFor = (current?: WorkflowStatus): WorkflowStatus[] =>
  current && !WORKFLOW_STATUSES.includes(current) ? [...WORKFLOW_STATUSES, current] : WORKFLOW_STATUSES;

const ALL_WORKFLOW_STATUSES: WorkflowStatus[] = ['pending', 'in_progress', 'blocked', 'resolved', 'retired'];

export function workflowStatusesFromCounts(
  buckets: { key: string; count: number }[],
  current: WorkflowStatus | '' = '',
): WorkflowStatus[] {
  const observed = new Set(buckets.filter((bucket) => bucket.count > 0).map((bucket) => bucket.key));
  if (current) observed.add(current);
  return ALL_WORKFLOW_STATUSES.filter((status) => observed.has(status));
}

export const siaPolicyStatusLabel = (value: string) =>
  ({ Enabled: 'Habilitada', Disabled: 'Deshabilitada' } as Record<string, string>)[value] || value || 'Sin dato';

export const workflowLabel = (value: WorkflowStatus) =>
  ({
    pending: 'Pendiente',
    in_progress: 'En curso',
    blocked: 'Bloqueada',
    resolved: 'Resuelto',
    retired: 'Retirada',
  })[value];

export const nextActionOptions = ['Migrar a SIA', 'Consultar', 'Revisar', 'Dar de baja', 'Rotar credencial'];

const actionLabels: Record<string, string> = {
  "migrar a sia": "Migrar a SIA",
  "migrar sia": "Migrar a SIA",
  "consultar": "Consultar",
  "revisar": "Revisar",
  "dar de baja": "Dar de baja",
  "revisar / dar de baja": "Revisar",
  "revisar/dar de baja": "Revisar",
  "rotar credencial": "Rotar credencial",
  "sin definir": "Sin definir",
  "sin clasificar": "Sin clasificar",
};

export const actionLabel = (value: string | null | undefined) => {
  const normalized = (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return actionLabels[normalized] || (value || 'Sin definir').trim() || 'Sin definir';
};

export const bucketLabel = (value: string) => {
  const workflow = ({ pending: 'Pendiente', in_progress: 'En curso', blocked: 'Bloqueada', resolved: 'Resuelto', retired: 'Retirada' } as Record<string, string>)[value];
  return workflow || actionLabel(value.replace(/_/g, ' '));
};
