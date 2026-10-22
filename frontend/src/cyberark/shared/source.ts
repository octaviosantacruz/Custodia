import { SearchCode } from 'lucide-react';
import type { FrontendRegistration, RuntimeRegistration } from '../../source-contract.ts';

const runtime: RuntimeRegistration = { id: 'cyberark', refreshDomain: 'pam', load: () => import('./router.tsx').then((module) => ({ default: module.CyberarkRouter })), gateWorkspace: false, suspense: true };

/** Static declarations; runtime components stay behind a literal lazy import. */
export const registration = {
  id: 'cyberark/shared',
  toolLabel: 'CyberArk',
  workspaces: [
    {
      id: 'assets', path: '/pam/assets', legacyPaths: ['/pam/ip-inventory', '/pam/access-assets'], domain: 'pam',
      label: 'Cobertura', detail: '¿Dónde aparecen las conexiones migradas?', icon: SearchCode,
      description: "Destinos de la planilla contra lo que se observa en Safes y SIA.",
      introHelp: { label: "Cobertura", paragraphs: ["Inventario de destinos por IP y puerto: lo declarado en la planilla contra las cuentas de Safes y las políticas SIA que usan esa IP. Se importa, se edita y se retira desde acá; lo que falta en un import se retira, no se borra. El inventario no crea vínculos normalizados nuevos entre herramientas."] },
      catalog: true, switcher: true, gate: 'open',
      order: 24,
      runtime: 'cyberark',
      category: { id: 'inventory', order: 1 },
      refreshSources: ['cyberark', 'sia', 'access'],
      command: { tool: 'pam', platform: 'cyberark', aliases: ['cobertura', 'inventario', 'inventario de infraestructura', 'infraestructura', 'activos por ip', 'cobertura pam sia'], priority: 34 },
    },
  ],
  domains: [
    { id: 'pam', order: 1, label: 'CyberArk', blurb: 'PAM, Identity Administration, SIA y Access', status: 'active', access: 'domain', sectionNav: true, product: { id: 'cyberark', label: 'CyberArk', description: 'PAM, Identity Administration, SIA y Access' } }
  ],
  categories: [
    { id: 'inventory', label: 'Inventario', order: 0 },
    { id: 'pam_access', label: 'Acceso PAM', order: 1 },
    { id: 'technical_catalogs', label: 'Catálogos técnicos PAM', order: 2 },
    { id: 'identity_sia', label: 'Identity y SIA · CyberArk', order: 3 },
    { id: 'posture', label: 'Postura', order: 4 },
  ],
  runtime,
} as const satisfies FrontendRegistration;
