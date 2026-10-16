import type { FrontendRegistration } from '../../source-contract.ts';

/** Static declarations; runtime components stay behind a literal lazy import. */
export const registration = {
  id: 'cyberark/risk_management',
  workspaces: [],
  domains: [],
  categories: [],
} as const satisfies FrontendRegistration;
