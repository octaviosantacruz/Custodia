import { handleTablistKeyDown } from '../../../cross/lib/tablist-keyboard';
import { hasWorkspaceAccess, type WorkspaceView } from '../../../cross/lib/workspaces';

type Props = { activeView: WorkspaceView; permissions: string[]; onNavigate: (view: WorkspaceView) => void };

/* CA-IA-001: Servicio answers "¿está sano PAM y SIA?" with two tabs, Salud and
   Conectores. Both keep their route and permission. */
export function PamServiceSubnav({ activeView, permissions, onNavigate }: Props) {
  const tabs = [
    { id: 'pamHealth' as const, label: 'Salud' },
    { id: 'connectors' as const, label: 'Conectores' },
  ].filter((item) => hasWorkspaceAccess(item.id, permissions));
  if (tabs.length < 2) return null;
  return <nav className="workspace-subnav workspace-subnav-nested" aria-label="Secciones de Servicio" role="tablist" onKeyDown={handleTablistKeyDown}>
    {tabs.map((item) => <button
      key={item.id}
      type="button"
      role="tab"
      aria-selected={activeView === item.id}
      tabIndex={activeView === item.id ? 0 : -1}
      className={activeView === item.id ? 'active' : ''}
      onClick={() => onNavigate(item.id)}
    ><strong>{item.label}</strong></button>)}
  </nav>;
}
