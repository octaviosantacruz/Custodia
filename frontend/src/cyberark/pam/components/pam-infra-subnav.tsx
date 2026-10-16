import { Database, Server } from 'lucide-react';
import { handleTablistKeyDown } from '../../../cross/lib/tablist-keyboard';
import { hasWorkspaceAccess, type WorkspaceView } from '../../../cross/lib/workspaces';

type PamInfraSubnavProps = {
  activeView: WorkspaceView;
  permissions: string[];
  onNavigate: (view: WorkspaceView, query?: string) => void;
};

/* CA-IA-001: Safes and Plataformas y cuentas are the only two tabs here; the
   service views (Salud, Conectores) moved to Servicio (PamServiceSubnav). */
export function PamInfraSubnav({ activeView, permissions, onNavigate }: PamInfraSubnavProps) {
  // A lone "Safes" tab has no value when Plataformas is out of reach.
  if (!hasWorkspaceAccess('platforms', permissions)) return null;
  const platformsVisible = true;

  return <div className="pam-infra-subnav">
    <nav className="workspace-subnav" aria-label="Safes y plataformas" role="tablist" onKeyDown={handleTablistKeyDown}>
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
    </nav>
  </div>;
}
