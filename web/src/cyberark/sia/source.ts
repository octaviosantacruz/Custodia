import { Boxes, Database, PlugZap } from 'lucide-react';
import type { FrontendRegistration } from '../../source-contract.ts';
import { t } from '../../cross/i18n/index.ts';

/** Static declarations; runtime components stay behind a literal lazy import. */
export const registration = {
  id: 'cyberark/sia',
  toolLabel: t('CyberArk'),
  workspaces: [
    {
      id: 'sia', path: '/pam/sia', legacyPaths: ['/sia'], domain: 'pam',
      label: 'SIA', detail: t('¿Qué cubre SIA: políticas, máquinas, bases?'), icon: PlugZap,
      description: t('Revisá políticas, destinatarios y vínculos de acceso SIA.'),
      introHelp: { label: t('Políticas de acceso SIA'), paragraphs: ["Políticas de acceso SIA. Los vínculos por correo exacto se muestran separados de las referencias por nombre."] },
      catalog: true, switcher: true, gate: 'open',
      order: 9,
      runtime: 'cyberark',
      category: { id: 'identity_sia', order: 1 },
      refreshSources: ['sia'],
      command: { tool: 'sia', platform: 'cyberark', aliases: ['sia', 'politicas', 'policies', 'acceso', 'recursos'], priority: 13 },
    },
    {
      id: 'siaConnectors', path: '/pam/connectors', domain: 'pam',
      label: t('Conectores'), detail: t('Inventarios de PSM, SIA y Connector Manager'), icon: PlugZap,
      description: t('Consultá por separado los conectores PSM de Privilege Cloud y los conectores de Secure Infrastructure Access.'),
      catalog: false, switcher: false, gate: 'manage', alternatePermission: 'sia:catalogs_read',
      order: 26,
      runtime: 'cyberark',
      command: { tool: 'sia', platform: 'cyberark', aliases: ['conectores sia', 'conectores'], priority: 37 },
    },
    {
      id: 'siaResources', path: '/pam/sia/resources', legacyPaths: ['/pam/sia/target-sets'], domain: 'pam',
      label: t('Máquinas virtuales SIA'), detail: t('Infraestructura registrada en SIA'), icon: Boxes,
      description: t('Consultá las máquinas virtuales registradas en SIA.'),
      introHelp: { label: t('Inventario de máquinas virtuales SIA'), paragraphs: ["Inventario de sólo lectura de Secure Infrastructure Access. No muestra direcciones IP, FQDN ni nombres de red."] },
      catalog: true, switcher: false, gate: 'manage', alternatePermission: 'sia:catalogs_read',
      order: 27,
      runtime: 'cyberark',
      category: { id: 'identity_sia', order: 2 },
      recentWorkspace: 'sia',
      refreshSources: ['sia'],
      command: { tool: 'sia', platform: 'cyberark', aliases: ['recursos', 'vm', 'infraestructura'], priority: 35 },
    },
    {
      id: 'siaDatabaseAccounts', path: '/pam/sia/database-accounts', domain: 'pam',
      label: t('Cuentas de base de datos SIA'), detail: t('Strong Accounts y plataformas asociadas'), icon: Database,
      description: t('Consultá cuentas de base de datos y sus plataformas SIA.'),
      introHelp: { label: t('Inventario de cuentas de base de datos SIA'), paragraphs: ["Inventario de Strong Accounts administradas por Secure Infrastructure Access. Se muestran plataforma, base de datos, puerto y fechas operativas; nunca nombres de usuario ni credenciales."] },
      catalog: true, switcher: false, gate: 'manage', alternatePermission: 'sia:catalogs_read',
      order: 28,
      runtime: 'cyberark',
      category: { id: 'identity_sia', order: 3 },
      recentWorkspace: 'sia',
      refreshSources: ['sia'],
      command: { tool: 'sia', platform: 'cyberark', aliases: ['cuentas bd', 'strong accounts', 'base de datos'], priority: 36 },
    },
  ],
  domains: [],
  categories: [],
  sync: { source: 'sia', meta: { label: 'SIA', fallback: 'S' }, domain: 'pam', tool: 'cyberark', toolMeta: { label: t('CyberArk'), image: '/cyberark-logo-lime.png', fallback: 'C' }, componentLabel: 'SIA', quietAutomaticSuccess: true },
} as const satisfies FrontendRegistration;
