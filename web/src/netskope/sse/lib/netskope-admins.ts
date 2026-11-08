import type { NetskopeAdminRow, NetskopeAdminsQuery } from '../types/netskope';

export const ADMINS_TITLE = 'Administradores de Netskope';

export const ADMIN_STATE_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
] as const;

export const ADMIN_KIND_OPTIONS = [
  { value: '', label: 'Todos los tipos' },
  { value: 'USER', label: 'Personas' },
  { value: 'SERVICE_ACCOUNT', label: 'Cuentas de servicio' },
] as const;

export const ADMIN_ROLE_OPTIONS = [
  { value: '', label: 'Con o sin rol' },
  { value: 'none', label: 'Sin rol' },
] as const;

export const EMPTY_ADMINS_QUERY: NetskopeAdminsQuery = { search: '', recordType: '', state: '', role: '', page: 0 };

/** Levels Netskope assigns to an API group; an unknown value is shown as received. */
const PERMISSION_LABELS: Record<string, string> = { r: 'Lectura', rw: 'Escritura', rwa: 'Administración' };
export function permissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] ?? permission;
}
export function permissionTone(permission: string): 'read' | 'write' | 'admin' | 'other' {
  return permission === 'r' ? 'read' : permission === 'rw' ? 'write' : permission === 'rwa' ? 'admin' : 'other';
}

export function adminKindLabel(recordType: string | null): string {
  return recordType === 'SERVICE_ACCOUNT' ? 'Cuenta de servicio' : recordType === 'USER' ? 'Persona' : 'Sin dato';
}

export type AdminStateTone = 'ok' | 'off' | 'locked';
export function adminState(row: Pick<NetskopeAdminRow, 'active' | 'is_locked'>): { label: string; tone: AdminStateTone } {
  if (row.is_locked) return { label: 'Bloqueado', tone: 'locked' };
  return row.active ? { label: 'Activo', tone: 'ok' } : { label: 'Inactivo', tone: 'off' };
}

/** MFA only applies to people: a service account authenticates with its key. */
export function adminMfaLabel(row: Pick<NetskopeAdminRow, 'record_type' | 'mfa_enabled'>): string {
  if (row.record_type === 'SERVICE_ACCOUNT') return '—';
  return row.mfa_enabled === null ? 'Sin dato' : row.mfa_enabled ? 'Sí' : 'No';
}

export function hasAdminFilters(query: NetskopeAdminsQuery): boolean {
  return Boolean(query.search.trim() || query.recordType || query.state || query.role);
}
