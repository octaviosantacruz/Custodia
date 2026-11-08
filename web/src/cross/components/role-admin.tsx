import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, ChevronDown, Plus, Search } from 'lucide-react';
import { AccessToolMark } from './access-tool-mark';
import { groupAccessRoles } from '../lib/access-tool-groups';
import { CompactSelect } from './compact-select';
import { RoleAccessEditor, type RoleAccessDraft } from './role-access-editor';
import { RoleMembers } from './role-members';
import { StateBlock } from './state-block';
import { capabilityLabel, isVisibleCapability } from '../lib/access-labels';
import { createAccessPermission, createAccessRole, createCompositeAccessRole, listAccessDomains, listAccessPermissions, listAccessRoles, updateAccessRole, updateCompositeAccessRole, type AccessDomain, type AccessPermission, type AccessRole } from '../lib/access-control-api';
import './role-admin.css';
import { t } from '../i18n/index.ts';

type Props = { onNotice: (message: string) => void; onError: (message: string) => void; permissions: string[]; currentActorId?: string };
type Editor = { role: AccessRole | null; creating: boolean; area: string; copy: boolean };

export function RoleAdmin(props: Props) {
  const has = (code: string) => props.permissions.includes('access:manage') || props.permissions.includes(code);
  const canManage = has('access:roles_manage');
  const canReadPeople = ['access:directory_read', 'access:local_users_manage', 'access:role_assignments_manage'].some(has);
  const [catalog, setCatalog] = useState<{ roles: AccessRole[]; permissions: AccessPermission[]; domains: AccessDomain[] }>({ roles: [], permissions: [], domains: [] });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [permissionDraft, setPermissionDraft] = useState({ domain_code: '', resource_code: '', action_code: '', description: '' });
  const newRoleRef = useRef<HTMLButtonElement>(null);
  const catalogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const load = async () => {
    setError('');
    try {
      const [roles, permissions, domains] = await Promise.all([listAccessRoles(), listAccessPermissions(), listAccessDomains()]);
      const result = { roles: roles.rows, permissions: permissions.rows, domains: [...domains.rows].sort((a, b) => a.sort_order - b.sort_order) };
      setCatalog(result);
      return result;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cargar el catálogo'); return null; }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (editor) catalogRef.current?.focus({ preventScroll: true });
    else if (openerRef.current) (openerRef.current.isConnected ? openerRef.current : newRoleRef.current || catalogRef.current)?.focus({ preventScroll: true });
  }, [editor]);

  const byCode = useMemo(() => new Map(catalog.permissions.map((permission) => [permission.permission_code, permission])), [catalog.permissions]);
  const rows = useMemo(() => catalog.roles.filter((role) => {
    const matches = filter === 'all' || (filter === 'planned' ? role.lifecycle_status === 'planned' : role.lifecycle_status === 'active' && (filter === 'active' || (filter === 'system' ? role.system_managed : !role.system_managed)));
    const term = query.trim().toLocaleLowerCase();
    return matches && `${role.display_name} ${role.description} ${role.role_code} ${role.permission_codes.map((code) => capabilityLabel(code, byCode.get(code))).join(' ')}`.toLocaleLowerCase().includes(term);
  }), [catalog.roles, query, filter, byCode]);
  const roleGroups = useMemo(() => groupAccessRoles(rows, catalog.domains, catalog.permissions), [rows, catalog.domains, catalog.permissions]);
  const open = (role: AccessRole | null, area = '') => {
    openerRef.current = document.activeElement as HTMLElement;
    setEditor({ role, area, creating: !role, copy: false });
  };
  const refreshRoles = async () => {
    try { const { rows: roles } = await listAccessRoles(); setCatalog((current) => ({ ...current, roles })); }
    catch (reason) { props.onError(reason instanceof Error ? reason.message : 'No se pudieron actualizar las asignaciones'); }
  };
  const save = async (draft: RoleAccessDraft) => {
    setSaving(true);
    try {
      const base = { display_name: draft.display_name.trim(), description: draft.description.trim() };
      let code = draft.role_code;
      let warning = '';
      if (draft.role_kind === 'composite') {
        const result = editor?.creating
          ? await createCompositeAccessRole({ ...base, role_code: code, level_refs: draft.level_refs })
          : await updateCompositeAccessRole(code, { ...base, level_refs: draft.level_refs });
        code = result.role_code;
        if (result.warning) warning = ` La combinación coincide con ${result.warning.matching_role_name}.`;
      } else {
        const payload = { ...base, domain_code: draft.domain_code, permission_codes: draft.permission_codes };
        if (editor?.creating) await createAccessRole({ ...payload, role_code: code });
        else await updateAccessRole(code, payload);
      }
      props.onNotice(`${editor?.creating ? t('Rol personalizado creado') : t('Rol actualizado')}.${warning}`);
      // A successful write must not become retryable merely because the subsequent refresh failed.
      setEditor(null); setQuery(''); setFilter('all');
      await load();
      return true;
    } catch (reason) { props.onError(reason instanceof Error ? reason.message : 'No se pudo guardar el rol'); return false; }
    finally { setSaving(false); }
  };
  const savePermission = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      const draft = { ...permissionDraft, domain_code: permissionDraft.domain_code || catalog.domains.find((domain) => domain.lifecycle_status === 'active')?.domain_code || '' };
      await createAccessPermission({ ...draft, permission_code: `${draft.resource_code}:${draft.action_code}` });
      setPermissionOpen(false); setPermissionDraft({ domain_code: '', resource_code: '', action_code: '', description: '' });
      props.onNotice(t('Permiso personalizado creado')); await load();
    } catch (reason) { props.onError(reason instanceof Error ? reason.message : 'No se pudo crear el permiso'); }
    finally { setSaving(false); }
  };

  return <section className="user-admin role-admin" ref={catalogRef} tabIndex={-1} aria-label={t('Administración de roles')}>
    {loading ? <StateBlock variant="loading" title={t('Cargando catálogo de acceso')} /> : error ? <StateBlock variant="error" title={t('No se pudo cargar el catálogo')} hint={error} action={<button className="button subtle" type="button" onClick={() => void load()}>{t('Reintentar')}</button>} /> : editor ? <RoleAccessEditor
      key={`${editor.creating}:${editor.role?.role_code || 'new'}:${editor.copy}`}
      role={editor.role} creating={editor.creating} copying={editor.copy} initialArea={editor.area}
      catalog={catalog} actorPermissions={props.permissions} canManage={canManage} saving={saving}
      currentActorId={props.currentActorId} onNotice={props.onNotice} onError={props.onError}
      onBack={() => setEditor(null)} onSave={save} onAssignmentsChanged={() => void refreshRoles()}
      onCopy={() => setEditor({ ...editor, creating: true, copy: true })}
    /> : <>
      <header className="role-map-header"><div><h2>{t('Roles y permisos')}</h2><p>{t('Compará qué habilita cada rol en Custodia.')}</p></div>{canManage && <button ref={newRoleRef} className="button primary" type="button" onClick={() => open(null)}><Plus size={15} /> {t('Nuevo rol')}</button>}</header>
      <div className="role-map-toolbar"><label className="search-box"><Search size={16} /><span className="sr-only">{t('Buscar roles')}</span><input type="search" placeholder={t('Buscar por rol o capacidad')} value={query} onChange={(event) => setQuery(event.target.value)} /></label><CompactSelect ariaLabel={t('Filtrar roles')} value={filter} options={[{ value: 'active', label: t('Roles activos') }, { value: 'custom', label: t('Personalizados') }, { value: 'system', label: t('Del sistema') }, { value: 'planned', label: t('Preparados') }, { value: 'all', label: t('Todos los roles') }]} onChange={setFilter} /><span className="role-result-count" role="status">{rows.length} de {catalog.roles.length} roles</span></div>
      <div className="role-compartments" role="region" aria-label={t('Mapa de accesos por rol')}>{roleGroups.map(({ tool, roles: toolRoles, areas }) => {
        const hasUnknown = toolRoles.some((role) => role.permission_codes.some((code) => !byCode.has(code)));
        return <details className="role-tool-compartment" open key={tool.id}><summary><AccessToolMark tool={tool} /><span><strong>{tool.name}</strong><small>{toolRoles.length} {toolRoles.length === 1 ? 'rol' : 'roles'}</small></span><ChevronDown size={15} /></summary><div className="role-map-scroll"><table className="role-map" aria-label={`${tool.name}: roles y permisos`}><thead><tr><th scope="col">{t('Rol')}</th>{areas.map((area) => <th scope="col" key={area.domain_code}>{area.display_name}{area.lifecycle_status === 'planned' && <small>{t('Preparado')}</small>}</th>)}{hasUnknown && <th scope="col">{t('Sin catalogar')}</th>}{canReadPeople && <th scope="col">{t('Asignaciones')}</th>}<th scope="col"><span className="sr-only">{t('Detalle')}</span></th></tr></thead><tbody>
        {toolRoles.map((role) => <tr key={role.role_code}><th scope="row"><button className="role-name-button" type="button" onClick={() => open(role)}><AccessToolMark tool={tool} /><span><strong>{role.display_name}</strong><small>{role.system_managed ? 'Sistema' : role.role_kind === 'composite' ? t('Niveles vinculados') : t('Personalizado')}{role.lifecycle_status === 'planned' ? t(' · Preparado') : ''}</small></span></button></th>
          {areas.map((area) => {
            const codes = role.permission_codes.filter((code) => byCode.get(code)?.domain_code === area.domain_code);
            const capabilities = codes.filter(isVisibleCapability);
            const linked = role.level_refs.find((ref) => ref.domain_code === area.domain_code);
            return <td key={area.domain_code}>{codes.length || linked ? <button className="role-area-access" type="button" aria-label={`Ver ${area.display_name} de ${role.display_name}`} onClick={() => open(role, area.domain_code)} title={codes.map((code) => capabilityLabel(code, byCode.get(code))).join('\n')}><span>{capabilities.length ? `${capabilities.length} ${capabilities.length === 1 ? 'capacidad' : 'capacidades'}` : codes.some((code) => code.startsWith('domain:')) ? 'Sólo navegación' : linked ? t('Nivel vinculado') : t('Permisos heredados')}</span><small>{linked ? area.levels.find((level) => level.level_code === linked.level_code)?.display_name || linked.level_code : capabilities.some((code) => !(byCode.get(code)?.action_code || '').endsWith('read')) ? t('Incluye acciones') : t('Consulta')}</small></button> : <span className="role-no-access" aria-label={t('Sin acceso')}>—</span>}</td>;
          })}
          {hasUnknown && <td>{role.permission_codes.filter((code) => !byCode.has(code)).length || '—'}</td>}
          {canReadPeople && <td><RoleMembers roleCode={role.role_code} roleName={role.display_name} count={role.user_count} canAssign={has('access:role_assignments_manage')} canGrant={has('access:role_assignments_manage') && role.lifecycle_status === 'active'} currentActorId={props.currentActorId} onChanged={() => void refreshRoles()} onNotice={props.onNotice} onError={props.onError} /></td>}
          <td><button className="icon-button" type="button" aria-label={`Abrir ${role.display_name}`} onClick={() => open(role)}><ArrowUpRight size={16} /></button></td>
        </tr>)}
      </tbody></table></div></details>;
      })}{!roleGroups.length && <StateBlock compact variant="empty" title={t('Sin roles para estos filtros')} hint="Probá otro nombre o cambiá el filtro." />}</div>
      <p className="role-map-legend">{t('Cada celda muestra capacidades del catálogo. Abrila para ver el detalle. «—» indica que ese rol no otorga acceso al área.')}</p>
      {has('access:permissions_manage') && <details className="role-permission-catalog"><summary>Administrar catálogo de permisos (avanzado)</summary><p>{t('Registrar un permiso requiere que una función del backend lo aplique.')}</p><button className="button subtle" type="button" onClick={() => setPermissionOpen((value) => !value)}><Plus size={14} /> {t('Nuevo permiso')}</button>{permissionOpen && <form className="permission-create-form" onSubmit={(event) => void savePermission(event)}><label>{t('Recurso')}<input required pattern="[a-z][a-z0-9_-]+" value={permissionDraft.resource_code} onChange={(event) => setPermissionDraft({ ...permissionDraft, resource_code: event.target.value })} /></label><label>{t('Acción')}<input required pattern="[a-z][a-z0-9_-]+" value={permissionDraft.action_code} onChange={(event) => setPermissionDraft({ ...permissionDraft, action_code: event.target.value })} /></label><label>{t('Área')}<CompactSelect ariaLabel={t('Área del nuevo permiso')} value={permissionDraft.domain_code} options={catalog.domains.filter((domain) => domain.lifecycle_status === 'active').map((domain) => ({ value: domain.domain_code, label: domain.display_name }))} onChange={(domain_code) => setPermissionDraft({ ...permissionDraft, domain_code })} /></label><label className="permission-description">{t('Descripción')}<input required minLength={2} maxLength={240} value={permissionDraft.description} onChange={(event) => setPermissionDraft({ ...permissionDraft, description: event.target.value })} /></label><div><button className="button subtle" type="button" onClick={() => setPermissionOpen(false)}>{t('Cancelar')}</button><button className="button primary" type="submit" disabled={saving}>{t('Crear permiso')}</button></div></form>}</details>}
    </>}
  </section>;
}
