import { useState, useRef } from 'react';
import { BookOpen, ChevronDown, History, LogOut, Moon, RefreshCw, Repeat2, Sun, UserCircle, Users } from 'lucide-react';
import { AccountProfileModal } from './account-profile-modal';
import { usePopover } from '../hooks/use-popover';
import { logout } from '../lib/api';
import { primaryRoleLabel } from '../lib/auth-role-label';
import { hasWorkspaceAccess, type WorkspaceView } from '../lib/workspaces';
import type { AuthStatus } from '../types/auth';
import './profile-menu.css';

type ProfileMenuProps = {
  authStatus: AuthStatus;
  theme: 'dark' | 'light';
  onThemeChange: () => void;
  onRefreshData: () => void;
  refreshSource: 'netskope' | 'cyberark' | 'all';
  refreshBusy: boolean;
  canSync: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onNavigate: (view: WorkspaceView) => void;
  onLoggedOut: () => void;
  onProfileUpdated: (name: string) => void;
};

export function ProfileMenu({ authStatus, theme, onThemeChange, onRefreshData, refreshSource, refreshBusy, canSync, onError, onNotice, onNavigate, onLoggedOut, onProfileUpdated }: ProfileMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, setOpen, ref } = usePopover<HTMLDivElement>({ fallbackFocusRef: triggerRef });
  const [accountOpen, setAccountOpen] = useState(false);
  const name = authStatus.user?.name || authStatus.user?.email?.split('@')[0] || 'Usuario';
  const email = authStatus.user?.email || '';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';
  const permissions = authStatus.permissions ?? [];
  const adminViews = (['users', 'activity'] as const).filter((view) => hasWorkspaceAccess(view, permissions));
  const ADMIN_ENTRIES = { users: { label: 'Usuarios y permisos', title: 'Administrar usuarios, roles y permisos de Custodia', icon: Users }, activity: { label: 'Actividad', title: 'Auditoría, sincronizaciones y errores', icon: History } } as const;
  const goTo = (view: WorkspaceView) => { setOpen(false); onNavigate(view); };
  const endSession = async () => {
    setOpen(false);
    const loggedOut = await logout();
    onLoggedOut();
    if (!loggedOut) onError('La sesión local se cerró, pero no se pudo confirmar el cierre en el servidor.');
  };

  return <div className="profile-wrap" ref={ref}>
    <button ref={triggerRef} className={'profile-trigger ' + (open ? 'active' : '')} type="button" aria-label="Abrir menú de usuario" title="Ver cuenta, rol y opciones de sesión" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className="profile-avatar">{initials}</span><span className="profile-trigger-copy"><strong>{name}</strong><small>{primaryRoleLabel(authStatus)}</small></span><ChevronDown size={14} />
    </button>
    {open && <section className="profile-menu" aria-label="Menú de usuario">
      <div className="profile-menu-heading"><UserCircle size={17} /><div><strong>{name}</strong><span>{email}</span></div></div>
      <div className="profile-menu-divider" />
      <span className="profile-menu-label">Preferencias</span>
      <button className="profile-menu-action profile-menu-preference" type="button" aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} onClick={onThemeChange} title={theme === 'dark' ? 'Usar la apariencia clara' : 'Usar la apariencia oscura'}>
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}<span><strong>Apariencia</strong><small>{theme === 'dark' ? 'Oscura' : 'Clara'}</small></span>
      </button>
      {canSync && <button className="profile-menu-action profile-menu-preference" type="button" disabled={refreshBusy} title={refreshSource === 'netskope' ? 'Actualizar sólo Netskope' : refreshSource === 'cyberark' ? 'Actualizar sólo las fuentes CyberArk configuradas' : 'Actualizar todas las fuentes configuradas'} onClick={() => { setOpen(false); onRefreshData(); }}>
        <RefreshCw size={15} className={refreshBusy ? 'spin' : ''} /><span><strong>{refreshBusy ? 'Actualizando datos…' : refreshSource === 'netskope' ? 'Actualizar Netskope' : 'Actualizar datos'}</strong><small>{refreshBusy ? 'La sincronización está en curso' : refreshSource === 'netskope' ? 'Sólo Netskope' : refreshSource === 'cyberark' ? 'Sólo fuentes CyberArk · revisar cambios' : 'Todas las fuentes · revisar cambios'}</small></span>
      </button>}
      {adminViews.length > 0 && <>
        <div className="profile-menu-divider profile-menu-section-divider" />
        <span className="profile-menu-label">Administración</span>
        {adminViews.map((view) => {
          const entry = ADMIN_ENTRIES[view];
          const Icon = entry.icon;
          return <button key={view} className="profile-menu-action" type="button" title={entry.title} onClick={() => goTo(view)}><Icon size={15} /> {entry.label}</button>;
        })}
      </>}
      <div className="profile-menu-divider profile-menu-section-divider" />
      <span className="profile-menu-label">Cuenta</span>
      <button className="profile-menu-action" type="button" title="Guías de uso e interpretación de datos" onClick={() => goTo('help')}><BookOpen size={15} /> Ayuda</button>
      <button className="profile-menu-action" type="button" title="Editar tu nombre o cambiar tu contraseña" onClick={() => { setOpen(false); setAccountOpen(true); }}><UserCircle size={15} /> Mi cuenta</button>
      {authStatus.mode === 'local' && <button className="profile-menu-action" type="button" title="Cerrar la sesión actual y acceder con otra cuenta" onClick={() => void endSession()}><Repeat2 size={15} /> Cambiar cuenta</button>}
      <button className="profile-menu-action danger" type="button" title="Finalizar la sesión en Custodia" onClick={() => void endSession()}><LogOut size={15} /> Cerrar sesión</button>
    </section>}
    {accountOpen && <AccountProfileModal authStatus={authStatus} onClose={() => setAccountOpen(false)} onNotice={onNotice} onProfileUpdated={onProfileUpdated} fallbackFocusRef={triggerRef} />}
  </div>;
}
