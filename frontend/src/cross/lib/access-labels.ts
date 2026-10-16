import type { AccessPermission } from './access-control-api';

/** Short admin-facing names for permission codes; the catalog description stays the fallback. */
const SHORT_LABELS: Record<string, string> = {
  'inventory:read': 'Inventario PAM',
  'pam:catalogs_read': 'Catálogos técnicos PAM',
  'pam:risk_read': 'Riesgo CyberArk',
  'pam:risk_entities_read': 'Nombres en hallazgos de riesgo',
  'inventory:export': 'Exportar inventario',
  'safes:read': 'Consultar Safes y cuentas',
  'safes:manage': 'Clasificar Safes y cuentas',
  'coverage:read': 'Consultar la cobertura de destinos',
  'coverage:manage': 'Gestionar el inventario de destinos',
  'catalogs:manage': 'Unidades y responsables',
  'findings:manage': 'Hallazgos',
  'ingestion:preview': 'Previsualizar sync',
  'ingestion:run': 'Sincronizar',
  'sia:catalogs_read': 'Catálogos SIA',
  'identity:catalogs_read': 'Catálogo Identity',
  'netskope:read': 'Inventario, postura y métricas',
  'netskope:admin': 'Líneas base y diagnósticos',
  'netskope:dlp_read': 'Alertas DLP',
  'netskope:uba_read': 'Confianza y anomalías de usuarios',
  'netskope:admin_inventory_read': 'Administradores y roles de Netskope',
  'access:manage': 'Acceso total (superadmin)',
  'access:directory_read': 'Directorio de personas',
  'access:local_users_manage': 'Usuarios locales',
  'access:role_assignments_manage': 'Asignar roles',
  'access:roles_read': 'Roles y permisos',
  'access:roles_manage': 'Editar roles',
  'access:permissions_manage': 'Crear permisos',
  'access:oidc_mappings_read': 'Mapeo de Okta',
  'audit:read': 'Auditoría y logs',
  'security:events_read': 'Eventos de seguridad',
  'bigid:read': 'BigID',
  'bigid:admin': 'Administrar BigID',
};

/** Codes no route enforces (migrations 097 and 101); they never appear as a capability. */
const LEGACY = new Set(['catalogs:read', 'catalogs:write', 'inventory:write', 'safes:classify', 'safes:bulk_classify', 'connections:import']);

/** Strict per-user Netskope data: always shown, and marked. */
export const PER_USER_DATA = new Set(['netskope:dlp_read', 'netskope:uba_read', 'netskope:admin_inventory_read']);

/** domain:* only opens an area's menu; the area row already says it. */
export function isVisibleCapability(code: string): boolean {
  return !code.startsWith('domain:') && !LEGACY.has(code);
}

export function capabilityLabel(code: string, permission?: AccessPermission): string {
  return SHORT_LABELS[code] || permission?.description || code;
}

/** Reading is the 'read' action; anything else (manage, export, run, import…) changes something. */
export function isReadCapability(code: string, permission?: AccessPermission): boolean {
  return (permission?.action_code || code.split(':')[1] || '').endsWith('read');
}
