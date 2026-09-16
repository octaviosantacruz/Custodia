import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronDown, Copy, KeyRound, Plus, Search, ShieldCheck, Trash2, UserRound, UserRoundX, X } from 'lucide-react';
import { createUser, deleteUser, listUsers, reissueTempPassword, updateUser, type User } from '../lib/users-api';
import { listAccessRoles, type AccessRole } from '../lib/access-control-api';
import { CompactSelect } from './compact-select';
import { ConfirmDialog } from './confirm-dialog';
import { StateBlock } from './state-block';
import { TablePagination } from './table-pagination';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';

type Props = { onNotice: (message: string) => void; onError: (message: string) => void; currentActorId?: string; currentUserEmail?: string | null; };

const USER_PAGE_SIZE = 20;
const fallbackRoles: AccessRole[] = [
  { role_code: 'reader', display_name: 'Lector de plataforma', description: '', domain_code: 'platform', role_kind: 'direct', lifecycle_status: 'active', system_managed: true, permission_codes: [], level_refs: [], user_count: 0 },
  { role_code: 'operator', display_name: 'Operador de plataforma', description: '', domain_code: 'platform', role_kind: 'direct', lifecycle_status: 'active', system_managed: true, permission_codes: [], level_refs: [], user_count: 0 },
  { role_code: 'admin', display_name: 'Administrador de plataforma', description: '', domain_code: 'platform', role_kind: 'direct', lifecycle_status: 'active', system_managed: true, permission_codes: [], level_refs: [], user_count: 0 },
];
const domainLabels: Record<string, string> = { custom: 'Roles custom', platform: 'Plataforma', pam: 'CyberArk', dlp: 'Netskope', dspm: 'BigID' };
const formatPermissionCount = (count: number) => count === 1 ? '1 permiso' : `${count} permisos`;

type RolePickerProps = { value: string; options: AccessRole[]; onChange: (value: string) => void; ariaLabel: string; disabled?: boolean };

function RolePicker({ value, options, onChange, ariaLabel, disabled = false }: RolePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((role) => role.role_code === value);
  const visibleOptions = useMemo(() => options.filter((role) => `${role.display_name} ${role.role_code} ${domainLabels[role.domain_code || 'custom'] || role.domain_code || 'custom'}`.toLowerCase().includes(query.trim().toLowerCase())), [options, query]);
  const groupedOptions = useMemo(() => visibleOptions.reduce<Record<string, AccessRole[]>>((groups, role) => { (groups[role.domain_code || 'custom'] ||= []).push(role); return groups; }, {}), [visibleOptions]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) { setOpen(false); setQuery(''); } };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const choose = (roleCode: string) => { onChange(roleCode); setOpen(false); setQuery(''); };
  return <div className="role-picker" ref={rootRef}>
    <button className={`role-picker-trigger ${open ? 'open' : ''}`} type="button" aria-label={ariaLabel} title={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}><span className="role-picker-current"><span className={`role-picker-dot ${selected?.lifecycle_status || 'active'}`} />{selected?.display_name || value || 'Asignar rol'}</span><ChevronDown size={14} /></button>
    {open && <div className="role-picker-menu"><label className="role-picker-search"><Search size={14} /><span className="sr-only">Buscar roles</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar rol o producto" /></label><div className="role-picker-options" role="listbox" aria-label={ariaLabel}>{Object.entries(groupedOptions).map(([domain, domainRoles]) => <div className="role-picker-group" role="group" aria-label={domainLabels[domain] || domain} key={domain}><span className="role-picker-group-label">{domainLabels[domain] || domain}</span>{domainRoles.map((role) => <button className={`role-picker-option ${role.role_code === value ? 'selected' : ''}`} type="button" role="option" aria-selected={role.role_code === value} key={role.role_code} onClick={() => choose(role.role_code)}><span><strong>{role.display_name}</strong><small>{role.permission_codes.length ? formatPermissionCount(role.permission_codes.length) : 'Rol base'}{role.lifecycle_status === 'planned' ? ' · Preparado' : ''}</small></span>{role.role_code === value && <Check size={14} />}</button>)}</div>)}{!visibleOptions.length ? <span className="role-picker-empty">No hay roles que coincidan.</span> : null}</div></div>}
  </div>;
}

export function UserAdmin({ onNotice, onError, currentActorId, currentUserEmail }: Props) {
  const [users, setUsers] = useState<User[]>([]);
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
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const roleOptions = roles.length ? roles : fallbackRoles;
  const roleByCode = useMemo(() => new Map(roleOptions.map((role) => [role.role_code, role])), [roleOptions]);
  const selectedUser = users.find((user) => user.actor_id === selectedUserId) || null;
  const userDrawerRef = useDialogFocusTrap<HTMLDivElement>({ active: Boolean(selectedUser), onClose: () => setSelectedUserId(null) });
  const selectedRoles = useMemo(() => selectedUser?.roles.map((roleCode) => roleByCode.get(roleCode)).filter((role): role is AccessRole => Boolean(role)) || [], [roleByCode, selectedUser]);
  const selectedPermissions = useMemo(() => Array.from(new Set(selectedRoles.flatMap((role) => role.permission_codes))).sort(), [selectedRoles]);
  const permissionsByNamespace = useMemo(() => selectedPermissions.reduce<Record<string, string[]>>((groups, permission) => {
    const namespace = permission.split(':', 1)[0] || 'otros';
    (groups[namespace] ||= []).push(permission);
    return groups;
  }, {}), [selectedPermissions]);
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
  const load = async () => {
    try {
      const result = await listUsers({ search, roleFilter, statusFilter, page, pageSize: USER_PAGE_SIZE });
      setUsers(result.rows);
      setTotal(result.total);
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudieron cargar los usuarios'); }
  };
  useEffect(() => { void load(); }, [search, roleFilter, statusFilter, page]);
  useEffect(() => { void (async () => { try { const result = await listAccessRoles(); setRoles(result.rows || []); } catch { /* Keep the current user flow usable if the catalog is unavailable. */ } })(); }, []);
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
      onNotice('Usuario creado. Guardá o copiá la contraseña temporal.');
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo crear el usuario'); } finally { setBusy(false); }
  };
  const isCurrentUser = (user: User) => user.actor_id === currentActorId || (!!currentUserEmail && user.email.toLowerCase() === currentUserEmail.toLowerCase());
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
    <section className="user-admin"><div className="section-heading"><div><p className="eyebrow">PERSONAS</p><h2>Acceso a la plataforma</h2><span className="database-caption">Alta, baja y asignaciones de roles. El catálogo de permisos se administra en la pestaña contigua.</span></div><span className="database-toolbar-count">{total} {total === 1 ? 'usuario' : 'usuarios'}</span></div>{createdCredential && <aside className="created-credential" role="status"><div><strong>{createdCredential.title}</strong><span>{createdCredential.email}</span><small>Guardá esta contraseña temporal. Se muestra solo durante esta sesión.</small></div><code>{createdCredential.password}</code><button className="button subtle" type="button" onClick={() => void copyToClipboard(createdCredential.password)}><Copy size={14} /> Copiar contraseña</button><button className="icon-button" type="button" aria-label="Ocultar credencial temporal" title="Ocultar" onClick={() => setCreatedCredential(null)}><X size={15} /></button></aside>}<form className="user-create-form" noValidate onSubmit={create}><label>Email<input type="email" autoComplete="username" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label><label>Nombre<input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} required /></label><label>Rol inicial<RolePicker value={form.role_code} options={roleOptions} onChange={(role_code) => setForm({ ...form, role_code })} ariaLabel="Rol inicial del nuevo usuario" /></label><button className="button primary" type="submit" disabled={busy}><Plus size={15} /> Crear usuario</button><p className="database-caption">La contraseña temporal se genera automáticamente y se muestra una sola vez al crear el usuario.</p></form>
    <div className="search-row"><label className="search-box"><Search size={16} /><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Buscar por nombre o email" /></label></div>
    <div className="filter-row user-filter-row">
      <label>Rol<CompactSelect value={roleFilter} ariaLabel="Filtrar por rol" options={[{ value: '', label: 'Todos' }, ...roleOptions.map((role) => ({ value: role.role_code, label: role.display_name }))]} onChange={(value) => { setRoleFilter(value); setPage(0); }} /></label>
      <label>Estado<CompactSelect value={statusFilter} ariaLabel="Filtrar por estado" options={[{ value: '', label: 'Todos' }, { value: 'active', label: 'Activo' }, { value: 'pending', label: 'Pendiente de primer acceso' }, { value: 'inactive', label: 'Desactivado' }]} onChange={(value) => { setStatusFilter(value); setPage(0); }} /></label>
    </div>
    <div className="user-list">{users.map((user) => {
      const assigned = user.roles.map((roleCode) => roleByCode.get(roleCode)).filter((role): role is AccessRole => Boolean(role));
      const permissionCount = new Set(assigned.flatMap((role) => role.permission_codes)).size;
      return <div className="user-row" key={user.actor_id}><span className="user-avatar">{user.is_active ? <UserRound size={17} /> : <UserRoundX size={17} />}</span><div className="user-row-identity"><strong>{user.display_name}</strong><span>{user.email}</span></div><div className="user-row-access"><strong>{assigned[0]?.display_name || user.roles[0] || 'Sin rol'}</strong><span>{formatPermissionCount(permissionCount)}</span></div><span className={`user-status-chip ${!user.is_active ? 'inactive' : user.must_change_password ? 'pending' : 'active'}`}>{!user.is_active ? 'Desactivado' : user.must_change_password ? 'Pendiente' : 'Activo'}</span><button className="button subtle user-detail-button" type="button" aria-label={`Ver acceso de ${user.display_name}`} onClick={() => setSelectedUserId(user.actor_id)}><ShieldCheck size={14} /> Ver acceso</button></div>;
    })}{!users.length && <StateBlock
      variant={hasFilters ? 'no-results' : 'empty'}
      title={hasFilters ? 'Sin resultados para estos filtros' : 'Sin usuarios registrados'}
      hint={hasFilters ? 'Ajustá la búsqueda, el rol o el estado.' : 'Creá el primer usuario con el formulario de arriba.'}
      action={hasFilters ? <button type="button" className="button subtle" onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); setPage(0); }}>Limpiar filtros</button> : undefined}
    />}</div>
    <TablePagination page={page} pageSize={USER_PAGE_SIZE} total={total} onPageChange={setPage} />
    </section>
    {selectedUser ? <div className="user-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedUserId(null); }}><div ref={userDrawerRef} className="user-access-drawer" role="dialog" aria-modal="true" aria-labelledby="user-access-title" tabIndex={-1}>
      <header className="user-access-drawer-header"><div><p className="eyebrow">DETALLE DE ACCESO</p><h2 id="user-access-title">{selectedUser.display_name}</h2><span>{selectedUser.email}</span></div><button className="icon-button" type="button" aria-label="Cerrar detalle de acceso" title="Cerrar detalle de acceso" onClick={() => setSelectedUserId(null)}><X size={16} /></button></header>
      <section className="user-access-overview"><div><span>Estado</span><strong>{!selectedUser.is_active ? 'Desactivado' : selectedUser.must_change_password ? 'Pendiente de primer acceso' : 'Activo'}</strong></div><div><span>Acceso efectivo</span><strong>{formatPermissionCount(selectedPermissions.length)}</strong></div></section>
      <section className="user-access-drawer-section"><div className="user-access-section-heading"><div><span>ROL ASIGNADO</span><strong>{selectedRoles[0]?.display_name || selectedUser.roles[0] || 'Sin rol'}</strong></div>{selectedRoles[0]?.role_kind === 'composite' ? <span className="access-status custom">Custom</span> : null}</div>{isCurrentUser(selectedUser) ? <p className="user-access-note">Tu propio rol no se puede modificar desde esta cuenta.</p> : <RolePicker value={selectedUser.roles[0] || 'reader'} options={roleOptions} onChange={(role_code) => void update(selectedUser, { role_code })} ariaLabel={`Cambiar rol de ${selectedUser.display_name}`} />}</section>
      <section className="user-access-drawer-section"><div className="user-access-section-heading"><div><span>PERMISOS EFECTIVOS</span><strong>Heredados desde el rol</strong></div></div>{Object.entries(permissionsByNamespace).length ? <div className="user-effective-permissions">{Object.entries(permissionsByNamespace).map(([namespace, permissionCodes]) => <div key={namespace}><span>{namespace}</span>{permissionCodes.map((permission) => <code key={permission}>{permission}</code>)}</div>)}</div> : <p className="user-access-note">Este rol todavía no tiene permisos catalogados.</p>}</section>
      <footer className="user-access-drawer-actions">{isCurrentUser(selectedUser) ? <span className="user-self-badge">Tu usuario</span> : <button className="button subtle" type="button" onClick={() => void update(selectedUser, { is_active: !selectedUser.is_active })}>{selectedUser.is_active ? <><UserRoundX size={14} /> Desactivar</> : <><UserRound size={14} /> Activar</>}</button>}<button className="button subtle" type="button" disabled={!selectedUser.is_active || reissuingUserId === selectedUser.actor_id} onClick={() => setPendingReissue(selectedUser)}><KeyRound size={14} /> Regenerar acceso</button>{!isCurrentUser(selectedUser) ? <button className="button danger" type="button" disabled={deletingUserId === selectedUser.actor_id} onClick={() => requestRemove(selectedUser)}><Trash2 size={14} /> Eliminar</button> : null}</footer>
    </div></div> : null}
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
