import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Plus, Search, ShieldCheck, Trash2, UserRound, UserRoundX, X } from 'lucide-react';
import { createUser, deleteUser, grantUserRole, listPeople, reissueTempPassword, revokeUserRole, roleAssignments, updateUser, type Person, type User } from '../lib/users-api';
import { listAccessRoles, listAccessPermissions, listAccessDomains, type AccessRole, type AccessPermission, type AccessDomain } from '../lib/access-control-api';
import { CompactSelect } from './compact-select';
import { ConfirmDialog } from './confirm-dialog';
import { StateBlock } from './state-block';
import { AccessCapabilities, AccessChanges } from './access-capabilities';
import { DateTime } from './date-time';
import { MIN_PASSWORD_LENGTH } from '../lib/password-policy';
import { TablePagination } from './table-pagination';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import { RolePicker, formatPermissionCount } from './role-picker';
import './user-admin.css';

type Props = { onNotice: (message: string) => void; onError: (message: string) => void; currentActorId?: string; currentUserEmail?: string | null; authMode?: 'local' | 'oidc' | 'hybrid'; permissions: string[] };

const USER_PAGE_SIZE = 20;
export function UserAdmin({ onNotice, onError, currentActorId, currentUserEmail, authMode, permissions: actorPermissions }: Props) {
  const has = (permission: string) => actorPermissions.includes('access:manage') || actorPermissions.includes(permission);
  const canManageLocal = has('access:local_users_manage');
  const canAssignRoles = has('access:role_assignments_manage');
  const canReadRoles = has('access:roles_read') || canAssignRoles;
  const [people, setPeople] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const hasFilters = Boolean(search || roleFilter || statusFilter);
  const [form, setForm] = useState({ email: '', display_name: '', role_code: 'reader' });
  const [busy, setBusy] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const [pendingReissue, setPendingReissue] = useState<User | null>(null);
  const [reissuingUserId, setReissuingUserId] = useState<string | null>(null);
  const [createdCredential, setCreatedCredential] = useState<{ email: string; password: string; title: string } | null>(null);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [permissions, setPermissions] = useState<AccessPermission[]>([]);
  const [domains, setDomains] = useState<AccessDomain[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadSequence = useRef(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingRoleChange, setPendingRoleChange] = useState<{ user: User; roleCode: string; action: 'grant' | 'revoke' } | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const roleOptions = roles.filter((role) => role.lifecycle_status === 'active');
  const roleByCode = useMemo(() => new Map(roles.map((role) => [role.role_code, role])), [roles]);
  const selectedUser = people.flatMap((person) => person.identities).find((user) => user.actor_id === selectedUserId) || null;
  const userDrawerRef = useDialogFocusTrap<HTMLDivElement>({ active: Boolean(selectedUser), onClose: () => setSelectedUserId(null) });
  const createRef = useDialogFocusTrap<HTMLDivElement>({ active: createOpen, onClose: () => { if (!busy) setCreateOpen(false); } });
  const selectedPerson = people.find((person) => person.identities.some((user) => user.actor_id === selectedUserId));
  const isCurrentUser = (user: User) => user.actor_id === currentActorId || (!currentActorId && user.auth_source === 'local' && !!currentUserEmail && user.email.toLowerCase() === currentUserEmail.toLowerCase());
  const selectedAssignments = useMemo(() => selectedUser ? roleAssignments(selectedUser) : [], [selectedUser]);
  const canEditRoles = Boolean(selectedUser && canAssignRoles && canReadRoles && !catalogError && selectedUser.roles.every((code) => roleByCode.has(code)) && !isCurrentUser(selectedUser));
  const selectedRoles = useMemo(() => selectedUser?.roles.map((roleCode) => roleByCode.get(roleCode)).filter((role): role is AccessRole => Boolean(role)) || [], [roleByCode, selectedUser]);
  const selectedPermissions = useMemo(() => Array.from(new Set(selectedRoles.flatMap((role) => role.permission_codes))).sort(), [selectedRoles]);
  const nextRoleCodes = pendingRoleChange ? pendingRoleChange.action === 'grant' ? [...pendingRoleChange.user.roles, pendingRoleChange.roleCode] : pendingRoleChange.user.roles.filter((code) => code !== pendingRoleChange.roleCode) : [];
  const nextPermissions = [...new Set(nextRoleCodes.flatMap((code) => roleByCode.get(code)?.permission_codes || []))];
  const priorPermissions = [...new Set((pendingRoleChange?.user.roles || []).flatMap((code) => roleByCode.get(code)?.permission_codes || []))];
  const copyToClipboard = async (value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      onNotice('Contraseña copiada');
    } catch {
      onError('No se pudo copiar al portapapeles. Copiala manualmente.');
    }
  };
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await listPeople({ search, roleFilter, statusFilter, page, pageSize: USER_PAGE_SIZE });
      if (sequence === loadSequence.current) { setPeople(result.rows); setTotal(result.total); }
    } catch (error) { if (sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los usuarios'); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [search, roleFilter, statusFilter, page]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadSequence is a request counter, not a DOM ref; the cleanup invalidates in-flight loads
  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, [load]);
  useEffect(() => {
    if (!canReadRoles) return;
    let cancelled = false;
    Promise.all([listAccessRoles(), listAccessPermissions(), listAccessDomains()]).then(([roleResult, permissionResult, domainResult]) => {
      if (!cancelled) { setRoles(roleResult.rows); setPermissions(permissionResult.rows); setDomains(domainResult.rows); }
    }).catch((reason: unknown) => { if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'No se pudo cargar el catálogo de acceso'); });
    return () => { cancelled = true; };
  }, [canReadRoles]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { onError('Ingresá un email válido.'); return; }
    if (!form.display_name.trim()) { onError('Ingresá el nombre del usuario.'); return; }
    setBusy(true);
    try {
      const email = form.email.trim();
      const { temporary_password } = await createUser({ ...form, email, display_name: form.display_name.trim() });
      setCreatedCredential({ email, password: temporary_password, title: 'Usuario creado' });
      setForm({ email: '', display_name: '', role_code: 'reader' });
      setCreateOpen(false);
      onNotice('Usuario creado. Guardá o copiá la contraseña temporal.');
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo crear el usuario'); } finally { setBusy(false); }
  };
  const requestRemove = (user: User) => {
    if (isCurrentUser(user)) return;
    setPendingDelete(user);
  };
  const remove = async () => {
    if (!pendingDelete) return;
    const user = pendingDelete;
    setDeletingUserId(user.actor_id);
    try { await deleteUser(user.actor_id); setPendingDelete(null); onNotice('Usuario eliminado'); await load(); } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo eliminar el usuario'); } finally { setDeletingUserId(null); }
  };
  const [roleBusy, setRoleBusy] = useState(false);
  const changeRole = async (user: User, roleCode: string, action: 'grant' | 'revoke') => {
    setRoleBusy(true);
    try {
      await (action === 'grant' ? grantUserRole : revokeUserRole)(user.actor_id, roleCode);
      onNotice(action === 'grant' ? 'Rol asignado' : 'Rol quitado');
      await load();
      setPendingRoleChange(null);
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo cambiar el rol'); } finally { setRoleBusy(false); }
  };
  const update = async (user: User, changes: Record<string, unknown>) => { try { await updateUser(user.actor_id, changes); onNotice('Usuario actualizado'); await load(); } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo actualizar el usuario'); } };
  const reissue = async () => {
    if (!pendingReissue) return;
    const user = pendingReissue;
    setReissuingUserId(user.actor_id);
    try {
      const { temporary_password } = await reissueTempPassword(user.actor_id);
      setCreatedCredential({ email: user.email, password: temporary_password, title: 'Acceso temporal regenerado' });
      setPendingReissue(null);
      onNotice('Contraseña temporal regenerada. Guardá o copiala.');
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo regenerar el acceso temporal'); } finally { setReissuingUserId(null); }
  };
  return <>
    <section className="user-admin">
      <header className="section-heading"><div><p className="eyebrow">DIRECTORIO DE CUSTODIA</p><h2>Acceso a la plataforma</h2><span className="database-caption">Una persona por fila. Cada cuenta conserva sus roles.</span></div><span className="database-toolbar-count">{loading ? 'Cargando...' : loadError ? 'Sin dato' : `${total} ${total === 1 ? 'persona' : 'personas'}`}</span></header>
      {createdCredential && <aside className="created-credential" role="status"><div><strong>{createdCredential.title}</strong><span>{createdCredential.email}</span><small>Guardá esta contraseña temporal. Se muestra solo durante esta sesión.</small></div><code>{createdCredential.password}</code><button className="button subtle" type="button" onClick={() => void copyToClipboard(createdCredential.password)}><Copy size={14} /> Copiar contraseña</button><button className="icon-button" type="button" aria-label="Ocultar credencial temporal" onClick={() => setCreatedCredential(null)}><X size={15} /></button></aside>}
      <div className="user-directory-toolbar">
        <label className="search-box"><Search size={16} /><span className="sr-only">Buscar usuarios</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Buscar por nombre o email" /></label>
        {canReadRoles && <CompactSelect value={roleFilter} ariaLabel="Filtrar por rol" options={[{ value: '', label: 'Todos los roles' }, ...roles.map((role) => ({ value: role.role_code, label: role.display_name }))]} onChange={(value) => { setRoleFilter(value); setPage(0); }} />}
        <CompactSelect value={statusFilter} ariaLabel="Filtrar por estado" options={[{ value: '', label: 'Todos los estados' }, { value: 'active', label: 'Activo' }, { value: 'pending', label: 'Pendiente de primer acceso' }, { value: 'inactive', label: 'Desactivado' }]} onChange={(value) => { setStatusFilter(value); setPage(0); }} />
        {authMode !== 'oidc' && canManageLocal && canAssignRoles && canReadRoles && <button className="button primary" type="button" disabled={!roleOptions.length} onClick={() => setCreateOpen(true)}><Plus size={15} /> Crear usuario local</button>}
      </div>
      {catalogError && <p className="user-directory-error" role="status">Catálogo de acceso no disponible: {catalogError}</p>}
      {loading ? <StateBlock variant="loading" title="Cargando usuarios" /> : loadError ? <StateBlock variant="error" title="No se pudieron cargar los usuarios" hint={loadError} action={<button className="button subtle" type="button" onClick={() => void load()}>Reintentar</button>} /> : <>
        <div className="user-directory-scroll"><table className="user-directory-table"><caption className="sr-only">Usuarios de Custodia</caption><thead><tr><th scope="col">Usuario</th><th scope="col">Cuenta</th><th scope="col">Roles asignados</th><th scope="col">Último acceso</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead><tbody>{people.map((person) => {
          const assigned = [...new Set(person.identities.flatMap((user) => user.roles))];
          const lastLogin = person.identities.map((user) => user.last_login_at).filter((value): value is string => Boolean(value)).sort((left, right) => new Date(left).getTime() - new Date(right).getTime()).at(-1);
          return <tr className="person-row" key={person.key}><td><div className="user-row-identity"><strong>{person.display_name}</strong><span>{person.email || 'Sin email'}</span>{person.identities.length > 1 && <small>{person.identities.length} identidades</small>}</div></td>
            <td><div className="user-account-chips">{person.identities.map((user) => user.auth_source === 'oidc' ? <span key={user.actor_id} className="user-status-chip oidc">Okta</span> : <span key={user.actor_id} className={`user-status-chip ${!user.is_active ? 'inactive' : user.must_change_password ? 'pending' : 'active'}`}>{!user.is_active ? 'Local · desactivado' : user.must_change_password ? 'Local · pendiente' : 'Local'}</span>)}</div></td>
            <td><div className="user-table-roles">{assigned.map((code) => <span key={code}>{roleByCode.get(code)?.display_name || code}</span>)}{!assigned.length && <span>Sin rol</span>}</div></td>
            <td><DateTime value={lastLogin} /></td><td><button className="button subtle user-detail-button" type="button" aria-label={`Gestionar acceso de ${person.display_name}`} onClick={() => setSelectedUserId(person.identities[0]?.actor_id || null)}><ShieldCheck size={14} /> Gestionar</button></td></tr>;
        })}</tbody></table></div>
        {!people.length && <StateBlock variant={hasFilters ? 'no-results' : 'empty'} title={hasFilters ? 'Sin resultados para estos filtros' : 'Sin personas registradas'} hint={hasFilters ? 'Ajustá la búsqueda, el rol o el estado.' : 'Las identidades Okta aparecen después de iniciar sesión.'} action={hasFilters ? <button type="button" className="button subtle" onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); setPage(0); }}>Limpiar filtros</button> : undefined} />}
        <TablePagination page={page} pageSize={USER_PAGE_SIZE} total={total} onPageChange={setPage} />
      </>}
    </section>
    {createOpen && <div className="user-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreateOpen(false); }}><div ref={createRef} className="user-access-drawer" role="dialog" aria-modal="true" aria-labelledby="create-local-title" tabIndex={-1}>
      <header className="user-access-drawer-header"><div><p className="eyebrow">CUENTA LOCAL</p><h2 id="create-local-title">Crear usuario local</h2></div><button className="icon-button" type="button" aria-label="Cerrar creación de usuario" disabled={busy} onClick={() => setCreateOpen(false)}><X size={16} /></button></header>
      <form className="user-create-form" noValidate onSubmit={create}><label>Email<input type="email" autoComplete="username" placeholder="nombre@empresa.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label><label>Nombre<input placeholder="Nombre y apellido" value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} required /></label><label>Rol inicial<RolePicker value={form.role_code} options={roleOptions} onChange={(role_code) => setForm({ ...form, role_code })} ariaLabel="Rol inicial del nuevo usuario local" /></label><p className="database-caption">Se genera una contraseña temporal de al menos {MIN_PASSWORD_LENGTH} caracteres. La persona deberá cambiarla al ingresar.</p><button className="button primary" type="submit" disabled={busy}><Plus size={15} /> {busy ? 'Creando...' : 'Crear usuario local'}</button></form>
    </div></div>}
    {selectedUser ? <div className="user-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedUserId(null); }}><div ref={userDrawerRef} className="user-access-drawer" role="dialog" aria-modal="true" aria-labelledby="user-access-title" tabIndex={-1}>
      <header className="user-access-drawer-header"><div><p className="eyebrow">DETALLE DE ACCESO</p><h2 id="user-access-title">{selectedUser.display_name}</h2><span>{selectedUser.email}</span></div><button className="icon-button" type="button" aria-label="Cerrar detalle de acceso" title="Cerrar detalle de acceso" onClick={() => setSelectedUserId(null)}><X size={16} /></button></header>
      {selectedPerson && selectedPerson.identities.length > 1 && <label className="user-account-selector">Cuenta que administrás<CompactSelect value={selectedUser.actor_id} ariaLabel="Cuenta que administrás" options={selectedPerson.identities.map((user) => ({ value: user.actor_id, label: `${user.display_name} · ${user.auth_source === 'oidc' ? 'Okta' : 'Local'}` }))} onChange={setSelectedUserId} /></label>}
      <section className="user-access-overview"><div><span>Origen</span><strong>{selectedUser.auth_source === 'oidc' ? 'Okta' : 'Local'}</strong></div><div><span>Acceso efectivo</span><strong>{catalogError || !canReadRoles || selectedUser.roles.some((code) => !roleByCode.has(code)) ? 'Sin dato' : formatPermissionCount(selectedPermissions.length)}</strong></div></section>
      <section className="user-access-drawer-section" aria-labelledby="user-access-roles-title"><div className="user-access-section-heading"><div><span id="user-access-roles-title">ROLES</span><strong>{selectedAssignments.length ? `${selectedAssignments.length} ${selectedAssignments.length === 1 ? 'rol' : 'roles'}` : 'Sin rol'}</strong></div></div>
        <ul className="role-chip-list" aria-label={`Roles de ${selectedUser.display_name}`}>{selectedAssignments.map((assignment) => {
          const name = roleByCode.get(assignment.role_code)?.display_name || assignment.role_code;
          const removable = assignment.source === 'manual' && canEditRoles;
          return <li className={`role-chip is-${assignment.source}`} key={assignment.role_code} title={assignment.source === 'oidc' ? 'Asignado al iniciar sesión: el mapeo se edita en Roles y permisos' : 'Asignado en Custodia'}>
            <span>{name}</span><small>{assignment.source === 'oidc' ? 'Okta' : 'Custodia'}</small>
            {removable ? <button type="button" className="role-chip-remove" disabled={roleBusy} aria-label={`Quitar ${name} de ${selectedUser.display_name}`} onClick={() => setPendingRoleChange({ user: selectedUser, roleCode: assignment.role_code, action: 'revoke' })}><X size={12} /></button> : null}
          </li>;
        })}</ul>
        {canEditRoles ? <RolePicker value="" placeholder="Agregar rol" options={roleOptions.filter((role) => !selectedAssignments.some((assignment) => assignment.role_code === role.role_code))} onChange={(role_code) => setPendingRoleChange({ user: selectedUser, roleCode: role_code, action: 'grant' })} disabled={roleBusy} ariaLabel={`Agregar rol a ${selectedUser.display_name}`} />
          : <p className="user-access-note">{isCurrentUser(selectedUser) ? 'Tus propios roles no se cambian desde tu cuenta.' : 'Solo lectura.'}</p>}
        {selectedUser.auth_source === 'oidc' ? <p className="user-access-note">Los roles directos se editan acá. El mapeo de grupos se administra en Roles y permisos.</p> : null}
      </section>
      <section className="user-access-drawer-section"><div className="user-access-section-heading"><div><span>QUÉ PUEDE HACER</span><strong>Capacidades de esta cuenta</strong></div></div>{catalogError || !canReadRoles || selectedUser.roles.some((code) => !roleByCode.has(code)) ? <p className="user-access-note">No se pudo resolver el catálogo completo de esta cuenta.</p> : <AccessCapabilities codes={selectedPermissions} permissions={permissions} domains={domains} label={`Accesos de ${selectedUser.display_name}`} />}</section>
      <footer className="user-access-drawer-actions">{selectedUser.auth_source === 'oidc' ? <span className="user-self-badge">Cuenta de Okta</span> : canManageLocal ? <>{isCurrentUser(selectedUser) ? <span className="user-self-badge">Tu usuario</span> : <button className="button subtle" type="button" onClick={() => void update(selectedUser, { is_active: !selectedUser.is_active })}>{selectedUser.is_active ? <><UserRoundX size={14} /> Desactivar</> : <><UserRound size={14} /> Activar</>}</button>}<button className="button subtle" type="button" disabled={!selectedUser.is_active || reissuingUserId === selectedUser.actor_id} onClick={() => setPendingReissue(selectedUser)}><KeyRound size={14} /> Regenerar acceso</button>{!isCurrentUser(selectedUser) ? <button className="button danger" type="button" disabled={deletingUserId === selectedUser.actor_id} onClick={() => requestRemove(selectedUser)}><Trash2 size={14} /> Eliminar</button> : null}</> : <span className="user-self-badge">Solo lectura</span>}</footer>
    </div></div> : null}
    {pendingRoleChange && <ConfirmDialog fallbackFocusRef={userDrawerRef} icon={<ShieldCheck size={18} />} titleId="change-role-title" title={pendingRoleChange.action === 'grant' ? 'Asignar rol' : 'Quitar rol'} descriptionId="change-role-copy"
      description={<>{pendingRoleChange.action === 'grant' ? 'Asignar' : 'Quitar'} <strong>{roleByCode.get(pendingRoleChange.roleCode)?.display_name || pendingRoleChange.roleCode}</strong> a la cuenta de <strong>{pendingRoleChange.user.display_name}</strong>. Revisá el efecto considerando sus demás roles.</>}
      onClose={() => setPendingRoleChange(null)} closeDisabled={roleBusy} confirmLabel={pendingRoleChange.action === 'grant' ? 'Asignar rol' : 'Quitar rol'} confirmBusyLabel="Guardando..." confirmBusy={roleBusy} confirmTone={pendingRoleChange.action === 'grant' ? 'primary' : 'danger'} backdropClassName="user-role-change-dialog"
      onConfirm={() => void changeRole(pendingRoleChange.user, pendingRoleChange.roleCode, pendingRoleChange.action)}><AccessChanges before={priorPermissions} after={nextPermissions} permissions={permissions} domains={domains} /></ConfirmDialog>}
    {pendingDelete && <ConfirmDialog
      icon={<Trash2 size={18} />}
      titleId="delete-user-title"
      title="Eliminar usuario"
      descriptionId="delete-user-copy"
      description={<>¿Querés eliminar a <strong>{pendingDelete.display_name}</strong>? Se quitarán también sus roles y esta acción no se puede deshacer.</>}
      onClose={() => setPendingDelete(null)}
      closeDisabled={Boolean(deletingUserId)}
      confirmLabel="Eliminar usuario"
      confirmBusyLabel="Eliminando..."
      confirmBusy={Boolean(deletingUserId)}
      onConfirm={() => void remove()}
    />}
    {pendingReissue && <ConfirmDialog
      icon={<KeyRound size={18} />}
      titleId="reissue-user-title"
      title="Regenerar acceso temporal"
      descriptionId="reissue-user-copy"
      description={<>Se generará una contraseña temporal nueva para <strong>{pendingReissue.display_name}</strong> y se invalidará la anterior. Deberá cambiarla en su próximo ingreso.</>}
      onClose={() => setPendingReissue(null)}
      closeDisabled={Boolean(reissuingUserId)}
      confirmLabel="Regenerar acceso"
      confirmBusyLabel="Regenerando..."
      confirmBusy={Boolean(reissuingUserId)}
      confirmTone="primary"
      onConfirm={() => void reissue()}
    />}
  </>;
}
