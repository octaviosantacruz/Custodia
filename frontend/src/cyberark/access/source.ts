import type { FrontendRegistration } from '../../source-contract.ts';

/** Access space only keeps its sync; its asset catalog is no longer a workspace. */
export const registration = {
  id: 'cyberark/access',
  toolLabel: 'CyberArk Access space',
  workspaces: [],
  domains: [],
  categories: [],
  sync: { source: 'access', meta: { label: 'Access space', fallback: 'A' }, domain: 'pam', tool: 'cyberark', toolMeta: { label: 'CyberArk', image: '/cyberark-logo-mint.png', fallback: 'C' }, componentLabel: 'Access space', quietAutomaticSuccess: true },
} as const satisfies FrontendRegistration;
