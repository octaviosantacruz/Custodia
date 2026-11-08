import type { AuthStatus } from '../types/auth';
import { t } from '../i18n/index.ts';

export function primaryRoleLabel(authStatus: AuthStatus): string {
  const roleCode = authStatus.user?.roles?.[0];
  if (authStatus.user?.role_names?.[0]) return authStatus.user.role_names[0];
  if (roleCode === 'admin') return t('Administrador de plataforma');
  if (roleCode === 'operator') return t('Operador de plataforma');
  if (roleCode === 'reader') return t('Lector de plataforma');
  return roleCode || 'Sin rol asignado';
}
