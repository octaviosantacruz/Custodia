import { SearchCode } from 'lucide-react';
import type { FrontendRegistration, RuntimeRegistration } from '../../source-contract.ts';
import { t } from '../../cross/i18n/index.ts';

const runtime: RuntimeRegistration = { id: 'cyberark', refreshDomain: 'pam', load: () => import('./router.tsx').then((module) => ({ default: module.CyberarkRouter })), gateWorkspace: false, suspense: true };

/** Static declarations; runtime components stay behind a literal lazy import. */
export const registration = {
  id: 'cyberark/shared',
  toolLabel: t('CyberArk'),
  workspaces: [
    {
      id: 'assets', path: '/pam/assets', legacyPaths: ['/pam/ip-inventory', '/pam/access-assets'], domain: 'pam',
      label: t('Cobertura'), detail: t('¿Dónde aparecen las conexiones migradas?'), icon: SearchCode,
      description: t('Destinos de la planilla contra lo que se observa en Safes y SIA.'),
      introHelp: { label: t('Cobertura'), paragraphs: ["Inventario de destinos por IP y puerto: lo declarado en la planilla contra las cuentas de Safes y las políticas SIA que usan esa IP. Se importa, se edita y se retira desde acá; lo que falta en un import se retira, no se borra. El inventario no crea vínculos normalizados nuevos entre herramientas."] },
      catalog: true, switcher: true, gate: 'open',
      order: 24,
      runtime: 'cyberark',
      category: { id: 'inventory', order: 1 },
      refreshSources: ['cyberark', 'sia', 'access'],
      command: { tool: 'pam', platform: 'cyberark', aliases: ['cobertura', 'inventario', t('inventario de infraestructura'), 'infraestructura', t('activos por ip'), 'cobertura pam sia'], priority: 34 },
    },
  ],
  domains: [
    { id: 'pam', order: 1, label: t('CyberArk'), blurb: t('PAM, Identity Administration, SIA y Access'), status: 'active', access: 'domain', sectionNav: true, product: { id: 'cyberark', label: t('CyberArk'), description: t('PAM, Identity Administration, SIA y Access') } }
  ],
  categories: [
    { id: 'inventory', label: t('Inventario'), order: 0 },
    { id: 'pam_access', label: t('Acceso PAM'), order: 1 },
    { id: 'technical_catalogs', label: t('Catálogos técnicos PAM'), order: 2 },
    { id: 'identity_sia', label: t('Identity y SIA · CyberArk'), order: 3 },
    { id: 'posture', label: t('Postura'), order: 4 },
  ],
  runtime,
} as const satisfies FrontendRegistration;
