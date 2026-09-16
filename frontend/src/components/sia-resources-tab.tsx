import { useEffect } from 'react';
import { Link2 } from 'lucide-react';
import { AccessAssetsWorkspace } from './access-assets-workspace';
import { SiaResourcesWorkspace } from './sia-resources-workspace';
import { SiaDatabaseAccountsWorkspace } from './sia-database-accounts-workspace';
import { handleTablistKeyDown } from '../lib/tablist-keyboard';
import { hasWorkspaceAccess, type WorkspaceView } from '../lib/workspaces';

export type ResourceKind = 'resources' | 'databaseAccounts' | 'accessAssets';

type SiaResourcesTabProps = {
  authChecked: boolean;
  authenticated: boolean;
  permissions: string[];
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNavigate: (view: WorkspaceView, query?: string) => void;
  initialResourceKind?: ResourceKind;
  initialQuery?: string;
};

const RESOURCE_META: Array<{ id: ResourceKind; label: string; detail: string }> = [
  { id: 'resources', label: 'Máquinas virtuales', detail: 'Infraestructura VM de Secure Infrastructure Access' },
  { id: 'databaseAccounts', label: 'Cuentas fuertes de BD', detail: 'Strong Accounts de base de datos SIA' },
  { id: 'accessAssets', label: 'Assets de Access', detail: 'Catálogo del Access space' },
];

const RESOURCE_VIEWS: Record<ResourceKind, WorkspaceView> = {
  resources: 'siaResources',
  databaseAccounts: 'siaDatabaseAccounts',
  accessAssets: 'accessAssets',
};

/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.2: "Recursos" groups
   three independent sources -- Strong Accounts and Access Assets no
   longer need their own top-level destination, but each keeps its own
   narrow permission (never homologated just because they now share a
   visual container, per the plan's §6). SIA connectors are already
   unified into the generic `connectors` workspace (PSM+SIA); this tab
   references that existing workspace rather than duplicating its fetch
   logic. */
export function SiaResourcesTab({ authChecked, authenticated, permissions, onUnauthorized, onError, onNavigate, initialResourceKind = 'resources', initialQuery = '' }: SiaResourcesTabProps) {
  const visibleKinds = RESOURCE_META.filter((item) => hasWorkspaceAccess(RESOURCE_VIEWS[item.id], permissions));
  const kindAllowed = visibleKinds.some((item) => item.id === initialResourceKind);
  const activeKind = kindAllowed ? initialResourceKind : (visibleKinds[0]?.id ?? 'resources');

  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §6: explicit redirect,
  // not a silent fallback -- without this, an actor missing this
  // specific resource kind's permission (e.g. pam:catalogs_read for
  // Access Assets while holding sia:catalogs_read for the other two)
  // would see a *different* resource kind's data rendered while the URL
  // and workspaceView still claimed the unauthorized one.
  useEffect(() => {
    if (!kindAllowed && visibleKinds.length) onNavigate(RESOURCE_VIEWS[activeKind]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindAllowed, activeKind]);

  return <div className="sia-resources-tab">
    <div className="sia-resources-tab-header">
      <nav className="workspace-subnav" aria-label="Tipos de recurso SIA" role="tablist" onKeyDown={handleTablistKeyDown}>
        {visibleKinds.map((item) => <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={activeKind === item.id}
          tabIndex={activeKind === item.id ? 0 : -1}
          title={`Mostrar ${item.label}: ${item.detail}`}
          className={activeKind === item.id ? 'active' : ''}
          onClick={() => onNavigate(RESOURCE_VIEWS[item.id])}
        >
          <span className="workspace-subnav-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
        </button>)}
      </nav>
      <button type="button" className="button subtle sia-resources-connectors-link" onClick={() => onNavigate('connectors')}>
        <Link2 size={14} aria-hidden /> Ver conectores SIA
      </button>
    </div>

    {activeKind === 'databaseAccounts'
      ? <SiaDatabaseAccountsWorkspace key="databaseAccounts" authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} initialQuery={initialQuery} />
      : activeKind === 'accessAssets'
        ? <AccessAssetsWorkspace key="accessAssets" authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} initialQuery={initialQuery} />
        : <SiaResourcesWorkspace key="resources" authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} initialQuery={initialQuery} />}
  </div>;
}
