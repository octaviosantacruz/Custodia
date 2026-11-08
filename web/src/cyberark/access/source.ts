import type { FrontendRegistration } from '../../source-contract.ts';
import { t } from '../../cross/i18n/index.ts';

/** Access space only keeps its sync; its asset catalog is no longer a workspace. */
export const registration = {
  id: 'cyberark/access',
  toolLabel: 'CyberArk',
  workspaces: [],
  domains: [],
  categories: [],
  sync: { source: 'access', meta: { label: t('Access space'), fallback: 'A' }, domain: 'pam', tool: 'cyberark', toolMeta: { label: t('CyberArk'), image: '/cyberark-logo-lime.png', fallback: 'C' }, componentLabel: 'Access space', quietAutomaticSuccess: true },
} as const satisfies FrontendRegistration;
