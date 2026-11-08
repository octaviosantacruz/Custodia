import type { FrontendRegistration } from '../../source-contract.ts';

/** Composed within Servicio → Conectores; no duplicate workspace or sync job. */
export const registration = {
  id: 'cyberark/connector_manager', workspaces: [], domains: [], categories: [],
} as const satisfies FrontendRegistration;
