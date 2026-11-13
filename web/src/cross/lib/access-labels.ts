import type { AccessPermission } from './access-control-api';
import { t } from '../i18n/index.ts';

/** Short admin-facing names for permission codes; the catalog description stays the fallback. */
const SHORT_LABELS: Record<string, string> = {
  'inventory:read': 'Inventario PAM',
  'pam:catalogs_read': t('Catálogos técnicos PAM'),
  'pam:risk_read': 'Riesgo CyberArk',
  'pam:risk_entities_read': t('Nombres en hallazgos de riesgo'),
  'inventory:export': t('Exportar inventario'),
  'safes:read': t('Consultar Safes y cuentas'),
  'safes:manage': t('Clasificar Safes y cuentas'),
  'coverage:read': t('Consultar la cobertura de destinos'),
  'coverage:manage': t('Gestionar el inventario de destinos'),
  'catalogs:manage': t('Unidades y responsables'),
  'findings:manage': 'Hallazgos',
  'ingestion:preview': 'Previsualizar sync',
  'ingestion:run': 'Sincronizar',
  'sia:catalogs_read': t('Catálogos SIA'),
  'identity:catalogs_read': t('Catálogo Identity'),
  'netskope:read': t('Inventario, postura y métricas'),
  'netskope:admin': t('Líneas base y diagnósticos'),
  'netskope:dlp_read': 'Alertas DLP',
  'netskope:uba_read': t('Confianza y anomalías de usuarios'),
  'netskope:admin_inventory_read': t('Administradores y roles de Netskope'),
  'access:manage': 'Acceso total (superadmin)',
  'access:directory_read': t('Directorio de personas'),
  'access:local_users_manage': t('Usuarios locales'),
  'access:role_assignments_manage': 'Asignar roles',
  'access:roles_read': t('Roles y permisos'),
  'access:roles_manage': t('Editar roles'),
  'access:permissions_manage': 'Crear permisos',
  'access:oidc_mappings_read': t('Mapeo de Okta'),
  'audit:read': t('Auditoría y logs'),
  'security:events_read': t('Eventos de seguridad'),
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
