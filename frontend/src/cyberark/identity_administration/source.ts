import { KeyRound, Link2, UserCog, Users } from 'lucide-react';
import type { FrontendRegistration } from '../../source-contract.ts';

/** Static declarations; runtime components stay behind a literal lazy import. */
export const registration = {
  id: 'cyberark/identity_administration',
  toolLabel: 'CyberArk',
  workspaces: [
    {
      id: 'identity', path: '/pam/identity', legacyPaths: ['/roles', '/identity'], domain: 'pam',
      label: 'Identidades', detail: '¿Quién existe en Identity y en qué grupos?', icon: UserCog,
      description: 'Revisá personas, cuentas, roles y grupos de Identity Administration, con sus membresías directas y anidadas.',
      catalog: true, switcher: true, gate: 'open',
      order: 8,
      runtime: 'cyberark',
      category: { id: 'identity_sia', order: 0 },
      refreshSources: ['identity_administration'],
      command: { tool: 'identity', platform: 'cyberark', aliases: ['identidad', 'identidades', 'identity', 'scim', 'okta', 'usuarios'], priority: 12 },
    },
    {
      id: 'identityUsers', path: '/pam/identity/users', domain: 'pam',
      label: 'Usuarios', detail: 'Personas y cuentas registradas', icon: Users,
      description: "Revisá cuentas, estados y membresías de Identity Administration.",
      introHelp: { label: "Usuarios de Identity Administration", paragraphs: ["El directorio pertenece a Identity Administration. Las federaciones por dominio son asociaciones derivadas, no evidencia entregada por su API."] },
      catalog: true, switcher: false, gate: 'open',
      order: 21,
      runtime: 'cyberark',
      category: { id: 'pam_access', order: 1 },
      recentWorkspace: 'identity',
      refreshSources: ['identity_administration'],
      command: { tool: 'identity', platform: 'cyberark', aliases: ['usuarios pam', 'usuarios', 'identidades'], priority: 24 },
    },
    {
      id: 'identityGroups', path: '/pam/identity/groups', domain: 'pam',
      label: 'Grupos de Okta', detail: 'Grupos sincronizados desde Identity Administration', icon: Users,
      description: 'Consultá los grupos de Okta recibidos por Identity Administration y sus miembros registrados.',
      catalog: false, switcher: false, gate: 'open',
      order: 22,
      runtime: 'cyberark',
      category: { id: 'pam_access', order: 2 },
      recentWorkspace: 'identity',
      refreshSources: ['identity_administration'],
      command: { tool: 'identity', platform: 'cyberark', aliases: ['grupos okta', 'grupos', 'okta'], priority: 25 },
    },
    {
      id: 'identityRoles', path: '/pam/identity/roles', domain: 'pam',
      label: 'Roles y grupos', detail: 'Miembros directos y grupos anidados', icon: KeyRound,
      description: 'Consultá los roles y grupos recibidos de Identity Administration y las personas incluidas en cada uno.',
      catalog: true, switcher: false, gate: 'open',
      order: 23,
      runtime: 'cyberark',
      category: { id: 'pam_access', order: 3 },
      recentWorkspace: 'identity',
      refreshSources: ['identity_administration'],
      command: { tool: 'identity', platform: 'cyberark', aliases: ['roles identity', 'roles'], priority: 26 },
    },
    {
      /* UX-AUD-010: retired tab. Its path is kept only so an old bookmark
         redirects to Identidades; it must not be advertised as a destination
         (no tab renders it and its component is gone). */
      id: 'identityFederations', path: '/pam/identity/federations', domain: 'pam',
      label: 'Federaciones', detail: 'Federaciones de Identity Administration', icon: Link2,
      description: 'Federaciones de Identity Administration; sólo campos núcleo.',
      catalog: false, switcher: false, gate: 'manage', alternatePermission: 'identity:catalogs_read',
      order: 29,
      runtime: 'cyberark',
      recentWorkspace: 'identity',
      refreshSources: ['identity_administration'],
      command: { tool: 'identity', platform: 'cyberark', aliases: ['federaciones', 'saml', 'sso'], priority: 38 },
    },
  ],
  domains: [],
  categories: [],
  sync: { source: 'identity_administration', meta: { label: 'Identity Administration', fallback: 'I' }, domain: 'pam', tool: 'cyberark', toolMeta: { label: 'CyberArk', image: '/cyberark-logo-mint.png', fallback: 'C' }, componentLabel: 'Identity Administration', quietAutomaticSuccess: true },
} as const satisfies FrontendRegistration;
