import { REGISTERED_DOMAINS } from '../../sources.ts';
import { CATALOG_BY_ID, CATALOG_ENTRIES, type Domain, type WorkspaceCatalogEntry, type WorkspaceView } from './workspace-catalog.ts';
import { hasWorkspaceAccess } from './workspaces.ts';

export type { Domain } from './workspace-catalog';

export type DomainStatus = 'active' | 'coming-soon';

export type DomainMeta = {
  id: Domain;
  label: string;
  blurb: string;
  status: DomainStatus;
  product: { id: string; label: string; description: string };
};

export const domains: DomainMeta[] = REGISTERED_DOMAINS;

/* Workspaces per domain, in nav order, derived from the catalog's switcher
   flag. IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.1/§3.2: identity
   subviews and SIA resource subviews stay valid WorkspaceViews (deep links,
   saved preferences, direct URLs keep working) but are deliberately left out
   of this list so the switcher/quick-access picker only ever offers a single
   "Identidades" and a single "SIA" destination. */
const DOMAIN_WORKSPACES: Record<Domain, WorkspaceView[]> = { admin: [], cross: [], pam: [], dlp: [], dspm: [] };
for (const entry of CATALOG_ENTRIES as readonly WorkspaceCatalogEntry[]) {
  if (entry.switcher) DOMAIN_WORKSPACES[entry.domain].push(entry.id as WorkspaceView);
}

export function domainMeta(id: Domain): DomainMeta {
  return domains.find((domain) => domain.id === id) ?? domains.find((domain) => domain.id === 'pam') ?? domains[0];
}

export function domainWorkspaces(id: Domain): WorkspaceView[] {
  return DOMAIN_WORKSPACES[id];
}

/* Navigation area declared by the catalog: the person view lives under the
   neutral Conexiones area (`cross`), not CyberArk, and the administration
   views under their own `admin` area. */
export function areaOf(view: WorkspaceView): Domain {
  return CATALOG_BY_ID[view].domain;
}

/** Navigation area and runtime host remain distinct for sanctioned compositions. */
export function domainOf(view: WorkspaceView): Domain {
  return CATALOG_BY_ID[view].routingDomain ?? areaOf(view);
}

export function domainLanding(id: Domain): WorkspaceView {
  return DOMAIN_WORKSPACES[id][0] ?? 'general';
}

/* First switcher destination the actor can actually open, in editorial order.
   The chrome uses it to land on a real workspace instead of assuming the
   first one is authorized (e.g. DS Hub with only Acceso or Actividad). */
export function firstAccessibleDomainWorkspace(id: Domain, permissions: string[]): WorkspaceView | null {
  return DOMAIN_WORKSPACES[id].find((view) => hasWorkspaceAccess(view, permissions)) ?? null;
}

/* A role sees a domain only if it holds `domain:<id>` (migration 023).
   Pre-023 backends emit no `domain:*` grants at all — fall back to status
   so the app stays usable until the migration runs.
   The neutral Conexiones and Administración areas have no product of their own:
   each is visible exactly when at least one of its workspaces is accessible.
   Each workspace keeps its own gate, so opening Personas never unlocks Acceso
   or Actividad. */
export function domainAccessible(id: Domain, permissions: string[]): boolean {
  if (domainMeta(id).status !== 'active') return false;
  const registration = REGISTERED_DOMAINS.find((domain) => domain.id === id);
  if (registration?.access === 'workspaces') return firstAccessibleDomainWorkspace(id, permissions) !== null;
  if (registration?.alternatePermissions?.some((permission) => permissions.includes(permission))) return true;
  const hasDomainGrants = permissions.some((code) => code.startsWith('domain:'));
  if (!hasDomainGrants) return true;
  return permissions.includes(`domain:${id}`);
}
