import { Database, Server, Boxes } from 'lucide-react';
import { handleTablistKeyDown } from '../lib/tablist-keyboard';
import { firstAuthorizedPamInfraWorkspace, hasWorkspaceAccess, PAM_INFRA_WORKSPACE_ORDER, type WorkspaceView } from '../lib/workspaces';

type PamInfraSubnavProps = {
  activeView: WorkspaceView;
  permissions: string[];
  onNavigate: (view: WorkspaceView, query?: string) => void;
};

/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.3/§9 (Fase 3):
   groups Safes, "Plataformas y cuentas" and "Infraestructura PAM"
   (conectores/salud/AIM) as internal navigation, purely additive.
   Unlike the Identity/SIA hubs, this does NOT collapse or remove any
   of platforms/connectors/pamHealth from the switcher
   -- the plan explicitly requires validating with users before
   retiring those destinations, so they stay reachable both from here
   and from the switcher/command center exactly as before. This
   component only renders an additional quick-jump row; App.tsx's
   existing render blocks and permission gates for each workspace are
   untouched. */
export function PamInfraSubnav({ activeView, permissions, onNavigate }: PamInfraSubnavProps) {
  const infraVisible = PAM_INFRA_WORKSPACE_ORDER.some((view) => hasWorkspaceAccess(view, permissions));
  const platformsVisible = hasWorkspaceAccess('platforms', permissions);
  const infraActive = (PAM_INFRA_WORKSPACE_ORDER as readonly WorkspaceView[]).includes(activeView);

  // Nothing to add beyond the plain "Safes" screen when the actor can't
  // reach any of the technical catalogs -- a lone tab has no value.
  if (!platformsVisible && !infraVisible) return null;

  const infraTargets = [
    { id: 'connectors' as const, label: 'Conectores', icon: Server },
    { id: 'pamHealth' as const, label: 'Salud PAM', icon: Boxes },
  ].filter((item) => hasWorkspaceAccess(item.id, permissions));

  return <div className="pam-infra-subnav">
    <nav className="workspace-subnav" aria-label="Navegación de Safes e infraestructura PAM" role="tablist" onKeyDown={handleTablistKeyDown}>
      <button
        type="button"
        role="tab"
        aria-selected={activeView === 'safes'}
        tabIndex={activeView === 'safes' ? 0 : -1}
        title="Mostrar Safes: inventario y clasificación"
        className={activeView === 'safes' ? 'active' : ''}
        onClick={() => onNavigate('safes')}
      >
        <span className="workspace-subnav-icon" aria-hidden><Database size={16} /></span>
        <span className="workspace-subnav-copy"><strong>Safes</strong><small>Inventario y clasificación</small></span>
      </button>
      {platformsVisible && <button
        type="button"
        role="tab"
        aria-selected={activeView === 'platforms'}
        tabIndex={activeView === 'platforms' ? 0 : -1}
        title="Mostrar Plataformas y cuentas: Safes y cuentas por plataforma PAM"
        className={activeView === 'platforms' ? 'active' : ''}
        onClick={() => onNavigate('platforms')}
      >
        <span className="workspace-subnav-icon" aria-hidden><Server size={16} /></span>
        <span className="workspace-subnav-copy"><strong>Plataformas y cuentas</strong><small>Safes y cuentas por plataforma PAM</small></span>
      </button>}
      {infraVisible && <button
        type="button"
        role="tab"
        aria-selected={infraActive}
        tabIndex={infraActive ? 0 : -1}
        title="Mostrar Infraestructura PAM: conectores y salud PAM"
        className={infraActive ? 'active' : ''}
        onClick={() => {
          const target = firstAuthorizedPamInfraWorkspace(permissions);
          if (target) onNavigate(target);
        }}
      >
        <span className="workspace-subnav-icon" aria-hidden><Boxes size={16} /></span>
        <span className="workspace-subnav-copy"><strong>Infraestructura PAM</strong><small>Conectores y salud PAM</small></span>
      </button>}
    </nav>
    {infraActive && infraTargets.length > 1 && <nav className="workspace-subnav workspace-subnav-nested" aria-label="Secciones de infraestructura PAM" role="tablist" onKeyDown={handleTablistKeyDown}>
      {infraTargets.map((item) => <button
        key={item.id}
        type="button"
        role="tab"
        aria-selected={activeView === item.id}
        tabIndex={activeView === item.id ? 0 : -1}
        className={activeView === item.id ? 'active' : ''}
        onClick={() => onNavigate(item.id)}
      >
        <strong>{item.label}</strong>
      </button>)}
    </nav>}
  </div>;
}
