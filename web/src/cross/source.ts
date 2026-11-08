import { BookOpen, History, UserRound, Users } from 'lucide-react';
import type { FrontendRegistration, RuntimeRegistration } from '../source-contract.ts';
import { t } from './i18n/index.ts';

const runtime: RuntimeRegistration = { id: 'admin', load: () => import('./routers/admin-router.tsx').then((module) => ({ default: module.AdminDomainRouter })), gateWorkspace: true, suspense: false };

/** Static declarations; runtime components stay behind a literal lazy import. */
export const registration = {
  id: 'cross',
  workspaces: [
    {
      id: 'person', path: '/chains/person', legacyPaths: ['/connections/coverage'], domain: 'cross',
      label: t('Personas'), detail: t('¿Qué registros tiene una persona en cada herramienta?'), icon: UserRound,
      description: t('Buscá una persona y revisá sus identidades, accesos y vínculos disponibles.'),
      introHelp: { label: t('Vínculos por persona'), paragraphs: [t(t('La persona queda en el centro y cada herramienta en su órbita: la línea indica cómo se conecta, por correo exacto 1 a 1 o referencia por nombre. Elegí una herramienta para ver su detalle y abrir su cadena o su inventario.')), t(t('Una persona ausente en una fuente queda sin registro. La vista conserva la evidencia de cliente Netskope disponible, sin inventar cobertura ni relaciones.'))] },
      catalog: true, switcher: true, gate: 'manage',
      alternatePermissions: ['pam:catalogs_read', 'identity:catalogs_read', 'netskope:read'],
      order: 10,
      runtime: 'cyberark',
      routingDomain: 'pam',
      category: { id: 'connections', order: 0 },
      command: { tool: 'dshub', platform: 'dshub', aliases: ['conexiones', 'persona', 'personas', 'people', 'correo', 'vinculado', 'transversal', 'cobertura por persona'], priority: 5 },
    },
    {
      id: 'users', path: '/admin/access', legacyPaths: ['/admin', '/access', '/users'], domain: 'admin',
      label: t('Usuarios y permisos'), detail: t('Cuentas, roles y acceso a Custodia'), icon: Users,
      description: t('Administrá usuarios, asigná roles y revisá qué permisos habilitan las funciones de Custodia.'),
      catalog: true, switcher: true, gate: 'manage',
      alternatePermissions: ['access:directory_read', 'access:local_users_manage', 'access:role_assignments_manage', 'access:roles_read', 'access:roles_manage', 'access:permissions_manage', 'access:oidc_mappings_read'],
      order: 11,
      runtime: 'admin',
      category: { id: 'administration', order: 0 },
      command: { tool: 'dshub', platform: 'dshub', aliases: ['usuarios custodia', 'usuarios', 'acceso', 'permisos', 'roles', 'directorio'], priority: 14 },
    },
    {
      id: 'activity', path: '/admin/activity', legacyPaths: ['/activity'], domain: 'admin',
      label: t('Actividad'), detail: t('Auditoría, sincronizaciones y errores'), icon: History,
      description: t('Consultá los cambios realizados por usuarios, las sincronizaciones ejecutadas y los eventos operativos del sistema.'),
      catalog: true, switcher: true, gate: 'manage', alternatePermission: 'audit:read',
      order: 12,
      runtime: 'admin',
      category: { id: 'administration', order: 1 },
      command: { tool: 'dshub', platform: 'dshub', aliases: ['actividad', 'auditoria', 'bitacora', 'logs', 'historial'], priority: 15 },
    },
    {
      id: 'help', path: '/help', domain: 'cross',
      label: t('Ayuda'), detail: t('Guías de uso e interpretación de datos'), icon: BookOpen,
      description: t('Aprendé qué muestra cada vista, cómo recorrerla y cómo interpretar sus indicadores y datos.'),
      catalog: true, switcher: true, gate: 'open',
      order: 13,
      runtime: 'admin',
      category: { id: 'connections', order: 2 },
      command: { tool: 'dshub', platform: 'dshub', aliases: ['ayuda', 'documentacion', 'guia', 'manual', 'producto'], priority: 25 },
    },
  ],
  domains: [
    { id: 'cross', order: 0, label: t('Conexiones'), blurb: t('Alcance de cada persona en las herramientas'), status: 'active', access: 'workspaces', product: { id: 'cross', label: t('Conexiones'), description: t('Alcance de cada persona en las herramientas') } },
    { id: 'admin', order: 0.5, label: t('Administración'), blurb: t('Usuarios, permisos y actividad de Custodia'), status: 'active', access: 'workspaces', product: { id: 'admin', label: t('Administración'), description: t('Usuarios, permisos y actividad de Custodia') } },
    { id: 'dspm', order: 3, label: 'DSPM', blurb: t('Postura de Seguridad de Datos'), status: 'coming-soon', access: 'domain', product: { id: 'dspm', label: t('BigID DSPM'), description: t('Descubrimiento y postura de seguridad de datos') } }
  ],
  categories: [
    { id: 'connections', label: t('Conexiones'), order: 5 },
    { id: 'administration', label: t('Administración Custodia'), order: 6 },
  ],
  runtime,
  manualSync: { domain: 'admin', kind: 'batch', scope: 'all', label: t('Actualizar datos'), detail: t('Sincroniza todas las fuentes configuradas') },
} as const satisfies FrontendRegistration;
