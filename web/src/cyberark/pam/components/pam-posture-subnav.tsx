import { handleTablistKeyDown } from '../../../cross/lib/tablist-keyboard';
import { hasWorkspaceAccess, type WorkspaceView } from '../../../cross/lib/workspaces';
import { t } from '../../../cross/i18n/index.ts';

type Props = { activeView: WorkspaceView; permissions: string[]; onNavigate: (view: WorkspaceView) => void };

/* CA-IA-001: Postura answers "¿qué está mal y qué limpio?" with two tabs --
   Riesgos (hallazgos) and Depuración (señales de limpieza). Both keep their own
   route and permission; the tab for a view the actor cannot open is not shown. */
export function PamPostureSubnav({ activeView, permissions, onNavigate }: Props) {
  const tabs = [
    { id: 'posture' as const, label: t('Riesgos') },
    { id: 'pamCleanup' as const, label: t('Depuración') },
  ].filter((item) => hasWorkspaceAccess(item.id, permissions));
  if (tabs.length < 2) return null;
  return <nav className="workspace-subnav workspace-subnav-nested" aria-label={t('Secciones de Postura')} role="tablist" onKeyDown={handleTablistKeyDown}>
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
