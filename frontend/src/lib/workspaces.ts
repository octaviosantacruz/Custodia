export type WorkspaceView = 'general' | 'posture' | 'graph' | 'safes' | 'roles' | 'platforms' | 'connectors' | 'identityUsers' | 'identityGroups' | 'identityRoles' | 'sia' | 'identity' | 'assets' | 'users' | 'activity' | 'pamHealth' | 'aimApplications' | 'accessAssets' | 'siaConnectors' | 'siaResources' | 'siaDatabaseAccounts' | 'identityFederations';

export const workspaceViews: WorkspaceView[] = ['general', 'posture', 'graph', 'safes', 'roles', 'platforms', 'connectors', 'identityUsers', 'identityGroups', 'identityRoles', 'sia', 'identity', 'assets', 'users', 'activity', 'pamHealth', 'aimApplications', 'accessAssets', 'siaResources', 'siaDatabaseAccounts', 'identityFederations'];

export type WorkspaceCategoryId = 'inventory' | 'pam_access' | 'technical_catalogs' | 'identity_sia' | 'posture' | 'administration';

export type WorkspaceCategory = { id: WorkspaceCategoryId; label: string; views: WorkspaceView[] };

export const workspaceCategories: WorkspaceCategory[] = [
  { id: 'inventory', label: 'Inventario', views: ['safes', 'assets', 'general'] },
  { id: 'pam_access', label: 'Acceso PAM', views: ['roles', 'identityUsers', 'identityGroups', 'identityRoles', 'graph'] },
  { id: 'technical_catalogs', label: 'Catálogos técnicos PAM', views: ['platforms', 'connectors', 'pamHealth', 'accessAssets'] },
  { id: 'identity_sia', label: 'Identity & SIA', views: ['identity', 'sia', 'siaResources', 'siaDatabaseAccounts', 'identityFederations'] },
  { id: 'posture', label: 'Postura', views: ['posture'] },
  { id: 'administration', label: 'Administración', views: ['users', 'activity'] },
];

export function categoryOfWorkspace(view: WorkspaceView): WorkspaceCategoryId | null {
  return workspaceCategories.find((category) => category.views.includes(view))?.id ?? null;
}

export function categorizedWorkspaces(available: WorkspaceView[]): Array<WorkspaceCategory & { views: WorkspaceView[] }> {
  return workspaceCategories
    .map((category) => ({ ...category, views: category.views.filter((view) => available.includes(view)) }))
    .filter((category) => category.views.length > 0);
}

/* Domain-prefixed routes: PAM (the CyberArk chain) under /pam, platform
   administration under /admin. DLP / DSPM domains land here once they exist. */
const WORKSPACE_PATHS: Record<WorkspaceView, string> = {
  general: '/pam',
  posture: '/pam/posture',
  graph: '/pam/graph',
  safes: '/pam/safes',
  roles: '/pam/roles',
  platforms: '/pam/platforms',
  connectors: '/pam/connectors',
  identityUsers: '/pam/identity/users',
  identityGroups: '/pam/identity/groups',
  identityRoles: '/pam/roles',
  sia: '/pam/sia',
  assets: '/pam/assets',
  identity: '/pam/identity',
  users: '/admin/access',
  activity: '/admin/activity',
  pamHealth: '/pam/health',
  aimApplications: '/pam/aim-applications',
  accessAssets: '/pam/access-assets',
  // Kept as a compatibility key for saved preferences; both inventories use
  // the single connectors workspace and canonical route.
  siaConnectors: '/pam/connectors',
  siaResources: '/pam/sia/resources',
  siaDatabaseAccounts: '/pam/sia/database-accounts',
  identityFederations: '/pam/identity/federations',
};

/* Canonical + legacy paths both resolve so old bookmarks keep working;
   useWorkspaceRoute rewrites the URL to the canonical path on load. */
const PATH_WORKSPACES: Record<string, WorkspaceView> = {
  '/': 'general',
  '/pam': 'general',
  '/pam/posture': 'posture',
  '/pam/graph': 'graph',
  '/pam/safes': 'safes',
  '/pam/roles': 'roles',
  '/pam/platforms': 'platforms',
  '/pam/connectors': 'connectors',
  '/pam/identity/users': 'identityUsers',
  '/pam/identity/groups': 'identityGroups',
  '/pam/identity/roles': 'roles',
  '/pam/sia': 'sia',
  '/pam/assets': 'assets',
  // Legacy: this workspace was named after IP-based connection lookup
  // before it grew into a general asset inventory.
  '/pam/ip-inventory': 'assets',
  '/pam/identity': 'identity',
  '/admin': 'users',
  '/admin/access': 'users',
  '/admin/activity': 'activity',
  // legacy (pre-domain-prefix)
  '/operations': 'general',
  // Legacy roles URL should land on the actual Identity Administration view;
  // it was incorrectly pointing to the Operations summary.
  '/roles': 'identity',
  '/safes': 'safes',
  '/sia': 'sia',
  '/identity': 'identity',
  '/access': 'users',
  '/users': 'users',
  '/activity': 'activity',
  '/pam/health': 'pamHealth',
  '/pam/aim-applications': 'aimApplications',
  '/pam/access-assets': 'accessAssets',
  '/pam/sia/connectors': 'connectors',
  '/pam/sia/resources': 'siaResources',
  '/pam/sia/database-accounts': 'siaDatabaseAccounts',
  '/pam/identity/federations': 'identityFederations',
};

export function workspacePath(view: WorkspaceView): string {
  return WORKSPACE_PATHS[view];
}

export function workspaceFromPath(pathname: string): WorkspaceView | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return PATH_WORKSPACES[normalized] || null;
}

export function workspaceRequiresAccessManage(view: WorkspaceView): boolean {
  return view === 'users' || view === 'graph' || view === 'platforms' || view === 'connectors' || view === 'activity' || view === 'pamHealth' || view === 'aimApplications' || view === 'accessAssets' || view === 'siaConnectors' || view === 'siaResources' || view === 'siaDatabaseAccounts' || view === 'identityFederations';
}

/* Some access:manage-gated workspaces now also accept a narrower,
   purpose-built permission on the backend (migration 044): a PAM operator
   can see PAM's own technical catalogs, and dedicated SIA/Identity reader
   roles can see those catalogs, without holding full access:manage. Views
   not listed here still require access:manage alone (e.g. users/activity/
   graph are genuine platform-administration surfaces). */
const WORKSPACE_ALTERNATE_PERMISSIONS: Partial<Record<WorkspaceView, string>> = {
  platforms: 'pam:catalogs_read',
  connectors: 'pam:catalogs_read',
  pamHealth: 'pam:catalogs_read',
  aimApplications: 'pam:catalogs_read',
  accessAssets: 'pam:catalogs_read',
  siaConnectors: 'sia:catalogs_read',
  siaResources: 'sia:catalogs_read',
  siaDatabaseAccounts: 'sia:catalogs_read',
  identityFederations: 'identity:catalogs_read',
};

/* Whether the actor's permission set unlocks this workspace: ungated views
   are always visible; gated views need access:manage or, where one exists,
   the narrower alternate permission for that workspace. */
export function hasWorkspaceAccess(view: WorkspaceView, permissions: string[]): boolean {
  if (!workspaceRequiresAccessManage(view)) return true;
  if (permissions.includes('access:manage')) return true;
  const alternate = WORKSPACE_ALTERNATE_PERMISSIONS[view];
  return alternate ? permissions.includes(alternate) : false;
}

/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §5.8: any Identity subview
   (Usuarios/Grupos/Roles/Federaciones) records "Identidades" as the
   recent workspace, not itself -- those four are no longer separate
   top-level destinations (see domains.ts), so recording the subview
   directly would silently never show up in "Recientes" (it's filtered out
   there against the switcher's now-shorter available list). Same for any
   SIA subview (Recursos/Cobertura sources), which now record "SIA". */
const IDENTITY_SUBVIEWS: readonly WorkspaceView[] = ['identityUsers', 'identityGroups', 'identityRoles', 'identityFederations', 'roles'];
const SIA_SUBVIEWS: readonly WorkspaceView[] = ['siaResources', 'siaDatabaseAccounts', 'accessAssets', 'assets'];

export function canonicalRecentWorkspace(view: WorkspaceView): WorkspaceView {
  if (IDENTITY_SUBVIEWS.includes(view)) return 'identity';
  if (SIA_SUBVIEWS.includes(view)) return 'sia';
  return view;
}

export function canonicalWorkspaceList(views: WorkspaceView[]): WorkspaceView[] {
  return [...new Set(views.map(canonicalRecentWorkspace))];
}

/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §6: the three Recursos
   sources each keep their own narrow permission (never homologated just
   because they share the SIA hub's "Recursos" tab). A single shared order
   so App.tsx's top-level redirect guard and SiaHubWorkspace's own
   tab/redirect logic can't drift out of sync with each other -- landing
   an actor who lacks permission for one specific resource kind on
   whichever *other* one they do hold, instead of unconditionally
   defaulting to the first in the list regardless of what's actually
   authorized (a real bug this fixed: an actor with only
   pam:catalogs_read used to get bounced all the way back to Políticas
   instead of landing on the one resource kind -- Access Assets -- they
   could actually see). */
export const SIA_RESOURCE_WORKSPACE_ORDER: readonly WorkspaceView[] = ['siaResources', 'siaDatabaseAccounts', 'accessAssets'];

export function firstAuthorizedSiaResourceWorkspace(permissions: string[]): WorkspaceView | null {
  return SIA_RESOURCE_WORKSPACE_ORDER.find((view) => hasWorkspaceAccess(view, permissions)) ?? null;
}

/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.3/§9 (Fase 3): the
   "Infraestructura PAM" quick-nav group (conectores/salud/AIM). Unlike
   the SIA/Identity hubs, these three keep their own standalone switcher
   entries -- the plan explicitly requires validating with users before
   retiring them, so this helper only decides which one an internal
   subnav should jump to, never what's visible in the switcher itself. */
export const PAM_INFRA_WORKSPACE_ORDER: readonly WorkspaceView[] = ['connectors', 'pamHealth'];

export function firstAuthorizedPamInfraWorkspace(permissions: string[]): WorkspaceView | null {
  return PAM_INFRA_WORKSPACE_ORDER.find((view) => hasWorkspaceAccess(view, permissions)) ?? null;
}
