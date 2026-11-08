import { WORKSPACE_TOOL_LABELS } from '../../sources';
import { Home, SlidersHorizontal, Waypoints, type LucideIcon } from 'lucide-react';
import { usePopover } from '../hooks/use-popover';
import {
  areaOf, domainAccessible, domainLanding, domainMeta, domains, domainWorkspaces, firstAccessibleDomainWorkspace, type Domain,
} from '../lib/domains';
import { hasWorkspaceAccess, type WorkspaceView } from '../lib/workspaces';
import { t } from '../i18n/index.ts';

type ToolSwitcherProps = {
  isHome?: boolean;
  workspaceView: WorkspaceView;
  permissions: string[];
  onWorkspaceChange: (view: WorkspaceView) => void;
  onHome: () => void;
};

/* Vendor tools show their own mark (one image per theme); Custodia's own views keep an icon. */
type ToolLogo = { dark: string; selectedDark?: string; light: string };
type ToolMeta = { label: string; detail: string } & ({ icon: LucideIcon; logo?: never } | { logo: ToolLogo; icon?: never });

const TOOL_META: Record<Domain, ToolMeta> = {
  cross: { label: t('Conexiones'), detail: t('Alcance de cada persona en las herramientas'), icon: Waypoints },
  admin: { label: t('Administración'), detail: t('Usuarios, permisos y actividad'), icon: SlidersHorizontal },
  pam: { label: domainMeta('pam').product.label, detail: domainMeta('pam').product.description, logo: { dark: '/cyberark-logo-lime.png', selectedDark: '/cyberark-logo-white.png', light: '/cyberark-logo-dark.png' } },
  dlp: { label: domainMeta('dlp').product.label, detail: domainMeta('dlp').product.description, logo: { dark: '/netskope-full-lime.png', selectedDark: '/netskope-full-white.png', light: '/netskope-full-black.png' } },
  dspm: { label: t('BigID DSPM'), detail: t('Descubrimiento y postura de seguridad de datos'), logo: { dark: '/bigid-full-white.png', light: '/bigid-full-black.png' } },
};

/** The launcher names the platform only; the tool inside it is shown by the workspace switcher next to it. */
const PLATFORM_LABELS: Partial<Record<Domain, string>> = { pam: 'CyberArk', dlp: 'Netskope' };

function ToolMark({ meta, size, selected = false }: { meta: ToolMeta | null; size: number; selected?: boolean }) {
  if (meta?.logo) {
    return <span className="tool-logo" aria-hidden="true" data-tool-logo={meta.label}>
      <img className="tool-logo-dark" src={selected ? (meta.logo.selectedDark ?? meta.logo.dark) : meta.logo.dark} alt="" />
      <img className="tool-logo-light" src={meta.logo.light} alt="" />
    </span>;
  }
  const Icon = meta?.icon ?? Home;
  return <Icon size={size} aria-hidden />;
}

export function ToolSwitcher({ isHome = false, workspaceView, permissions, onWorkspaceChange, onHome }: ToolSwitcherProps) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const activeDomain = areaOf(workspaceView);
  const current = isHome ? null : { ...TOOL_META[activeDomain], label: PLATFORM_LABELS[activeDomain] ?? WORKSPACE_TOOL_LABELS[workspaceView] };
  const workspaceVisible = (view: WorkspaceView) => hasWorkspaceAccess(view, permissions);
  const visibleDomains = domains.filter((domain) =>
    domain.status === 'coming-soon'
      || (domainAccessible(domain.id, permissions) && domainWorkspaces(domain.id).some(workspaceVisible)),
  );

  const pickDomain = (domain: Domain) => {
    const landing = firstAccessibleDomainWorkspace(domain, permissions) ?? domainLanding(domain);
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
      aria-label={t('Cambiar herramienta. Actual: {name}', { name: current?.label || t('Inicio') })}
      aria-expanded={open}
      title={t('Cambiar herramienta')}
      onClick={() => setOpen((value) => !value)}
    >
      <ToolMark meta={current} size={16} selected />
      <span>{current?.label || t('Inicio')}</span>
    </button>
    {open ? <section className="tool-menu" aria-label={t('Herramientas')}>
      <div className="tool-menu-header">
        <strong>{t('Herramientas')}</strong>
        <span>{t('Elegí qué querés revisar.')}</span>
      </div>
      <button
        className={'tool-menu-home' + (isHome ? ' active' : '')}
        type="button"
        aria-current={isHome ? 'page' : undefined}
        onClick={goHome}
      >
        <span className="tool-menu-icon"><Home size={18} aria-hidden /></span>
        <span className="tool-menu-copy"><strong>{t('Inicio')}</strong><small>{t('Resumen general de Custodia')}</small></span>
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
            aria-disabled={soon ? true : undefined}
            title={soon ? `${meta.label}: disponible próximamente` : `Abrir ${meta.label}`}
            onClick={() => { if (!soon) pickDomain(domain.id); }}
          >
            <span className="tool-menu-icon"><ToolMark meta={meta} size={18} /></span>
            <span className="tool-menu-copy"><strong>{meta.label}</strong><small>{meta.detail}</small></span>
            {soon ? <span className="tool-menu-status">{t('Próximamente')}</span> : null}
          </button>;
        })}
      </div>
    </section> : null}
  </div>;
}
