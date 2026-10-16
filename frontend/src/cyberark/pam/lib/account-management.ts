import type { AccountManagementStatus } from '../types/safe';

export function automaticManagementLabel(value: boolean | null | undefined): string {
  if (value === true) return 'Activada';
  if (value === false) return 'Deshabilitada';
  return 'Sin dato';
}

export function managementStatusLabel(value: AccountManagementStatus | null | undefined): string {
  if (value === 'success') return 'Correcto';
  if (value === 'failure') return 'Falló';
  if (value === 'in_process') return 'En proceso';
  return 'Sin estado';
}
