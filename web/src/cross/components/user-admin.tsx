import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Plus, Search, ShieldCheck, Trash2, UserRound, UserRoundX, X } from 'lucide-react';
import { createUser, deleteUser, grantUserRole, listPeople, reissueTempPassword, revokeUserRole, roleAssignments, updateUser, type Person, type User } from '../lib/users-api';
import { listAccessRoles, listAccessPermissions, listAccessDomains, type AccessRole, type AccessPermission, type AccessDomain } from '../lib/access-control-api';
import { CompactSelect } from './compact-select';
import { ConfirmDialog } from './confirm-dialog';
import { StateBlock } from './state-block';
import { AccessCapabilities, AccessChanges } from './access-capabilities';
import { AccessWorkspacePreview } from './access-workspace-preview';
import { DateTime } from './date-time';
import { MIN_PASSWORD_LENGTH } from '../lib/password-policy';
import { TablePagination } from './table-pagination';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import { RolePicker, formatPermissionCount } from './role-picker';
import './user-admin.css';
import { t } from '../i18n/index.ts';

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
      onNotice(t('Contraseña copiada'));
    } catch {
      onError(t('No se pudo copiar al portapapeles. Copiala manualmente.'));
    }
  };
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await listPeople({ search, roleFilter, statusFilter, page, pageSize: USER_PAGE_SIZE });
      if (sequence === loadSequence.current) { setPeople(result.rows); setTotal(result.total); }
    } catch (error) { if (sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : t('No se pudieron cargar los usuarios')); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [search, roleFilter, statusFilter, page]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadSequence is a request counter, not a DOM ref; the cleanup invalidates in-flight loads
  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, [load]);
  useEffect(() => {
    if (!canReadRoles) return;
    let cancelled = false;
    Promise.all([listAccessRoles(), listAccessPermissions(), listAccessDomains()]).then(([roleResult, permissionResult, domainResult]) => {
      if (!cancelled) { setRoles(roleResult.rows); setPermissions(permissionResult.rows); setDomains(domainResult.rows); }
    }).catch((reason: unknown) => { if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : t('No se pudo cargar el catálogo de acceso')); });
    return () => { cancelled = true; };
  }, [canReadRoles]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { onError(t('Ingresá un email válido.')); return; }
    if (!form.display_name.trim()) { onError(t('Ingresá el nombre del usuario.')); return; }
    setBusy(true);
    try {
      const email = form.email.trim();
      const { temporary_password } = await createUser({ ...form, email, display_name: form.display_name.trim() });
      setCreatedCredential({ email, password: temporary_password, title: t('Usuario creado') });
      setForm({ email: '', display_name: '', role_code: 'reader' });
      setCreateOpen(false);
      onNotice(t('Usuario creado. Guardá o copiá la contraseña temporal.'));
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : t('No se pudo crear el usuario')); } finally { setBusy(false); }
  };
  const requestRemove = (user: User) => {
    if (isCurrentUser(user)) return;
    setPendingDelete(user);
  };
  const remove = async () => {
    if (!pendingDelete) return;
    const user = pendingDelete;
    setDeletingUserId(user.actor_id);
    try { await deleteUser(user.actor_id); setPendingDelete(null); onNotice(t('Usuario eliminado')); await load(); } catch (error) { onError(error instanceof Error ? error.message : t('No se pudo eliminar el usuario')); } finally { setDeletingUserId(null); }
  };
  const [roleBusy, setRoleBusy] = useState(false);
  const changeRole = async (user: User, roleCode: string, action: 'grant' | 'revoke') => {
    setRoleBusy(true);
    try {
      await (action === 'grant' ? grantUserRole : revokeUserRole)(user.actor_id, roleCode);
      onNotice(action === 'grant' ? t('Rol asignado') : t('Rol quitado'));
      await load();
      setPendingRoleChange(null);
    } catch (error) { onError(error instanceof Error ? error.message : t('No se pudo cambiar el rol')); } finally { setRoleBusy(false); }
  };
  const update = async (user: User, changes: Record<string, unknown>) => { try { await updateUser(user.actor_id, changes); onNotice(t('Usuario actualizado')); await load(); } catch (error) { onError(error instanceof Error ? error.message : t('No se pudo actualizar el usuario')); } };
  const reissue = async () => {
    if (!pendingReissue) return;
    const user = pendingReissue;
    setReissuingUserId(user.actor_id);
    try {
      const { temporary_password } = await reissueTempPassword(user.actor_id);
      setCreatedCredential({ email: user.email, password: temporary_password, title: t('Acceso temporal regenerado') });
      setPendingReissue(null);
      onNotice(t('Contraseña temporal regenerada. Guardá o copiala.'));
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : t('No se pudo regenerar el acceso temporal')); } finally { setReissuingUserId(null); }
  };
  return <>
    <section className="user-admin">
      <header className="section-heading"><div><p className="eyebrow">{t('DIRECTORIO DE CUSTODIA')}</p><h2>{t('Acceso a la plataforma')}</h2><span className="database-caption">{t('Una persona por fila. Cada cuenta conserva sus roles.')}</span></div><span className="database-toolbar-count">{loading ? 'Cargando...' : loadError ? t('Sin dato') : `${total} ${total === 1 ? 'persona' : 'personas'}`}</span></header>
      {createdCredential && <aside className="created-credential" role="status"><div><strong>{createdCredential.title}</strong><span>{createdCredential.email}</span><small>{t('Guardá esta contraseña temporal. Se muestra solo durante esta sesión.')}</small></div><code>{createdCredential.password}</code><button className="button subtle" type="button" onClick={() => void copyToClipboard(createdCredential.password)}><Copy size={14} /> {t('Copiar contraseña')}</button><button className="icon-button" type="button" aria-label={t('Ocultar credencial temporal')} onClick={() => setCreatedCredential(null)}><X size={15} /></button></aside>}
      <div className="user-directory-toolbar">
        <label className="search-box"><Search size={16} /><span className="sr-only">{t('Buscar usuarios')}</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder={t('Buscar por nombre o email')} /></label>
        {canReadRoles && <CompactSelect value={roleFilter} ariaLabel={t('Filtrar por rol')} options={[{ value: '', label: t('Todos los roles') }, ...roles.map((role) => ({ value: role.role_code, label: role.display_name }))]} onChange={(value) => { setRoleFilter(value); setPage(0); }} />}
        <CompactSelect value={statusFilter} ariaLabel={t('Filtrar por estado')} options={[{ value: '', label: t('Todos los estados') }, { value: 'active', label: t('Activo') }, { value: 'pending', label: t('Pendiente de primer acceso') }, { value: 'inactive', label: t('Desactivado') }]} onChange={(value) => { setStatusFilter(value); setPage(0); }} />
        {authMode !== 'oidc' && canManageLocal && canAssignRoles && canReadRoles && <button className="button primary" type="button" disabled={!roleOptions.length} onClick={() => setCreateOpen(true)}><Plus size={15} /> {t('Crear usuario local')}</button>}
      </div>
      {catalogError && <p className="user-directory-error" role="status">{t('Catálogo de acceso no disponible: {catalogError}', { catalogError: catalogError })}</p>}
      {loading ? <StateBlock variant="loading" title={t('Cargando usuarios')} /> : loadError ? <StateBlock variant="error" title={t('No se pudieron cargar los usuarios')} hint={loadError} action={<button className="button subtle" type="button" onClick={() => void load()}>{t('Reintentar')}</button>} /> : <>
        <div className="user-directory-scroll"><table className="user-directory-table"><caption className="sr-only">{t('Usuarios de Custodia')}</caption><thead><tr><th scope="col">{t('Usuario')}</th><th scope="col">{t('Cuenta')}</th><th scope="col">{t('Roles asignados')}</th><th scope="col">{t('Último acceso')}</th><th scope="col"><span className="sr-only">{t('Acciones')}</span></th></tr></thead><tbody>{people.map((person) => {
          const assigned = [...new Set(person.identities.flatMap((user) => user.roles))];
          const lastLogin = person.identities.map((user) => user.last_login_at).filter((value): value is string => Boolean(value)).sort((left, right) => new Date(left).getTime() - new Date(right).getTime()).at(-1);
          return <tr className="person-row" key={person.key}><td><div className="user-row-identity"><strong>{person.display_name}</strong><span>{person.email || t('Sin email')}</span>{person.identities.length > 1 && <small>{person.identities.length} identidades</small>}</div></td>
            <td><div className="user-account-chips">{person.identities.map((user) => user.auth_source === 'oidc' ? <span key={user.actor_id} className="user-status-chip oidc">{t('Okta')}</span> : <span key={user.actor_id} className={`user-status-chip ${!user.is_active ? 'inactive' : user.must_change_password ? 'pending' : 'active'}`}>{!user.is_active ? 'Local · desactivado' : user.must_change_password ? t('Local · pendiente') : t('Local')}</span>)}</div></td>
            <td><div className="user-table-roles">{assigned.map((code) => <span key={code}>{roleByCode.get(code)?.display_name || code}</span>)}{!assigned.length && <span>{t('Sin rol')}</span>}</div></td>
            <td><DateTime value={lastLogin} /></td><td><button className="button subtle user-detail-button" type="button" aria-label={t('Gestionar acceso de {display_name}', { display_name: person.display_name })} onClick={() => setSelectedUserId(person.identities[0]?.actor_id || null)}><ShieldCheck size={14} /> {t('Gestionar')}</button></td></tr>;
        })}</tbody></table></div>
        {!people.length && <StateBlock variant={hasFilters ? 'no-results' : 'empty'} title={hasFilters ? t('Sin resultados para estos filtros') : t('Sin personas registradas')} hint={hasFilters ? t('Ajustá la búsqueda, el rol o el estado.') : t('Las identidades Okta aparecen después de iniciar sesión.')} action={hasFilters ? <button type="button" className="button subtle" onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); setPage(0); }}>{t('Limpiar filtros')}</button> : undefined} />}
        <TablePagination page={page} pageSize={USER_PAGE_SIZE} total={total} onPageChange={setPage} />
      </>}
    </section>
    {createOpen && <div className="user-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreateOpen(false); }}><div ref={createRef} className="user-access-drawer" role="dialog" aria-modal="true" aria-labelledby="create-local-title" tabIndex={-1}>
      <header className="user-access-drawer-header"><div><p className="eyebrow">{t('CUENTA LOCAL')}</p><h2 id="create-local-title">{t('Crear usuario local')}</h2></div><button className="icon-button" type="button" aria-label={t('Cerrar creación de usuario')} disabled={busy} onClick={() => setCreateOpen(false)}><X size={16} /></button></header>
      <form className="user-create-form" noValidate onSubmit={create}><label>{t('Email')}<input type="email" autoComplete="username" placeholder="nombre@empresa.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label><label>{t('Nombre')}<input placeholder={t('Nombre y apellido')} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} required /></label><label>{t('Rol inicial')}<RolePicker value={form.role_code} options={roleOptions} onChange={(role_code) => setForm({ ...form, role_code })} ariaLabel={t('Rol inicial del nuevo usuario local')} /></label><p className="database-caption">{t('Se genera una contraseña temporal de al menos {MIN_PASSWORD_LENGTH} caracteres. La persona deberá cambiarla al ingresar.', { MIN_PASSWORD_LENGTH: MIN_PASSWORD_LENGTH })}</p><button className="button primary" type="submit" disabled={busy}><Plus size={15} /> {busy ? t('Creando...') : t('Crear usuario local')}</button></form>
    </div></div>}
    {selectedUser ? <div className="user-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedUserId(null); }}><div ref={userDrawerRef} className="user-access-drawer" role="dialog" aria-modal="true" aria-labelledby="user-access-title" tabIndex={-1}>
      <header className="user-access-drawer-header"><div><p className="eyebrow">{t('DETALLE DE ACCESO')}</p><h2 id="user-access-title">{selectedUser.display_name}</h2><span>{selectedUser.email}</span></div><button className="icon-button" type="button" aria-label={t('Cerrar detalle de acceso')} title={t('Cerrar detalle de acceso')} onClick={() => setSelectedUserId(null)}><X size={16} /></button></header>
      {selectedPerson && selectedPerson.identities.length > 1 && <label className="user-account-selector">{t('Cuenta que administrás')}<CompactSelect value={selectedUser.actor_id} ariaLabel={t('Cuenta que administrás')} options={selectedPerson.identities.map((user) => ({ value: user.actor_id, label: `${user.display_name} · ${user.auth_source === 'oidc' ? t('Okta') : t('Local')}` }))} onChange={setSelectedUserId} /></label>}
      <section className="user-access-overview"><div><span>{t('Origen')}</span><strong>{selectedUser.auth_source === 'oidc' ? t('Okta') : t('Local')}</strong></div><div><span>{t('Acceso efectivo')}</span><strong>{catalogError || !canReadRoles || selectedUser.roles.some((code) => !roleByCode.has(code)) ? t('Sin dato') : formatPermissionCount(selectedPermissions.length)}</strong></div></section>
      <section className="user-access-drawer-section" aria-labelledby="user-access-roles-title"><div className="user-access-section-heading"><div><span id="user-access-roles-title">ROLES</span><strong>{selectedAssignments.length ? `${selectedAssignments.length} ${selectedAssignments.length === 1 ? 'rol' : 'roles'}` : t('Sin rol')}</strong></div></div>
        <ul className="role-chip-list" aria-label={t('Roles de {display_name}', { display_name: selectedUser.display_name })}>{selectedAssignments.map((assignment) => {
          const name = roleByCode.get(assignment.role_code)?.display_name || assignment.role_code;
          const removable = assignment.source === 'manual' && canEditRoles;
          return <li className={`role-chip is-${assignment.source}`} key={assignment.role_code} title={assignment.source === 'oidc' ? t('Asignado al iniciar sesión en Okta') : t('Asignado en Custodia')}>
            <span>{name}</span><small>{assignment.source === 'oidc' ? t('Okta') : t('Custodia')}</small>
            {removable ? <button type="button" className="role-chip-remove" disabled={roleBusy} aria-label={t('Quitar {name} de {display_name}', { name: name, display_name: selectedUser.display_name })} onClick={() => setPendingRoleChange({ user: selectedUser, roleCode: assignment.role_code, action: 'revoke' })}><X size={12} /></button> : null}
          </li>;
        })}</ul>
        {canEditRoles ? <RolePicker value="" placeholder={t('Agregar rol')} options={roleOptions.filter((role) => !selectedAssignments.some((assignment) => assignment.role_code === role.role_code))} onChange={(role_code) => setPendingRoleChange({ user: selectedUser, roleCode: role_code, action: 'grant' })} disabled={roleBusy} ariaLabel={t('Agregar rol a {display_name}', { display_name: selectedUser.display_name })} />
          : <p className="user-access-note">{isCurrentUser(selectedUser) ? t('Tus propios roles no se cambian desde tu cuenta.') : t('Solo lectura.')}</p>}
        {selectedUser.auth_source === 'oidc' && has('access:oidc_mappings_read') && <div className="user-role-sources" role="region" aria-label={t('Origen de roles de Okta')}><h3>{t('Otorgados al iniciar sesión')}</h3><dl>{selectedAssignments.filter((assignment) => assignment.source === 'oidc').map((assignment) => {
          const groups = selectedUser.role_group_sources?.[assignment.role_code];
          return <div key={assignment.role_code}><dt>{roleByCode.get(assignment.role_code)?.display_name || assignment.role_code}</dt><dd>{groups == null ? t('Sin detalle del grupo para este inicio de sesión.') : groups.length ? groups.join(' · ') : t('Rol predeterminado de inicio de sesión (sin grupo asociado).')}</dd></div>;
        })}</dl><p className="user-access-note">{t('Último inicio de sesión:')} <DateTime value={selectedUser.last_login_at} />{t('. No confirma pertenencia actual a los grupos.')}</p></div>}
        {selectedUser.auth_source === 'oidc' ? <p className="user-access-note">Los roles directos se editan acá. Los grupos se consultan en Roles y permisos; la pertenencia se administra en Okta.</p> : null}
      </section>
      <section className="user-access-drawer-section"><div className="user-access-section-heading"><div><span>{t('QUÉ PUEDE HACER')}</span><strong>{t('Capacidades de esta cuenta')}</strong></div></div>{catalogError || !canReadRoles || selectedUser.roles.some((code) => !roleByCode.has(code)) ? <p className="user-access-note">{t('No se pudo resolver el catálogo completo de esta cuenta.')}</p> : <AccessCapabilities codes={selectedPermissions} permissions={permissions} domains={domains} label={t('Accesos de {display_name}', { display_name: selectedUser.display_name })} />}</section>
      <AccessWorkspacePreview codes={selectedPermissions} unavailable={!selectedUser.is_active ? t('Cuenta desactivada: sin acceso.') : catalogError || !canReadRoles || selectedUser.roles.some((code) => !roleByCode.has(code)) ? t('No se pudo resolver el catálogo completo de esta cuenta.') : undefined} />
      <footer className="user-access-drawer-actions">{selectedUser.auth_source === 'oidc' ? <span className="user-self-badge">{t('Cuenta de Okta')}</span> : canManageLocal ? <>{isCurrentUser(selectedUser) ? <span className="user-self-badge">{t('Tu usuario')}</span> : <button className="button subtle" type="button" onClick={() => void update(selectedUser, { is_active: !selectedUser.is_active })}>{selectedUser.is_active ? <><UserRoundX size={14} /> {t('Desactivar')}</> : <><UserRound size={14} /> {t('Activar')}</>}</button>}<button className="button subtle" type="button" disabled={!selectedUser.is_active || reissuingUserId === selectedUser.actor_id} onClick={() => setPendingReissue(selectedUser)}><KeyRound size={14} /> {t('Regenerar acceso')}</button>{!isCurrentUser(selectedUser) ? <button className="button danger" type="button" disabled={deletingUserId === selectedUser.actor_id} onClick={() => requestRemove(selectedUser)}><Trash2 size={14} /> {t('Eliminar')}</button> : null}</> : <span className="user-self-badge">{t('Solo lectura')}</span>}</footer>
    </div></div> : null}
    {pendingRoleChange && <ConfirmDialog fallbackFocusRef={userDrawerRef} icon={<ShieldCheck size={18} />} titleId="change-role-title" title={pendingRoleChange.action === 'grant' ? t('Asignar rol') : t('Quitar rol')} descriptionId="change-role-copy"
      description={<>{pendingRoleChange.action === 'grant' ? t('Asignar') : t('Quitar')} <strong>{roleByCode.get(pendingRoleChange.roleCode)?.display_name || pendingRoleChange.roleCode}</strong> {t('a la cuenta de')} <strong>{pendingRoleChange.user.display_name}</strong>{t('. Revisá el efecto considerando sus demás roles.')}</>}
      onClose={() => setPendingRoleChange(null)} closeDisabled={roleBusy} confirmLabel={pendingRoleChange.action === 'grant' ? t('Asignar rol') : t('Quitar rol')} confirmBusyLabel="Guardando..." confirmBusy={roleBusy} confirmTone={pendingRoleChange.action === 'grant' ? 'primary' : 'danger'} backdropClassName="user-role-change-dialog"
      onConfirm={() => void changeRole(pendingRoleChange.user, pendingRoleChange.roleCode, pendingRoleChange.action)}><AccessChanges before={priorPermissions} after={nextPermissions} permissions={permissions} domains={domains} /><AccessWorkspacePreview codes={nextPermissions} label={t('Vistas después del cambio')} unavailable={!pendingRoleChange.user.is_active ? t('Cuenta desactivada: sin acceso.') : undefined} /></ConfirmDialog>}
    {pendingDelete && <ConfirmDialog
      icon={<Trash2 size={18} />}
      titleId="delete-user-title"
      title={t('Eliminar usuario')}
      descriptionId="delete-user-copy"
      description={<>{t('¿Querés eliminar a')} <strong>{pendingDelete.display_name}</strong>{t('? Se quitarán también sus roles y esta acción no se puede deshacer.')}</>}
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
      title={t('Regenerar acceso temporal')}
      descriptionId="reissue-user-copy"
      description={<>{t('Se generará una contraseña temporal nueva para')} <strong>{pendingReissue.display_name}</strong> {t('y se invalidará la anterior. Deberá cambiarla en su próximo ingreso.')}</>}
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
