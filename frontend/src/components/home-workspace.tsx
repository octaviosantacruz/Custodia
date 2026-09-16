import { ArrowRight, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { AuthStatus } from '../types/auth';
import type { WorkspaceView } from '../lib/workspaces';

type HomeWorkspaceProps = {
  authStatus: AuthStatus;
  onNavigate: (view: WorkspaceView) => void;
};

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || 'ahí';
}

export function DsHubMark() {
  return <img className="ds-hub-mark" src="/favicon.svg" alt="" />;
}

function CyberArkLogo() {
  return <span className="home-domain-logo" aria-hidden="true">
    <img className="home-domain-logo-dark" src="/cyberark-logo-dark.png" alt="" />
    <img className="home-domain-logo-white" src="/cyberark-logo-white.png" alt="" />
  </span>;
}

function NetskopeLogo() {
  return <span className="home-domain-logo" aria-hidden="true">
    <img className="home-domain-logo-dark" src="/netskope-full-black.png" alt="" />
    <img className="home-domain-logo-white" src="/netskope-full-white.png" alt="" />
  </span>;
}

function BigIdLogo() {
  return <span className="home-domain-logo" aria-hidden="true">
    <img className="home-domain-logo-dark" src="/bigid-full-black.png" alt="" />
    <img className="home-domain-logo-white" src="/bigid-full-white.png" alt="" />
  </span>;
}

export function HomeVisibilityGraphic({ monochrome = false, activeDomain = null, showAdmin = false, onCyberArkNavigate, onAdminNavigate, onActiveDomainChange }: { monochrome?: boolean; activeDomain?: 'cyberark' | null; showAdmin?: boolean; onCyberArkNavigate?: () => void; onAdminNavigate?: () => void; onActiveDomainChange?: (domain: 'cyberark' | null) => void }) {
  return <aside className={'home-visibility' + (monochrome ? ' home-visibility-monochrome' : '')} data-active-domain={activeDomain || undefined} aria-label="Fuentes de visibilidad de DS Hub">
    <div className="home-visibility-line home-visibility-line-one" />
    <div className="home-visibility-line home-visibility-line-two" />
    <div className="home-visibility-line home-visibility-line-three" />
    <button className="home-visibility-node home-visibility-node-cyberark" type="button" aria-label="Abrir CyberArk PAM" title="Abrir métricas e inventario de CyberArk PAM" onClick={onCyberArkNavigate} onMouseEnter={() => onActiveDomainChange?.('cyberark')} onMouseLeave={() => onActiveDomainChange?.(null)} onFocus={() => onActiveDomainChange?.('cyberark')} onBlur={() => onActiveDomainChange?.(null)}><CyberArkLogo /></button>
    <div className="home-visibility-node home-visibility-node-netskope"><NetskopeLogo /></div>
    <div className="home-visibility-node home-visibility-node-bigid"><BigIdLogo /></div>
    {showAdmin && <button className="home-visibility-core home-visibility-core-admin" type="button" aria-label="Abrir Administración" title="Administrar usuarios, roles y permisos de DS Hub" onClick={onAdminNavigate}><span className="home-visibility-core-icon"><SlidersHorizontal size={22} /></span><span>Admin</span></button>}
    {!showAdmin && <div className="home-visibility-core"><DsHubMark /><span>DS Hub</span></div>}
  </aside>;
}

export function HomeWorkspace({ authStatus, onNavigate }: HomeWorkspaceProps) {
  const [activeDomain, setActiveDomain] = useState<'cyberark' | null>(null);
  const canManageAccess = authStatus.permissions?.includes('access:manage') === true;

  return <main className="home-workspace">
    <section className="home-content" aria-labelledby="home-title">
      <div className="home-mark home-reveal"><DsHubMark /></div>
      <p className="eyebrow home-reveal">DS HUB</p>
      <h1 id="home-title" className="home-title-reveal"><span className="home-greeting-script">Hola,</span> <span className="home-greeting-name">{firstName(authStatus.user?.name)}</span></h1>
      <p className="home-copy home-reveal">¿Qué querés revisar hoy?</p>
      <div className="home-actions home-reveal">
        <button className={'home-domain-button' + (activeDomain === 'cyberark' ? ' is-active' : '')} type="button" title="Abrir métricas, inventario y gobierno de CyberArk PAM" onClick={() => onNavigate('general')} onMouseEnter={() => setActiveDomain('cyberark')} onMouseLeave={() => setActiveDomain(null)} onFocus={() => setActiveDomain('cyberark')} onBlur={() => setActiveDomain(null)}>
          <span className="home-domain-icon"><CyberArkLogo /></span>
          <span><strong>CyberArk PAM</strong><small>Inventario y gobierno de accesos</small></span>
          <ArrowRight size={18} />
        </button>
        <div className="home-domain-button home-domain-button-disabled" aria-disabled="true">
          <span className="home-domain-icon"><NetskopeLogo /></span>
          <span><strong>Netskope DLP</strong><small>Protección y gobierno de datos</small></span>
          <small className="home-domain-status">Próximamente</small>
        </div>
        <div className="home-domain-button home-domain-button-disabled" aria-disabled="true">
          <span className="home-domain-icon"><BigIdLogo /></span>
          <span><strong>BigID DSPM</strong><small>Descubrimiento y postura de datos</small></span>
          <small className="home-domain-status">Próximamente</small>
        </div>
      </div>
    </section>
    <HomeVisibilityGraphic activeDomain={activeDomain} showAdmin={canManageAccess} onActiveDomainChange={setActiveDomain} onCyberArkNavigate={() => onNavigate('general')} onAdminNavigate={() => onNavigate('users')} />
  </main>;
}
