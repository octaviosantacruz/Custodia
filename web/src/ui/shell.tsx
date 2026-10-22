import type { ReactNode } from 'react';
import { company, type SourceMode } from '../model/company.ts';
import { MODE_LABEL, SOURCES, sourceRun, type SourceKey } from '../model/view.ts';
import { Seal, Wordmark } from './identity.tsx';
import { Link, navigate, useApp, useLocation } from './router.tsx';

type NavItem = { to: string; label: string; icon?: string };
const CROSS: NavItem[] = [
  { to: '/', label: 'Resumen', icon: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z' },
  { to: '/personas', label: 'Personas', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0' },
];
/** Lo que dice cada herramienta, agrupado por fuente: el sello es el encabezado. */
const TOOLS: { source: SourceKey; items: NavItem[] }[] = [
  { source: 'pam', items: [
    { to: '/cyberark/identidades', label: 'Identidades' }, { to: '/cyberark/roles', label: 'Roles' },
    { to: '/cyberark/safes', label: 'Safes' }, { to: '/cyberark/cuentas', label: 'Cuentas' }, { to: '/cyberark/plataformas', label: 'Plataformas' },
  ] },
  { source: 'sse', items: [
    { to: '/netskope/usuarios', label: 'Usuarios' }, { to: '/netskope/equipos', label: 'Equipos' }, { to: '/netskope/versiones', label: 'Versiones de cliente' },
  ] },
];
const SOURCES_ITEM: NavItem = { to: '/fuentes', label: 'Fuentes', icon: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' };

function Freshness({ source }: { source: SourceKey }) {
  const { mode } = useApp();
  const run = sourceRun(source, mode);
  return <span className={`freshness is-${run.freshness}`}>{run.freshness === 'fresh' ? 'al día' : run.freshness === 'stale' ? '73 h' : 'parcial'}</span>;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link to={item.to} className={`nav-item${item.icon ? '' : ' is-sub'}`} aria-current={active ? 'page' : undefined}>
      {item.icon && <Icon d={item.icon} />}{item.label}
    </Link>
  );
}

function Icon({ d }: { d: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

const capturedAt = new Date(company.capturedAt).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

export function Shell({ title, lede, actions, children }: { title: string; lede?: string; actions?: ReactNode; children: ReactNode }) {
  const { path } = useLocation();
  const { mode, setMode, signOut } = useApp();
  const active = (to: string) => to === '/' ? path === '/' : path === to || path.startsWith(to + '/');

  return (
    <div className="shell">
      <a className="skip-link" href="#contenido" onClick={event => { event.preventDefault(); document.getElementById('contenido')?.focus(); }}>Saltar al contenido</a>
      <aside className="sidebar">
        <Link to="/" className="sidebar-brand" aria-label="Custodia, inicio"><Wordmark /></Link>

        <div className="tenant">
          <span className="tenant-avatar" aria-hidden="true">{company.name.split(" ").map(word => word[0]).join("")}</span>
          <span><strong>{company.name}</strong><small>Empresa ficticia · sólo lectura</small></span>
        </div>

        <nav aria-label="Principal" className="nav">
          <p className="nav-group label">Cruces</p>
          {CROSS.map(item => <NavLink key={item.to} item={item} active={active(item.to)} />)}
          {TOOLS.map(group => (
            <div key={group.source} className="nav-tool" data-src={group.source}>
              <p className="nav-group">
                <Seal source={group.source} label="product" />
                <Freshness source={group.source} />
              </p>
              {group.items.map(item => <NavLink key={item.to} item={item} active={active(item.to)} />)}
            </div>
          ))}
          <p className="nav-group label">Plataforma</p>
          <NavLink item={SOURCES_ITEM} active={active(SOURCES_ITEM.to)} />
        </nav>


        <div className="sidebar-foot">
          <Link to="/sistema" className="nav-item is-quiet" aria-current={active('/sistema') ? 'page' : undefined}>Sistema visual</Link>
          <button type="button" className="nav-item is-quiet" onClick={() => { signOut(); navigate('/entrar'); }}>Salir de la demo</button>
        </div>
      </aside>

      <div className="stage">
        <header className="topbar">
          <div className="capture">
            <span className="label">Captura</span>
            <span className="data">{capturedAt} UTC</span>
          </div>
          <label className="scenario">
            <span className="label">Escenario de {SOURCES.sse.product}</span>
            <select value={mode} onChange={event => setMode(event.target.value as SourceMode)}>
              {(Object.keys(MODE_LABEL) as SourceMode[]).map(key => <option key={key} value={key}>{MODE_LABEL[key]}</option>)}
            </select>
          </label>
        </header>

        {mode !== 'complete' && (
          <div className="notice" role="status">
            <strong>Captura de {SOURCES.sse.product} {mode === 'stale' ? 'desactualizada' : 'parcial'}.</strong>{' '}
            Los registros observados se muestran, pero ninguna conclusión de cobertura se afirma: todo veredicto queda desconocido.
          </div>
        )}

        <main id="contenido" className="page" tabIndex={-1}>
          <header className="page-head">
            <div>
              <h1>{title}</h1>
              {lede && <p className="lede">{lede}</p>}
            </div>
            {actions}
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
