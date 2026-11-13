import { useEffect, type ReactNode } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import { IdentityAdminWorkspace } from '../../identity_administration/components/identity-admin-workspace';
import { handleTablistKeyDown } from '../../../cross/lib/tablist-keyboard';
import { hasWorkspaceAccess, type WorkspaceView } from '../../../cross/lib/workspaces';
import { t } from '../../../cross/i18n/index.ts';

type IdentitySection = 'users' | 'groups' | 'federations' | 'cyberarkRoles' | 'identityRoles';

type IdentityWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  permissions: string[];
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNavigate: (view: WorkspaceView, query?: string) => void;
  initialSection?: IdentitySection;
  initialQuery?: string;
};

const SECTION_META: Array<{ id: IdentitySection; label: string; detail: string; icon: ReactNode }> = [
  { id: 'users', label: t('Usuarios'), detail: t('Personas y cuentas registradas'), icon: <Users size={16} /> },
  { id: 'identityRoles', label: t('Roles y grupos'), detail: t('Miembros directos y grupos anidados'), icon: <ShieldCheck size={16} /> },
];

const SECTION_VIEWS: Record<IdentitySection, WorkspaceView> = {
  users: 'identityUsers',
  groups: 'identityRoles',
  cyberarkRoles: 'identityRoles',
  identityRoles: 'identityRoles',
  federations: 'identityFederations',
};

export function IdentityWorkspace({ authChecked, authenticated, permissions, onUnauthorized, onError, onNavigate, initialSection = 'users', initialQuery = '' }: IdentityWorkspaceProps) {
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §6: a tab without
  // permission never shows, and a direct link to it redirects to the
  // first authorized tab instead of rendering a blocked/empty pane.
  const visibleSections = SECTION_META.filter((item) => hasWorkspaceAccess(SECTION_VIEWS[item.id], permissions));
  const requestedSection = ['groups', 'cyberarkRoles'].includes(initialSection) ? 'identityRoles' : initialSection;
  const sectionAllowed = visibleSections.some((item) => item.id === requestedSection);
  const activeSection = sectionAllowed ? requestedSection : (visibleSections[0]?.id ?? 'users');

  useEffect(() => {
    if (visibleSections.length && (!sectionAllowed || requestedSection !== initialSection)) onNavigate(SECTION_VIEWS[activeSection], initialQuery);
  }, [sectionAllowed, activeSection, requestedSection, initialSection, initialQuery, onNavigate, visibleSections.length]);

  return <section className="identity-workspace" aria-label="Identidades">
    <nav className="workspace-subnav" aria-label={t('Secciones de identidad')} role="tablist" onKeyDown={handleTablistKeyDown}>
      {visibleSections.map((item) => <button
        key={item.id}
        id={`identity-section-${item.id}`}
        aria-controls="identity-section-panel"
        type="button"
        role="tab"
        aria-selected={activeSection === item.id}
        tabIndex={activeSection === item.id ? 0 : -1}
        title={t('Mostrar {value}: {detail}', { value: item.label, detail: item.detail })}
        className={activeSection === item.id ? 'active' : ''}
        onClick={() => onNavigate(SECTION_VIEWS[item.id])}
      >
        <span className="workspace-subnav-icon" aria-hidden>{item.icon}</span>
        <span className="workspace-subnav-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
      </button>)}
    </nav>

    <div role="tabpanel" id="identity-section-panel" aria-labelledby={`identity-section-${activeSection}`}>
    <IdentityAdminWorkspace
          key={activeSection}
          authChecked={authChecked}
          authenticated={authenticated}
          canReadIdentityCatalogs={permissions.includes('access:manage') || permissions.includes('identity:catalogs_read')}
          onUnauthorized={onUnauthorized}
          onError={onError}
          onNavigate={onNavigate}
          initialTab={activeSection === 'users' ? 'users' : 'roles'}
          initialQuery={initialQuery}
          roleKind=""
          embedded
        />
    </div>
  </section>;
}
