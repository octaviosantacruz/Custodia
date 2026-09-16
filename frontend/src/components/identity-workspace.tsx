import { useEffect, type ReactNode } from 'react';
import { Link2, ShieldCheck, Users, UsersRound } from 'lucide-react';
import { IdentityAdminWorkspace } from './identity-admin-workspace';
import { IdentityFederationsWorkspace } from './identity-federations-workspace';
import { PamRolesWorkspace } from './pam-roles-workspace';
import { handleTablistKeyDown } from '../lib/tablist-keyboard';
import { hasWorkspaceAccess, type WorkspaceView } from '../lib/workspaces';

type IdentitySection = 'users' | 'groups' | 'federations' | 'cyberarkRoles';

type IdentityWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  permissions: string[];
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNavigate: (view: WorkspaceView, query?: string) => void;
  initialSection?: IdentitySection;
  initialQuery?: string;
  includeInternal?: boolean;
};

const SECTION_META: Array<{ id: IdentitySection; label: string; detail: string; icon: ReactNode }> = [
  { id: 'users', label: 'Usuarios', detail: 'Directorio actual de Identity Administration', icon: <Users size={16} /> },
  { id: 'cyberarkRoles', label: 'Roles CyberArk', detail: 'Roles nativos y alcance PAM', icon: <ShieldCheck size={16} /> },
  { id: 'groups', label: 'Grupos de Okta', detail: 'Nombres SCIM con prefijo sg_cyberark', icon: <UsersRound size={16} /> },
  { id: 'federations', label: 'Federaciones', detail: 'Catálogo de federaciones de Identity Administration', icon: <Link2 size={16} /> },
];

const SECTION_VIEWS: Record<IdentitySection, WorkspaceView> = {
  users: 'identityUsers',
  groups: 'identityGroups',
  cyberarkRoles: 'roles',
  federations: 'identityFederations',
};

/* Navigation for every section goes through the app's single routing
   mechanism (useWorkspaceRoute, via the onNavigate prop). The retired
   Identity-roles path is an alias of the richer CyberArk roles section, so
   clicking a tab remains a normal workspace change with no local history or
   popstate handling. */
export function IdentityWorkspace({ authChecked, authenticated, permissions, onUnauthorized, onError, onNavigate, initialSection = 'users', initialQuery = '', includeInternal = true }: IdentityWorkspaceProps) {
  useEffect(() => {
    // One-time compatibility shim for the old query-param URL scheme
    // (/pam/identity?section=roles) this workspace used before each
    // section had its own canonical path. Redirects once, then the URL
    // is clean and every further navigation is a normal workspace change.
    if (typeof window === 'undefined' || window.location.pathname !== '/pam/identity') return;
    const legacySection = new URLSearchParams(window.location.search).get('section');
    if (legacySection === 'roles') onNavigate('roles');
    else if (legacySection === 'users' || legacySection === 'groups') onNavigate(SECTION_VIEWS[legacySection]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §6: a tab without
  // permission never shows, and a direct link to it redirects to the
  // first authorized tab instead of rendering a blocked/empty pane.
  const visibleSections = SECTION_META.filter((item) => hasWorkspaceAccess(SECTION_VIEWS[item.id], permissions));
  const sectionAllowed = visibleSections.some((item) => item.id === initialSection);
  const activeSection = sectionAllowed ? initialSection : (visibleSections[0]?.id ?? 'users');

  useEffect(() => {
    if (!sectionAllowed && visibleSections.length) onNavigate(SECTION_VIEWS[activeSection]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionAllowed, activeSection]);

  return <section className="identity-workspace" aria-label="Identidades">
    <nav className="workspace-subnav" aria-label="Secciones de identidad" role="tablist" onKeyDown={handleTablistKeyDown}>
      {visibleSections.map((item) => <button
        key={item.id}
        type="button"
        role="tab"
        aria-selected={activeSection === item.id}
        tabIndex={activeSection === item.id ? 0 : -1}
        title={`Mostrar ${item.label}: ${item.detail}`}
        className={activeSection === item.id ? 'active' : ''}
        onClick={() => onNavigate(SECTION_VIEWS[item.id])}
      >
        <span className="workspace-subnav-icon" aria-hidden>{item.icon}</span>
        <span className="workspace-subnav-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
      </button>)}
    </nav>

    {activeSection === 'cyberarkRoles'
      ? <PamRolesWorkspace
          key="cyberark-roles"
          authChecked={authChecked}
          authenticated={authenticated}
          onUnauthorized={onUnauthorized}
          onError={onError}
          onNavigate={onNavigate}
          initialQuery={initialQuery}
          includeInternal={includeInternal}
          embedded
        />
      : activeSection === 'federations'
      ? <IdentityFederationsWorkspace
          key="federations"
          authChecked={authChecked}
          authenticated={authenticated}
          onUnauthorized={onUnauthorized}
          onError={onError}
          initialQuery={initialQuery}
        />
      : <IdentityAdminWorkspace
          key={activeSection}
          authChecked={authChecked}
          authenticated={authenticated}
          onUnauthorized={onUnauthorized}
          onError={onError}
          onNavigate={onNavigate}
          initialTab={activeSection === 'users' ? 'users' : 'roles'}
          initialQuery={initialQuery}
          roleKind={activeSection === 'groups' ? 'okta_group' : ''}
          embedded
        />}
  </section>;
}
