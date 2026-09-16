import type { WorkspaceView } from './workspaces';

/* Top-level product domains. DS Hub is the umbrella; PAM is the CyberArk
   chain, Admin is platform governance across the tools. DLP / DSPM are
   declared now so the switcher can show them as "coming soon" without any
   further layout change once they ship. */
export type Domain = 'admin' | 'pam' | 'dlp' | 'dspm';

export type DomainStatus = 'active' | 'coming-soon';

export type DomainMeta = {
  id: Domain;
  label: string;
  blurb: string;
  status: DomainStatus;
};

export const domains: DomainMeta[] = [
  { id: 'admin', label: 'Admin', blurb: 'Gobierno y usuarios de la plataforma', status: 'active' },
  { id: 'pam', label: 'PAM', blurb: 'Accesos privilegiados', status: 'active' },
  { id: 'dlp', label: 'DLP', blurb: 'Prevención de fuga de datos', status: 'coming-soon' },
  { id: 'dspm', label: 'DSPM', blurb: 'Postura de Seguridad de Datos', status: 'coming-soon' },
];

/* Workspaces per domain, in nav order.
   IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.1/§3.2: identityUsers/
   identityGroups/identityRoles/identityFederations (Fase 1) and
   siaResources/siaDatabaseAccounts/accessAssets/assets (Fase 2) stay
   valid WorkspaceViews (deep links, saved preferences, direct URLs keep
   working -- see workspaces.ts's WORKSPACE_PATHS/PATH_WORKSPACES), but
   they're deliberately left out of this list so the switcher/quick-access
   picker only ever offers a single "Identidades" and a single "SIA"
   destination. Navigating between their internal sections now happens via
   each hub's own tabs, not via separate top-level entries. The PAM `roles`
   view follows the same rule now that Roles CyberArk is an Identity tab. */
const DOMAIN_WORKSPACES: Record<Domain, WorkspaceView[]> = {
  pam: ['general', 'posture', 'graph', 'safes', 'platforms', 'connectors', 'pamHealth', 'identity', 'sia'],
  admin: ['users', 'activity'],
  dlp: [],
  dspm: [],
};

export function domainMeta(id: Domain): DomainMeta {
  return domains.find((domain) => domain.id === id) ?? domains[1];
}

export function domainWorkspaces(id: Domain): WorkspaceView[] {
  return DOMAIN_WORKSPACES[id];
}

export function domainOf(view: WorkspaceView): Domain {
  return (Object.keys(DOMAIN_WORKSPACES) as Domain[]).find((id) => DOMAIN_WORKSPACES[id].includes(view)) ?? 'pam';
}

export function domainLanding(id: Domain): WorkspaceView {
  return DOMAIN_WORKSPACES[id][0] ?? 'general';
}

/* A role sees a domain only if it holds `domain:<id>` (migration 023).
   Pre-023 backends emit no `domain:*` grants at all — fall back to status
   so the app stays usable until the migration runs. */
export function domainAccessible(id: Domain, permissions: string[]): boolean {
  if (domainMeta(id).status !== 'active') return false;
  const canSeeAdminGroup = permissions.includes('access:manage') || permissions.includes('inventory:read');
  if (id === 'admin' && !canSeeAdminGroup) return false;
  const hasDomainGrants = permissions.some((code) => code.startsWith('domain:'));
  if (!hasDomainGrants) return true;
  return permissions.includes(`domain:${id}`) || (id === 'admin' && permissions.includes('inventory:read'));
}
