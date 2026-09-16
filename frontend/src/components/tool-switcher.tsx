import type { ReactNode } from 'react';
import {
  DatabaseZap, FileLock2, Home, KeyRound, SlidersHorizontal, Wrench,
} from 'lucide-react';
import { usePopover } from '../hooks/use-popover';
import {
  domainAccessible, domainLanding, domainOf, domains, domainWorkspaces, type Domain,
} from '../lib/domains';
import { hasWorkspaceAccess, type WorkspaceView } from '../lib/workspaces';

type ToolSwitcherProps = {
  isHome?: boolean;
  workspaceView: WorkspaceView;
  permissions: string[];
  onWorkspaceChange: (view: WorkspaceView) => void;
  onHome: () => void;
};

const TOOL_META: Record<Domain, { label: string; detail: string; icon: ReactNode }> = {
  admin: { label: 'Administración', detail: 'Usuarios y actividad de DS Hub', icon: <SlidersHorizontal size={18} /> },
  pam: { label: 'CyberArk PAM', detail: 'Accesos privilegiados', icon: <KeyRound size={18} /> },
  dlp: { label: 'Netskope DLP', detail: 'Prevención de fuga de datos', icon: <FileLock2 size={18} /> },
  dspm: { label: 'BigID DSPM', detail: 'Postura de seguridad de datos', icon: <DatabaseZap size={18} /> },
};

export function ToolSwitcher({ isHome = false, workspaceView, permissions, onWorkspaceChange, onHome }: ToolSwitcherProps) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const activeDomain = domainOf(workspaceView);
  const current = isHome ? null : TOOL_META[activeDomain];
  const workspaceVisible = (view: WorkspaceView) => hasWorkspaceAccess(view, permissions);
  const visibleDomains = domains.filter((domain) =>
    domain.status === 'coming-soon'
      || (domainAccessible(domain.id, permissions) && domainWorkspaces(domain.id).some(workspaceVisible)),
  );

  const pickDomain = (domain: Domain) => {
    const landing = domainWorkspaces(domain).find(workspaceVisible) ?? domainLanding(domain);
    onWorkspaceChange(landing);
    setOpen(false);
  };

  const goHome = () => {
    onHome();
    setOpen(false);
  };

  return <div className="tool-launcher" ref={ref}>
    <button
      className={'tool-switcher-trigger' + (open ? ' active' : '')}
      type="button"
      aria-label={`Cambiar herramienta. Actual: ${current?.label || 'Inicio'}`}
      aria-expanded={open}
      title="Cambiar herramienta"
      onClick={() => setOpen((value) => !value)}
    >
      <Wrench size={16} aria-hidden />
      <span>{current?.label || 'Inicio'}</span>
    </button>
    {open ? <section className="tool-menu" aria-label="Herramientas">
      <div className="tool-menu-header">
        <strong>Herramientas</strong>
        <span>Elegí el producto que querés revisar.</span>
      </div>
      <button
        className={'tool-menu-home' + (isHome ? ' active' : '')}
        type="button"
        aria-current={isHome ? 'page' : undefined}
        onClick={goHome}
      >
        <span className="tool-menu-icon"><Home size={18} aria-hidden /></span>
        <span className="tool-menu-copy"><strong>Inicio</strong><small>Resumen general de DS Hub</small></span>
      </button>
      <div className="tool-menu-grid">
        {visibleDomains.map((domain) => {
          const meta = TOOL_META[domain.id];
          const soon = domain.status === 'coming-soon';
          const active = !isHome && domain.id === activeDomain;
          return <button
            key={domain.id}
            className={'tool-menu-item' + (active ? ' active' : '')}
            type="button"
            aria-current={active ? 'page' : undefined}
            disabled={soon}
            title={soon ? `${meta.label}: disponible próximamente` : `Abrir ${meta.label}`}
            onClick={() => pickDomain(domain.id)}
          >
            <span className="tool-menu-icon">{meta.icon}</span>
            <span className="tool-menu-copy"><strong>{meta.label}</strong><small>{meta.detail}</small></span>
            {soon ? <span className="tool-menu-status">Próximamente</span> : null}
          </button>;
        })}
      </div>
    </section> : null}
  </div>;
}
