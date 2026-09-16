import { useEffect } from 'react';
import { ShieldCheck, Boxes, Radar } from 'lucide-react';
import { SiaWorkspace } from './sia-workspace';
import { SiaResourcesTab, type ResourceKind } from './sia-resources-tab';
import { ConnectionInventoryWorkspace } from './connection-inventory-workspace';
import { handleTablistKeyDown } from '../lib/tablist-keyboard';
import { firstAuthorizedSiaResourceWorkspace, hasWorkspaceAccess, type WorkspaceView } from '../lib/workspaces';
import type { ConnectionCoverageFilter } from '../types/connection';

type SiaSection = 'policies' | 'resources' | 'coverage';

type SiaHubWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  permissions: string[];
  includeInternal: boolean;
  canManageAssets: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onNavigate: (view: WorkspaceView, query?: string) => void;
  initialSection?: SiaSection;
  initialResourceKind?: ResourceKind;
  initialQuery?: string;
  assetsSeed?: { search: string; environment: string; coverage: ConnectionCoverageFilter | '' };
};

const SECTION_META: Array<{ id: SiaSection; label: string; detail: string; icon: typeof ShieldCheck }> = [
  { id: 'policies', label: 'Políticas', detail: 'Políticas de acceso y objetos administrados por SIA', icon: ShieldCheck },
  { id: 'resources', label: 'Recursos', detail: 'VMs, Strong Accounts y assets del Access space', icon: Boxes },
  { id: 'coverage', label: 'Cobertura', detail: 'Activos y conexiones importadas: cobertura PAM y SIA', icon: Radar },
];

/* Every section maps to a first-class WorkspaceView with its own
   canonical path (same pattern as IdentityWorkspace): clicking a tab
   just navigates like any other workspace change, no local
   history/popstate handling needed here. "Recursos" doesn't have a
   single canonical view of its own -- it defers to whichever of the
   three resource sub-views is actually active (see SiaResourcesTab). */
const SECTION_VIEWS: Record<Exclude<SiaSection, 'resources'>, WorkspaceView> = {
  policies: 'sia',
  coverage: 'assets',
};

const RESOURCE_KIND_VIEWS: Record<ResourceKind, WorkspaceView> = {
  resources: 'siaResources',
  databaseAccounts: 'siaDatabaseAccounts',
  accessAssets: 'accessAssets',
};

/* The "Recursos" tab/redirect target must be a kind the actor can
   actually see: defaulting to 'resources' (siaResources) unconditionally
   -- regardless of which of the three the actor is actually authorized
   for -- used to make clicking "Recursos" (or landing on it via the
   redirect below) bounce straight back out to Políticas for an actor who
   only holds pam:catalogs_read (Access Assets) but not sia:catalogs_read
   (the other two). Shares its authorization order with App.tsx's own
   top-level redirect guard via firstAuthorizedSiaResourceWorkspace, so
   the two can't drift out of sync. */
function resourceKindToOpen(preferred: ResourceKind, permissions: string[]): ResourceKind {
  if (hasWorkspaceAccess(RESOURCE_KIND_VIEWS[preferred], permissions)) return preferred;
  const fallbackView = firstAuthorizedSiaResourceWorkspace(permissions);
  const fallbackKind = (Object.keys(RESOURCE_KIND_VIEWS) as ResourceKind[]).find((kind) => RESOURCE_KIND_VIEWS[kind] === fallbackView);
  return fallbackKind ?? preferred;
}

/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.2/§9 (Fase 2): a
   single SIA destination with three tabs. Políticas/Cobertura reuse
   SiaWorkspace/ConnectionInventoryWorkspace unchanged; Recursos wraps
   the three independent resource catalogs (see sia-resources-tab.tsx).
   §6: a tab without permission never shows, and its direct route
   redirects to the first authorized tab instead of an empty pane --
   same rule App.tsx's top-level guard already applies for Identidades. */
export function SiaHubWorkspace({
  authChecked, authenticated, permissions, includeInternal, canManageAssets,
  onUnauthorized, onError, onNotice, onNavigate,
  initialSection = 'policies', initialResourceKind = 'resources', initialQuery = '',
  assetsSeed = { search: '', environment: '', coverage: '' },
}: SiaHubWorkspaceProps) {
  const sectionVisible = (id: SiaSection) => id === 'resources'
    ? (['resources', 'databaseAccounts', 'accessAssets'] as ResourceKind[]).some((kind) => hasWorkspaceAccess(RESOURCE_KIND_VIEWS[kind], permissions))
    : hasWorkspaceAccess(SECTION_VIEWS[id], permissions);
  const visibleSections = SECTION_META.filter((item) => sectionVisible(item.id));
  const sectionAllowed = visibleSections.some((item) => item.id === initialSection);
  const activeSection = sectionAllowed ? initialSection : (visibleSections[0]?.id ?? 'policies');

  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §6: an explicit
  // redirect, not a silent visual fallback -- App.tsx's own top-level
  // permission guard already redirects away from the three specific
  // resource WorkspaceViews when unauthorized, but relying on that alone
  // leaves a render where the URL still says the unauthorized route
  // while this component already shows a different (allowed) section.
  // Mirrors IdentityWorkspace's identical effect exactly.
  useEffect(() => {
    if (!sectionAllowed && visibleSections.length) onNavigate(activeSection === 'resources' ? RESOURCE_KIND_VIEWS[resourceKindToOpen(initialResourceKind, permissions)] : SECTION_VIEWS[activeSection]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionAllowed, activeSection]);

  return <section className="sia-hub-workspace" aria-label="Secure Infrastructure Access">
    <nav className="workspace-subnav" aria-label="Secciones de SIA" role="tablist" onKeyDown={handleTablistKeyDown}>
      {visibleSections.map((item) => {
        const Icon = item.icon;
        return <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={activeSection === item.id}
          tabIndex={activeSection === item.id ? 0 : -1}
          title={`Mostrar ${item.label}: ${item.detail}`}
          className={activeSection === item.id ? 'active' : ''}
          onClick={() => onNavigate(item.id === 'resources' ? RESOURCE_KIND_VIEWS[resourceKindToOpen(initialResourceKind, permissions)] : SECTION_VIEWS[item.id])}
        >
          <span className="workspace-subnav-icon" aria-hidden><Icon size={16} /></span>
          <span className="workspace-subnav-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
        </button>;
      })}
    </nav>

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
      : activeSection === 'coverage'
        ? <ConnectionInventoryWorkspace
            key={`${assetsSeed.search}:${assetsSeed.environment}:${assetsSeed.coverage}`}
            authChecked={authChecked}
            authenticated={authenticated}
            includeInternal={includeInternal}
            canManage={canManageAssets}
            initialSearch={assetsSeed.search}
            initialEnvironment={assetsSeed.environment}
            initialCoverage={assetsSeed.coverage}
            onUnauthorized={onUnauthorized}
            onError={onError}
            onNotice={onNotice}
          />
        : <SiaWorkspace
            authChecked={authChecked}
            authenticated={authenticated}
            onUnauthorized={onUnauthorized}
            onError={onError}
            onNavigate={onNavigate}
            initialQuery={initialQuery}
          />}
  </section>;
}
