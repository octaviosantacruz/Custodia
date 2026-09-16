import { UserAdmin } from './user-admin';
import { RoleAdmin } from './role-admin';
import { useState } from 'react';
import { ShieldCheck, UsersRound } from 'lucide-react';
import { handleTablistKeyDown } from '../lib/tablist-keyboard';

type UsersWorkspaceProps = {
  currentActorId?: string;
  currentUserEmail?: string | null;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

export function UsersWorkspace(props: UsersWorkspaceProps) {
  const [view, setView] = useState<'users' | 'roles'>('users');
  return <div className="access-workspace"><nav className="access-tabs" aria-label="Administración de acceso" role="tablist" onKeyDown={handleTablistKeyDown}><button className={view === 'users' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'users'} tabIndex={view === 'users' ? 0 : -1} onClick={() => setView('users')}><UsersRound size={16} /><span><strong>Personas</strong><small>Usuarios locales y asignaciones</small></span></button><button className={view === 'roles' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'roles'} tabIndex={view === 'roles' ? 0 : -1} onClick={() => setView('roles')}><ShieldCheck size={16} /><span><strong>Roles y permisos</strong><small>Alcance efectivo por producto</small></span></button></nav>{view === 'users' ? <UserAdmin {...props} /> : <RoleAdmin onNotice={props.onNotice} onError={props.onError} />}</div>;
}
