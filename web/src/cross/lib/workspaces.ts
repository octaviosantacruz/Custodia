import { CATALOG_BY_ID, CATALOG_ENTRIES, catalogValues, type WorkspaceCatalogEntry, type WorkspaceView } from './workspace-catalog.ts';

export type { WorkspaceView } from './workspace-catalog';

const ENTRIES: readonly WorkspaceCatalogEntry[] = CATALOG_ENTRIES;

/* Domain-prefixed routes: PAM (the CyberArk chain) under /pam, platform
   administration under /admin. Canonical + legacy paths both resolve so old
   bookmarks keep working; useWorkspaceRoute rewrites the URL to the canonical
   path on load. Duplicate paths (e.g. '/pam/roles' for both roles and
   identityRoles) keep the first catalog entry as the reverse target. */
const WORKSPACE_PATHS = catalogValues((entry) => entry.path);

const PATH_WORKSPACES: Record<string, WorkspaceView> = {};
for (const entry of ENTRIES) {
  for (const path of [entry.path, ...(entry.legacyPaths ?? [])]) {
    if (!(path in PATH_WORKSPACES)) PATH_WORKSPACES[path] = entry.id as WorkspaceView;
  }
}

export function workspacePath(view: WorkspaceView): string {
  return WORKSPACE_PATHS[view];
}

export function workspaceFromPath(pathname: string): WorkspaceView | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return PATH_WORKSPACES[normalized] || null;
}

/* Some access:manage-gated workspaces also accept a narrower, purpose-built
   permission on the backend (migration 044): a PAM operator can see PAM's own
   technical catalogs, and dedicated SIA/Identity/Netskope reader roles can
   see their surfaces without full access:manage. The catalog declares each
   alternate; views without one still require access:manage alone. The person
   view declares several alternates: any one of the tool read permissions is
   enough. */
const WORKSPACE_ALTERNATE_PERMISSIONS = catalogValues((entry) => {
  const declared = entry as WorkspaceCatalogEntry;
  if (declared.alternatePermissions?.length) return declared.alternatePermissions;
  return declared.alternatePermission ? [declared.alternatePermission] : undefined;
});

/* Whether the actor's permission set unlocks this workspace: ungated views
   are always visible; gated views need access:manage or, where one exists,
   any of the narrower alternate permissions for that workspace. A `strict`
   view (NSK-DLP-001) is unlocked only by its declared permission:
   access:manage deliberately does not bypass it. */
export function hasWorkspaceAccess(view: WorkspaceView, permissions: string[]): boolean {
  const entry = CATALOG_BY_ID[view];
  if (entry.gate === 'open') return true;
  const alternates = WORKSPACE_ALTERNATE_PERMISSIONS[view];
  if (entry.gate === 'strict') {
    return alternates ? alternates.some((code) => permissions.includes(code)) : false;
  }
  if (permissions.includes('access:manage')) return true;
  const together = (CATALOG_BY_ID[view] as WorkspaceCatalogEntry).requiresAll;
  if (together?.length && together.every((code) => permissions.includes(code))) return true;
  return alternates ? alternates.some((code) => permissions.includes(code)) : false;
}

/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §5.8: any Identity subview
   (Usuarios/Grupos/Roles/Federaciones) records "Identidades" as the
   recent workspace, not itself -- those four are no longer separate
   top-level destinations (see domains.ts), so recording the subview
   directly would silently never show up in "Recientes" (it's filtered out
   there against the switcher's now-shorter available list). Same for any
   SIA subview (Recursos/Cobertura sources), which now record "SIA". */
export function canonicalRecentWorkspace(view: WorkspaceView): WorkspaceView {
  return (CATALOG_BY_ID[view].recentWorkspace as WorkspaceView | undefined) ?? view;
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
export const SIA_RESOURCE_WORKSPACE_ORDER: readonly WorkspaceView[] = ['siaResources', 'siaDatabaseAccounts'];

export function firstAuthorizedSiaResourceWorkspace(permissions: string[]): WorkspaceView | null {
  return SIA_RESOURCE_WORKSPACE_ORDER.find((view) => hasWorkspaceAccess(view, permissions)) ?? null;
}
