import { useEffect } from 'react';
import { ShieldCheck, Boxes } from 'lucide-react';
import { SiaWorkspace } from '../../sia/components/sia-workspace';
import { RESOURCE_META, RESOURCE_VIEWS, SiaResourcesTab, type ResourceKind } from './sia-resources-tab';
import { handleTablistKeyDown } from '../../../cross/lib/tablist-keyboard';
import { hasWorkspaceAccess, type WorkspaceView } from '../../../cross/lib/workspaces';
import { t } from '../../../cross/i18n/index.ts';

type SiaSection = 'policies' | 'resources';

type SiaHubWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  permissions: string[];
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNavigate: (view: WorkspaceView, query?: string) => void;
  initialSection?: SiaSection;
  initialResourceKind?: ResourceKind;
  initialQuery?: string;
};

const SECTION_META = [
  { view: 'sia', label: t('Políticas'), detail: t('Accesos definidos, usuarios y destinos'), icon: ShieldCheck },
  ...RESOURCE_META.map((item) => ({ view: RESOURCE_VIEWS[item.id], label: item.label, detail: item.detail, icon: Boxes })),
] satisfies Array<{ view: WorkspaceView; label: string; detail: string; icon: typeof ShieldCheck }>;

export function SiaHubWorkspace({
  authChecked, authenticated, permissions,
  onUnauthorized, onError, onNavigate,
  initialSection = 'policies', initialResourceKind = 'resources', initialQuery = '',
}: SiaHubWorkspaceProps) {
  const requestedView = initialSection === 'resources' ? RESOURCE_VIEWS[initialResourceKind] : 'sia';
  const visibleSections = SECTION_META.filter((item) => hasWorkspaceAccess(item.view, permissions));
  const sectionAllowed = visibleSections.some((item) => item.view === requestedView);
  const activeView = sectionAllowed ? requestedView : (visibleSections[0]?.view ?? 'sia');
  const activeSection: SiaSection = activeView === 'sia' ? 'policies' : 'resources';

  useEffect(() => {
    if (!sectionAllowed && visibleSections.length) onNavigate(activeView);
  }, [sectionAllowed, activeView, onNavigate, visibleSections.length]);

  return <section className="sia-hub-workspace" aria-label="Secure Infrastructure Access">
    <nav className="workspace-subnav" aria-label={t('Secciones de SIA')} role="tablist" onKeyDown={handleTablistKeyDown}>
      {visibleSections.map((item) => {
        const Icon = item.icon;
        return <button
          key={item.view}
          id={`sia-section-${item.view}`}
          aria-controls="sia-section-panel"
          type="button"
          role="tab"
          aria-selected={activeView === item.view}
          tabIndex={activeView === item.view ? 0 : -1}
          aria-label={`${item.label} ${item.detail}`}
          title={t('Mostrar {value}: {detail}', { value: item.label, detail: item.detail })}
          className={activeView === item.view ? 'active' : ''}
          onClick={() => onNavigate(item.view)}
        >
          <span className="workspace-subnav-icon" aria-hidden><Icon size={16} /></span>
          <span className="workspace-subnav-copy"><strong>{item.label}</strong></span>
        </button>;
      })}
    </nav>

    <div role="tabpanel" id="sia-section-panel" aria-labelledby={`sia-section-${activeView}`}>
    {activeSection === 'resources'
      ? <SiaResourcesTab
          authChecked={authChecked}
          authenticated={authenticated}
          permissions={permissions}
          onUnauthorized={onUnauthorized}
          onError={onError}
          onNavigate={onNavigate}
          initialResourceKind={initialResourceKind}
          initialQuery={initialQuery}
        />
      : <SiaWorkspace
          authChecked={authChecked}
          authenticated={authenticated}
          onUnauthorized={onUnauthorized}
          onError={onError}
          onNavigate={onNavigate}
          initialQuery={initialQuery}
        />}
    </div>
  </section>;
}
