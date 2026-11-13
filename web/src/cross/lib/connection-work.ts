import type { WorkStatus } from '../types/connection';
import { t } from '../i18n/index.ts';

export const WORK_STATUSES: { value: WorkStatus; label: string; tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning' }[] = [
  { value: 'pending', label: t('Pendiente'), tone: 'neutral' },
  { value: 'in_progress', label: 'En curso', tone: 'warning' },
  { value: 'onboarded', label: 'Incorporado', tone: 'success' },
  { value: 'blocked', label: 'Bloqueado', tone: 'danger' },
  { value: 'not_applicable', label: t('No aplica'), tone: 'neutral' },
];

const BY_VALUE = Object.fromEntries(WORK_STATUSES.map((item) => [item.value, item]));

export function workLabel(value: WorkStatus): string {
  return BY_VALUE[value]?.label ?? value;
}

export function workTone(value: WorkStatus) {
  return BY_VALUE[value]?.tone ?? 'neutral';
}

/** Spanish label or code of a work state, as a sheet may carry it; null when the cell is empty. */
export function parseWorkStatus(text: string): WorkStatus | null {
  const normalized = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const found = WORK_STATUSES.find((item) => item.value.replace(/_/g, ' ') === normalized || item.label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() === normalized);
  if (!found) throw new Error(`Estado de trabajo no reconocido: "${text}"`);
  return found.value;
}

const FIELD_LABELS: Record<string, string> = {
  instance_name: 'Instancia', environment: 'Ambiente', private_ip: 'IP', port: 'Puerto', ca_sia: 'Platform', ca_dba: 'DBA',
  zsp_implemented: 'ZSP', access_available: 'Acceso', description: t('Descripción'), lifecycle_status: 'Estado',
  work_status: 'Trabajo', responsible: 'Responsable', note: 'Nota',
};

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return t('vacío');
  if (typeof value === 'boolean') return value ? t('Sí') : 'No';
  if (field === 'work_status') return workLabel(value as WorkStatus);
  if (field === 'lifecycle_status') return value === 'retired' ? t('Retirado') : t('Activo');
  return String(value);
}

/** One audit event as short sentences: "Trabajo: Pendiente → En curso". */
export function describeChange(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  return Object.keys(after ?? {}).map((field) => `${FIELD_LABELS[field] ?? field}: ${before && field in before ? `${show(field, before[field])} → ` : ''}${show(field, (after as Record<string, unknown>)[field])}`);
}
