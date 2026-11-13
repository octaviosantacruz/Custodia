import { useEffect } from 'react';
import { Link2 } from 'lucide-react';
import { SiaResourcesWorkspace } from '../../sia/components/sia-resources-workspace';
import { SiaDatabaseAccountsWorkspace } from '../../sia/components/sia-database-accounts-workspace';
import { hasWorkspaceAccess, type WorkspaceView } from '../../../cross/lib/workspaces';
import { t } from '../../../cross/i18n/index.ts';

export type ResourceKind = 'resources' | 'databaseAccounts';

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

export const RESOURCE_META: Array<{ id: ResourceKind; label: string; detail: string }> = [
  { id: 'resources', label: t('Máquinas virtuales SIA'), detail: t('Equipos disponibles en la infraestructura SIA') },
  { id: 'databaseAccounts', label: t('Cuentas de base de datos'), detail: t('Strong Accounts administradas por SIA') },
];

export const RESOURCE_VIEWS: Record<ResourceKind, WorkspaceView> = {
  resources: 'siaResources',
  databaseAccounts: 'siaDatabaseAccounts',
};

/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.2: "Recursos" groups
   the SIA virtual machines and Strong Accounts; each keeps its own narrow
   permission (never homologated just because they share a visual
   container, per the plan's §6). Target sets and Access assets are no
   longer shown (2026-10-10). SIA connectors are already
   unified into the generic `connectors` workspace (PSM+SIA); this tab
   references that existing workspace rather than duplicating its fetch
   logic. */
export function SiaResourcesTab({ authChecked, authenticated, permissions, onUnauthorized, onError, onNavigate, initialResourceKind = 'resources', initialQuery = '' }: SiaResourcesTabProps) {
  const visibleKinds = RESOURCE_META.filter((item) => hasWorkspaceAccess(RESOURCE_VIEWS[item.id], permissions));
  const kindAllowed = visibleKinds.some((item) => item.id === initialResourceKind);
  const activeKind = kindAllowed ? initialResourceKind : (visibleKinds[0]?.id ?? 'resources');

  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §6: explicit redirect,
  // not a silent fallback -- without this, an actor missing this
  // specific resource kind's permission would see a *different* resource kind's data rendered while the URL
  // and workspaceView still claimed the unauthorized one.
  useEffect(() => {
    if (!kindAllowed && visibleKinds.length) onNavigate(RESOURCE_VIEWS[activeKind]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the redirect depends only on the permission state; onNavigate and visibleKinds are re-created each render
  }, [kindAllowed, activeKind]);

  const connectorsLink = <button type="button" className="button subtle sia-resources-connectors-link" onClick={() => onNavigate('connectors')}>
    <Link2 size={14} aria-hidden /> Ver conectores SIA
  </button>;

  return <div className="sia-resources-tab">
    {activeKind === 'databaseAccounts'
      ? <SiaDatabaseAccountsWorkspace key="databaseAccounts" authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} initialQuery={initialQuery} headerActions={connectorsLink} />
      : <SiaResourcesWorkspace key="resources" authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} initialQuery={initialQuery} headerActions={connectorsLink} />}
  </div>;
}
