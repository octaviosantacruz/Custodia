import { useState } from 'react';
import { ChevronDown, LogOut, Moon, Repeat2, Shield, Sun, UserCircle } from 'lucide-react';
import { AccountProfileModal } from './account-profile-modal';
import { usePopover } from '../hooks/use-popover';
import { logout } from '../lib/api';
import { primaryRoleLabel } from '../lib/auth-role-label';
import type { AuthStatus } from '../types/auth';

type ProfileMenuProps = {
  authStatus: AuthStatus;
  theme: 'dark' | 'light';
  onThemeChange: () => void;
  showInternalScope: boolean;
  includeInternalMetrics: boolean;
  onIncludeInternalMetricsChange: (value: boolean) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onLoggedOut: () => void;
  onProfileUpdated: (name: string) => void;
};

export function ProfileMenu({ authStatus, theme, onThemeChange, showInternalScope, includeInternalMetrics, onIncludeInternalMetricsChange, onError, onNotice, onLoggedOut, onProfileUpdated }: ProfileMenuProps) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const [accountOpen, setAccountOpen] = useState(false);
  const name = authStatus.user?.name || authStatus.user?.email?.split('@')[0] || 'Usuario';
  const email = authStatus.user?.email || '';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';
  const endSession = async () => {
    setOpen(false);
    const loggedOut = await logout();
    onLoggedOut();
    if (!loggedOut) onError('La sesión local se cerró, pero no se pudo confirmar el cierre en el servidor.');
  };

  return <div className="profile-wrap" ref={ref}>
    <button className={'profile-trigger ' + (open ? 'active' : '')} type="button" aria-label="Abrir menú de usuario" title="Ver cuenta, rol y opciones de sesión" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className="profile-avatar">{initials}</span><span className="profile-trigger-copy"><strong>{name}</strong><small>{primaryRoleLabel(authStatus)}</small></span><ChevronDown size={14} />
    </button>
    {open && <section className="profile-menu" aria-label="Menú de usuario">
      <div className="profile-menu-heading"><UserCircle size={17} /><div><strong>{name}</strong><span>{email}</span></div></div>
      <div className="profile-menu-divider" />
      <span className="profile-menu-label">Preferencias</span>
      <button className="profile-menu-action profile-menu-preference" type="button" aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} onClick={onThemeChange} title={theme === 'dark' ? 'Usar la apariencia clara' : 'Usar la apariencia oscura'}>
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}<span><strong>Apariencia</strong><small>{theme === 'dark' ? 'Oscura' : 'Clara'}</small></span>
      </button>
      {showInternalScope && <label className="profile-menu-action profile-menu-preference" title="Afecta indicadores, gráficos, objetivos, Postura y Cadenas.">
        <Shield size={15} /><span><strong>Incluir internos</strong><small>Safes internos de CyberArk</small></span><input className="profile-menu-switch" type="checkbox" role="switch" aria-label="Incluir internos CyberArk" checked={includeInternalMetrics} onChange={(event) => onIncludeInternalMetricsChange(event.target.checked)} />
      </label>}
      <div className="profile-menu-divider profile-menu-section-divider" />
      <span className="profile-menu-label">Cuenta</span>
      <button className="profile-menu-action" type="button" title="Editar tu nombre o cambiar tu contraseña" onClick={() => { setOpen(false); setAccountOpen(true); }}><UserCircle size={15} /> Mi cuenta</button>
      {authStatus.mode === 'local' && <button className="profile-menu-action" type="button" title="Cerrar la sesión actual y acceder con otra cuenta" onClick={() => void endSession()}><Repeat2 size={15} /> Cambiar cuenta</button>}
      <button className="profile-menu-action danger" type="button" title="Finalizar la sesión en DS Hub" onClick={() => void endSession()}><LogOut size={15} /> Cerrar sesión</button>
    </section>}
    {accountOpen && <AccountProfileModal authStatus={authStatus} onClose={() => setAccountOpen(false)} onNotice={onNotice} onProfileUpdated={onProfileUpdated} />}
  </div>;
}
