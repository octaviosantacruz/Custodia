import { useState, useRef } from 'react';
import { BookOpen, ChevronDown, History, Languages, LogOut, Moon, RefreshCw, Repeat2, Sun, UserCircle, Users } from 'lucide-react';
import { AccountProfileModal } from './account-profile-modal';
import { usePopover } from '../hooks/use-popover';
import { logout } from '../lib/api';
import { primaryRoleLabel } from '../lib/auth-role-label';
import { hasWorkspaceAccess, type WorkspaceView } from '../lib/workspaces';
import type { AuthStatus } from '../types/auth';
import './profile-menu.css';
import { locale, setLocale, t } from '../i18n/index.ts';

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
  const ADMIN_ENTRIES = { users: { label: t('Usuarios y permisos'), title: t('Administrar usuarios, roles y permisos de Custodia'), icon: Users }, activity: { label: t('Actividad'), title: t('Auditoría, sincronizaciones y errores'), icon: History } } as const;
  const goTo = (view: WorkspaceView) => { setOpen(false); onNavigate(view); };
  const endSession = async () => {
    setOpen(false);
    const loggedOut = await logout();
    onLoggedOut();
    if (!loggedOut) onError(t('La sesión local se cerró, pero no se pudo confirmar el cierre en el servidor.'));
  };

  return <div className="profile-wrap" ref={ref}>
    <button ref={triggerRef} className={'profile-trigger ' + (open ? 'active' : '')} type="button" aria-label={t('Abrir menú de usuario')} title={t('Ver cuenta, rol y opciones de sesión')} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className="profile-avatar">{initials}</span><span className="profile-trigger-copy"><strong>{name}</strong><small>{primaryRoleLabel(authStatus)}</small></span><ChevronDown size={14} />
    </button>
    {open && <section className="profile-menu" aria-label={t('Menú de usuario')}>
      <div className="profile-menu-heading"><UserCircle size={17} /><div><strong>{name}</strong><span>{email}</span></div></div>
      <div className="profile-menu-divider" />
      <span className="profile-menu-label">{t('Preferencias')}</span>
      <button className="profile-menu-action profile-menu-preference" type="button" aria-label={theme === 'dark' ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro')} onClick={onThemeChange} title={theme === 'dark' ? t('Usar la apariencia clara') : t('Usar la apariencia oscura')}>
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}<span><strong>{t('Apariencia')}</strong><small>{theme === 'dark' ? t('Oscura') : t('Clara')}</small></span>
      </button>
      <button className="profile-menu-action profile-menu-preference" type="button" lang={locale() === 'es' ? 'en' : 'es'} aria-label={locale() === 'es' ? 'Switch to English' : t('Cambiar a español')} title={locale() === 'es' ? 'Switch to English' : t('Cambiar a español')} onClick={() => setLocale(locale() === 'es' ? 'en' : 'es')}>
        <Languages size={15} /><span><strong>{t('Idioma')}</strong><small>{locale() === 'es' ? t('Español') : 'English'}</small></span>
      </button>
      {canSync && <button className="profile-menu-action profile-menu-preference" type="button" disabled={refreshBusy} title={refreshSource === 'netskope' ? t('Actualizar sólo Netskope') : refreshSource === 'cyberark' ? t('Actualizar sólo las fuentes CyberArk configuradas') : t('Actualizar todas las fuentes configuradas')} onClick={() => { setOpen(false); onRefreshData(); }}>
        <RefreshCw size={15} className={refreshBusy ? 'spin' : ''} /><span><strong>{refreshBusy ? 'Actualizando datos…' : refreshSource === 'netskope' ? t('Actualizar Netskope') : t('Actualizar datos')}</strong><small>{refreshBusy ? t('La sincronización está en curso') : refreshSource === 'netskope' ? t('Sólo Netskope') : refreshSource === 'cyberark' ? t('Sólo fuentes CyberArk · revisar cambios') : t('Todas las fuentes · revisar cambios')}</small></span>
      </button>}
      {adminViews.length > 0 && <>
        <div className="profile-menu-divider profile-menu-section-divider" />
        <span className="profile-menu-label">{t('Administración')}</span>
        {adminViews.map((view) => {
          const entry = ADMIN_ENTRIES[view];
          const Icon = entry.icon;
          return <button key={view} className="profile-menu-action" type="button" title={entry.title} onClick={() => goTo(view)}><Icon size={15} /> {entry.label}</button>;
        })}
      </>}
      <div className="profile-menu-divider profile-menu-section-divider" />
      <span className="profile-menu-label">{t('Cuenta')}</span>
      <button className="profile-menu-action" type="button" title={t('Guías de uso e interpretación de datos')} onClick={() => goTo('help')}><BookOpen size={15} /> {t('Ayuda')}</button>
      <button className="profile-menu-action" type="button" title={t('Editar tu nombre o cambiar tu contraseña')} onClick={() => { setOpen(false); setAccountOpen(true); }}><UserCircle size={15} /> {t('Mi cuenta')}</button>
      {authStatus.mode === 'local' && <button className="profile-menu-action" type="button" title={t('Cerrar la sesión actual y acceder con otra cuenta')} onClick={() => void endSession()}><Repeat2 size={15} /> {t('Cambiar cuenta')}</button>}
      <button className="profile-menu-action danger" type="button" title={t('Finalizar la sesión en Custodia')} onClick={() => void endSession()}><LogOut size={15} /> {t('Cerrar sesión')}</button>
    </section>}
    {accountOpen && <AccountProfileModal authStatus={authStatus} onClose={() => setAccountOpen(false)} onNotice={onNotice} onProfileUpdated={onProfileUpdated} fallbackFocusRef={triggerRef} />}
  </div>;
}
