import type { AuthStatus } from '../types/auth';

export function primaryRoleLabel(authStatus: AuthStatus): string {
  const roleCode = authStatus.user?.roles?.[0];
  if (authStatus.user?.role_names?.[0]) return authStatus.user.role_names[0];
  if (roleCode === 'admin') return 'Administrador de plataforma';
  if (roleCode === 'operator') return 'Operador de plataforma';
  if (roleCode === 'reader') return 'Lector de plataforma';
  return roleCode || 'Sin rol asignado';
}
