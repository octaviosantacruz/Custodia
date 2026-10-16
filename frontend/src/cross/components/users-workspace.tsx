import { UserAdmin } from './user-admin';
import { AccessReview } from './access-review';
import { RoleAdmin } from './role-admin';
import { useEffect, useState } from 'react';
import { ClipboardCheck, ShieldCheck, UsersRound } from 'lucide-react';
import { handleTablistKeyDown } from '../lib/tablist-keyboard';
import './user-admin.css';

type UsersWorkspaceProps = {
  authMode?: 'local' | 'oidc' | 'hybrid';
  currentActorId?: string;
  currentUserEmail?: string | null;
  permissions: string[];
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

type AccessView = 'users' | 'review' | 'roles';

export function UsersWorkspace(props: UsersWorkspaceProps) {
  const has = (permission: string) => props.permissions.includes('access:manage') || props.permissions.includes(permission);
  const canSeeUsers = has('access:directory_read') || has('access:local_users_manage') || has('access:role_assignments_manage');
  const canSeeRoles = has('access:roles_read') || has('access:roles_manage') || has('access:permissions_manage') || has('access:oidc_mappings_read');
  const [view, setView] = useState<AccessView>(() => canSeeUsers ? 'users' : 'roles');
  useEffect(() => {
    if ((view === 'users' || view === 'review') && !canSeeUsers && canSeeRoles) setView('roles');
    if (view === 'roles' && !canSeeRoles && canSeeUsers) setView('users');
  }, [canSeeRoles, canSeeUsers, view]);
  return <div className="access-workspace">
    <nav className="access-tabs" aria-label="Administración de acceso" role="tablist" onKeyDown={handleTablistKeyDown}>
      {canSeeUsers && <button id="access-tab-users" aria-controls="access-tabpanel" className={view === 'users' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'users'} tabIndex={view === 'users' ? 0 : -1} onClick={() => setView('users')}><UsersRound size={16} /><span><strong>Usuarios de DS Hub</strong><small>Identidades locales y Okta</small></span></button>}
      {canSeeUsers && <button id="access-tab-review" aria-controls="access-tabpanel" className={view === 'review' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'review'} tabIndex={view === 'review' ? 0 : -1} onClick={() => setView('review')}><ClipboardCheck size={16} /><span><strong>Revisión de accesos</strong><small>Quién tiene qué y desde cuándo</small></span></button>}
      {canSeeRoles && <button id="access-tab-roles" aria-controls="access-tabpanel" className={view === 'roles' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'roles'} tabIndex={view === 'roles' ? 0 : -1} onClick={() => setView('roles')}><ShieldCheck size={16} /><span><strong>Roles y permisos</strong><small>Alcance efectivo por producto</small></span></button>}
    </nav>
    <div role="tabpanel" id="access-tabpanel" aria-labelledby={`access-tab-${view}`}>
      {view === 'users' && canSeeUsers ? <UserAdmin {...props} /> : view === 'review' && canSeeUsers ? <AccessReview /> : view === 'roles' && canSeeRoles ? <RoleAdmin permissions={props.permissions} currentActorId={props.currentActorId} onNotice={props.onNotice} onError={props.onError} /> : null}
    </div>
  </div>;
}
