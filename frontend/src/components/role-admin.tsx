import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, ChevronDown, Layers3, LockKeyhole, Plus, Save, ShieldCheck, Sparkles, X } from 'lucide-react';
import { CompactSelect } from './compact-select';
import { CustomRoleForm } from './custom-role-form';
import { usePopover } from '../hooks/use-popover';
import { createAccessPermission, createAccessRole, createCompositeAccessRole, listAccessDomains, listAccessPermissions, listAccessRoles, updateAccessRole, updateCompositeAccessRole, type AccessDomain, type AccessPermission, type AccessRole, type CustomRoleDraft } from '../lib/access-control-api';

type Props = { onNotice: (message: string) => void; onError: (message: string) => void };

const emptyDraft = { role_code: '', display_name: '', description: '', domain_code: '', permission_codes: [] as string[] };

export function RoleAdmin({ onNotice, onError }: Props) {
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [permissions, setPermissions] = useState<AccessPermission[]>([]);
  const [domains, setDomains] = useState<AccessDomain[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [creatingComposite, setCreatingComposite] = useState(false);
  const { open: createMenuOpen, setOpen: setCreateMenuOpen, ref: createMenuRef } = usePopover<HTMLDivElement>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [permissionFormOpen, setPermissionFormOpen] = useState(false);
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [permissionDraft, setPermissionDraft] = useState({ domain_code: '', resource_code: '', action_code: '', description: '' });

  const load = async (preferredCode?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [roleResult, permissionResult, domainResult] = await Promise.all([listAccessRoles(), listAccessPermissions(), listAccessDomains()]);
      const nextRoles = roleResult.rows || [];
      setRoles(nextRoles);
      setPermissions(permissionResult.rows || []);
      setDomains(domainResult.rows || []);
      setPermissionDraft((current) => current.domain_code ? current : { ...current, domain_code: domainResult.rows?.[0]?.domain_code || '' });
      if (!creating || preferredCode) {
        const nextCode = preferredCode || (selectedCode && nextRoles.some((role) => role.role_code === selectedCode) ? selectedCode : nextRoles[0]?.role_code || null);
        setSelectedCode(nextCode);
        const selected = nextRoles.find((role) => role.role_code === nextCode);
        if (selected) setDraft({ role_code: selected.role_code, display_name: selected.display_name, description: selected.description, domain_code: selected.domain_code || '', permission_codes: selected.permission_codes });
      }
    } catch (error) { const message = error instanceof Error ? error.message : 'No se pudo cargar el catálogo de acceso'; setLoadError(message); onError(message); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const visibleRoles = useMemo(() => roles.filter((role) => `${role.display_name} ${role.role_code} ${role.domain_code}`.toLowerCase().includes(query.toLowerCase().trim())), [roles, query]);
  const domainOptions = useMemo(() => domains.map((domain) => ({ value: domain.domain_code, label: domain.display_name })), [domains]);
  const domainLabels = useMemo(() => Object.fromEntries(domains.map((domain) => [domain.domain_code, domain.display_name])), [domains]);
  const selectedRole = roles.find((role) => role.role_code === selectedCode) || null;
  const editable = creating || Boolean(selectedRole && !selectedRole.system_managed);
  const groupedPermissions = useMemo(() => Object.values(permissions.reduce<Record<string, { domain: string; resource: string; permissions: AccessPermission[] }>>((groups, permission) => {
    const key = `${permission.domain_code}:${permission.resource_code}`;
    (groups[key] ||= { domain: permission.domain_code, resource: permission.resource_code, permissions: [] }).permissions.push(permission);
    return groups;
  }, {})), [permissions]);
  const activePermissionCount = permissions.filter((permission) => permission.lifecycle_status === 'active').length;
  const plannedRoleCount = roles.filter((role) => role.lifecycle_status === 'planned').length;

  const selectRole = (role: AccessRole) => {
    setCreating(false);
    setSelectedCode(role.role_code);
    setCreatingComposite(false);
    setDraft({ role_code: role.role_code, display_name: role.display_name, description: role.description, domain_code: role.domain_code || '', permission_codes: role.permission_codes });
  };

  const startCreate = (kind: 'direct' | 'composite') => {
    setCreating(true);
    setCreatingComposite(kind === 'composite');
    setCreateMenuOpen(false);
    setSelectedCode(null);
    setDraft({ ...emptyDraft, domain_code: domains[0]?.domain_code || '' });
  };
  const togglePermission = (code: string) => setDraft((current) => ({ ...current, permission_codes: current.permission_codes.includes(code) ? current.permission_codes.filter((item) => item !== code) : [...current.permission_codes, code] }));
  const save = async () => {
    if (!draft.display_name.trim() || !draft.description.trim() || (creating && !/^[a-z][a-z0-9_]{2,63}$/.test(draft.role_code))) { onError('Completá nombre, descripción y un código válido para el rol.'); return; }
    setSaving(true);
    try {
      if (creating) { await createAccessRole({ ...draft, display_name: draft.display_name.trim(), description: draft.description.trim() }); onNotice('Rol simple creado'); }
      else if (selectedRole) { const { role_code: _roleCode, ...payload } = draft; await updateAccessRole(selectedRole.role_code, { ...payload, display_name: payload.display_name.trim(), description: payload.description.trim() }); onNotice('Rol actualizado'); }
      setCreating(false);
      await load(creating ? draft.role_code : selectedRole?.role_code);
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo guardar el rol'); }
    finally { setSaving(false); }
  };
  const saveComposite = async (customDraft: CustomRoleDraft) => {
    setSaving(true);
    try {
      const result = creating
        ? await createCompositeAccessRole(customDraft)
        : await updateCompositeAccessRole(selectedRole!.role_code, {
            display_name: customDraft.display_name,
            description: customDraft.description,
            level_refs: customDraft.level_refs,
          });
      setCreating(false);
      setCreatingComposite(false);
      onNotice(result.warning ? `Rol guardado. Ya existe la misma combinación en ${result.warning.matching_role_name}.` : creating ? 'Rol custom creado' : 'Rol custom actualizado');
      await load(result.role_code);
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo guardar el rol custom'); }
    finally { setSaving(false); }
  };
  const cancelEditor = () => {
    setCreating(false);
    setCreatingComposite(false);
    setCreateMenuOpen(false);
    const selected = roles.find((role) => role.role_code === selectedCode);
    if (selected) setDraft({ role_code: selected.role_code, display_name: selected.display_name, description: selected.description, domain_code: selected.domain_code || '', permission_codes: selected.permission_codes });
  };
  const savePermission = async (event: FormEvent) => {
    event.preventDefault();
    const resource_code = permissionDraft.resource_code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const action_code = permissionDraft.action_code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const description = permissionDraft.description.trim();
    if (!resource_code || !action_code || !description) { onError('Completá recurso, acción y descripción del permiso.'); return; }
    setPermissionSaving(true);
    try {
      await createAccessPermission({ permission_code: `${resource_code}:${action_code}`, domain_code: permissionDraft.domain_code, resource_code, action_code, description });
      setPermissionFormOpen(false);
      setPermissionDraft({ domain_code: domains[0]?.domain_code || '', resource_code: '', action_code: '', description: '' });
      onNotice('Permiso personalizado creado');
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo crear el permiso'); }
    finally { setPermissionSaving(false); }
  };

  return <section className="role-admin" aria-labelledby="role-admin-title">
    <div className="role-admin-summary">
      <div><p className="eyebrow">MODELO DE ACCESO</p><h2 id="role-admin-title">Roles y permisos</h2><span className="database-caption">Los roles agrupan permisos. Los dominios futuros quedan visibles como preparación, no como acceso efectivo.</span></div>
      <div className="role-metrics"><span><strong>{roles.length}</strong><small>roles definidos</small></span><span><strong>{activePermissionCount}</strong><small>permisos activos</small></span><span className="planned"><strong>{plannedRoleCount}</strong><small>preparados</small></span></div>
    </div>
    <div className="role-admin-layout">
      <aside className="role-directory" aria-label="Catálogo de roles">
        <div className="role-directory-toolbar">
          <label className="search-box"><span className="sr-only">Buscar roles</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar roles" /></label>
          <div className="role-create-menu" ref={createMenuRef}>
            <button className="button primary" type="button" aria-haspopup="menu" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen((open) => !open)}><Plus size={14} /> Nuevo rol <ChevronDown size={13} /></button>
            {createMenuOpen ? <div className="role-create-options" role="menu">
              <button type="button" role="menuitem" onClick={() => startCreate('direct')}><ShieldCheck size={16} /><span><strong>Rol simple</strong><small>Permisos de un dominio</small></span></button>
              <button type="button" role="menuitem" onClick={() => startCreate('composite')}><Layers3 size={16} /><span><strong>Rol custom</strong><small>Un nivel por dominio</small></span></button>
            </div> : null}
          </div>
        </div>
        {loading ? <p className="database-caption role-empty">Cargando catálogo...</p> : loadError ? <div className="role-error"><strong>No se pudo cargar el catálogo</strong><span>{loadError}</span><button className="button subtle" type="button" onClick={() => void load()}>Reintentar</button></div> : !visibleRoles.length ? <p className="database-caption role-empty">No hay roles que coincidan.</p> : <div className="role-directory-list">{visibleRoles.map((role) => <button className={`role-directory-item ${role.role_code === selectedCode && !creating ? 'selected' : ''}`} type="button" key={role.role_code} onClick={() => selectRole(role)}><span className="role-directory-icon">{role.role_kind === 'composite' ? <Layers3 size={16} /> : <ShieldCheck size={16} />}</span><span className="role-directory-copy"><strong>{role.display_name}</strong><small>{role.role_kind === 'composite' ? `${role.level_refs.length} dominios` : domainLabels[role.domain_code || ''] || role.domain_code} · {role.permission_codes.length} permisos · {role.user_count} personas</small></span><span className="role-directory-badges">{role.role_kind === 'composite' ? <span className="access-status custom">Custom</span> : null}<span className={`access-status ${role.lifecycle_status}`}>{role.lifecycle_status === 'planned' ? 'Preparado' : 'Activo'}</span></span></button>)}</div>}
      </aside>
      <div className="role-editor">
        {!creating && !selectedRole ? <div className="role-editor-empty"><LockKeyhole size={24} /><strong>Elegí un rol</strong><span>Revisá su alcance y las capacidades que agrupa.</span></div> : creatingComposite || selectedRole?.role_kind === 'composite' ? <CustomRoleForm key={creatingComposite ? 'new-composite' : selectedRole?.role_code || 'selected-composite'} domains={domains} roles={roles} initialRole={creatingComposite ? null : selectedRole} saving={saving} onCancel={cancelEditor} onError={onError} onSave={saveComposite} /> : <>
          <div className="role-editor-header"><div><p className="eyebrow">{creating ? 'NUEVO ROL' : selectedRole?.system_managed ? 'ROL DEL SISTEMA' : 'ROL PERSONALIZADO'}</p><h3>{creating ? 'Crear un rol propio' : draft.display_name}</h3><span>{creating ? 'Definí una agrupación reutilizable para futuras asignaciones.' : draft.description}</span></div>{!creating && selectedRole && <span className={`access-status large ${selectedRole.lifecycle_status}`}>{selectedRole.lifecycle_status === 'planned' ? <><Sparkles size={13} /> Preparado</> : <><Check size={13} /> Activo</>}</span>}</div>
          <div className="role-form-grid"><label>Nombre visible<input disabled={!editable} value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} /></label><label>Dominio<CompactSelect disabled={!editable} value={draft.domain_code} options={domainOptions} onChange={(domain_code) => setDraft({ ...draft, domain_code })} ariaLabel="Dominio del rol" /></label>{creating && <label>Código interno<input value={draft.role_code} onChange={(event) => setDraft({ ...draft, role_code: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="ej. data_reviewer" /></label>}<label className="role-description-field">Descripción<textarea disabled={!editable} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} /></label></div>
          <div className="permission-section"><div className="permission-section-heading"><div><h4>Permisos incluidos</h4><span>Seleccioná capacidades concretas, agrupadas por dominio y recurso.</span></div><div className="permission-section-tools"><strong>{draft.permission_codes.length} seleccionados</strong><button className="button subtle" type="button" onClick={() => setPermissionFormOpen((open) => !open)}><Plus size={13} /> Nuevo permiso</button></div></div>{permissionFormOpen && <form className="permission-create-form" onSubmit={(event) => void savePermission(event)}><div><label>Recurso<input value={permissionDraft.resource_code} onChange={(event) => setPermissionDraft({ ...permissionDraft, resource_code: event.target.value })} placeholder="ej. safes" /></label><label>Acción<input value={permissionDraft.action_code} onChange={(event) => setPermissionDraft({ ...permissionDraft, action_code: event.target.value })} placeholder="ej. export" /></label><label>Dominio<CompactSelect value={permissionDraft.domain_code} options={domainOptions} onChange={(domain_code) => setPermissionDraft({ ...permissionDraft, domain_code })} ariaLabel="Dominio del nuevo permiso" /></label></div><p className="permission-code-preview">Código: <code>{permissionDraft.resource_code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'recurso'}:{permissionDraft.action_code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'acción'}</code></p><label>Descripción<input value={permissionDraft.description} onChange={(event) => setPermissionDraft({ ...permissionDraft, description: event.target.value })} placeholder="Qué habilita exactamente" /></label><div className="permission-create-actions"><button className="button subtle" type="button" onClick={() => setPermissionFormOpen(false)}><X size={13} /> Cancelar</button><button className="button primary" type="submit" disabled={permissionSaving}>{permissionSaving ? 'Creando...' : 'Crear permiso'}</button></div></form>}<div className="permission-groups">{groupedPermissions.map(({ domain, resource, permissions: resourcePermissions }) => <div className="permission-group" key={`${domain}:${resource}`}><div className="permission-group-heading"><span>{domainLabels[domain] || domain} · {resource}</span><small>{resourcePermissions.some((permission) => permission.lifecycle_status === 'planned') ? 'Incluye preparación futura' : 'Disponible'}</small></div>{resourcePermissions.map((permission) => <label className={`permission-option ${permission.lifecycle_status}`} key={permission.permission_code}><input type="checkbox" disabled={!editable} checked={draft.permission_codes.includes(permission.permission_code)} onChange={() => togglePermission(permission.permission_code)} /><span><strong>{permission.action_code}</strong><small>{permission.description}</small></span>{permission.lifecycle_status === 'planned' && <em>Preparado</em>}</label>)}</div>)}</div></div>
          {editable && <div className="role-editor-actions"><span className="database-caption">El cambio queda registrado en la actividad administrativa.</span><button className="button primary" type="button" disabled={saving} onClick={() => void save()}><Save size={14} /> {saving ? 'Guardando...' : creating ? 'Crear rol' : 'Guardar cambios'}</button></div>}
        </>}
      </div>
    </div>
  </section>;
}
