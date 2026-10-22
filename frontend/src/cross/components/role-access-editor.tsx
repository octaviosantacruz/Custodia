import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Copy, LockKeyhole, Save, Search, ShieldAlert } from 'lucide-react';
import type { AccessDomain, AccessPermission, AccessRole, CustomRoleLevelRef } from '../lib/access-control-api';
import { findDuplicateCompositeRole, resolveCompositePermissions } from '../lib/access-role-resolution';
import { capabilityLabel, isVisibleCapability, PER_USER_DATA } from '../lib/access-labels';
import { AccessToolMark } from './access-tool-mark';
import { accessTool, type AccessTool } from '../lib/access-tool-groups';
import { CompactSelect } from './compact-select';
import { ConfirmDialog } from './confirm-dialog';
import { RoleMembers } from './role-members';
import { RoleGroupLinks } from './role-group-links';
import { AccessWorkspacePreview } from './access-workspace-preview';
import './role-access-editor.css';

export type RoleAccessDraft = {
  role_code: string; display_name: string; description: string; domain_code: string;
  role_kind: 'direct' | 'composite'; permission_codes: string[];
  level_refs: Array<Pick<CustomRoleLevelRef, 'domain_code' | 'level_code'>>;
};
type Props = {
  role: AccessRole | null; creating: boolean; copying: boolean; initialArea: string;
  catalog: { roles: AccessRole[]; domains: AccessDomain[]; permissions: AccessPermission[] };
  actorPermissions: string[]; canManage: boolean; saving: boolean; currentActorId?: string;
  onBack: () => void; onCopy: () => void; onSave: (draft: RoleAccessDraft) => Promise<boolean>;
  onAssignmentsChanged: () => void; onNotice: (message: string) => void; onError: (message: string) => void;
};
const ACTIONS: Record<string, string> = { write: 'Editar', read: 'Consultar', catalogs_read: 'Consultar', manage: 'Administrar', admin: 'Administrar', export: 'Exportar', classify: 'Clasificar', bulk_classify: 'Clasificar', run: 'Ejecutar', preview: 'Previsualizar', import: 'Importar', access: 'Navegar', dlp_read: 'Consultar', uba_read: 'Consultar' };

function makeDraft(role: AccessRole | null, creating: boolean, copying: boolean, domains: AccessDomain[]): RoleAccessDraft {
  return {
    role_code: creating ? '' : role?.role_code || '', display_name: copying ? `${role?.display_name} (copia)` : role?.display_name || '', description: role?.description || '',
    domain_code: role?.domain_code || domains.find((domain) => domain.lifecycle_status === 'active')?.domain_code || '',
    role_kind: role?.role_kind || 'direct', permission_codes: [...(role?.permission_codes || [])],
    level_refs: (role?.level_refs || []).map(({ domain_code, level_code }) => ({ domain_code, level_code })),
  };
}

export function RoleAccessEditor(props: Props) {
  const { role, creating, copying, catalog: { domains, permissions, roles }, saving } = props;
  const [initial] = useState(() => makeDraft(role, creating, copying, domains));
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState(creating);
  const [area, setArea] = useState(props.initialArea);
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(!creating);
  const [confirm, setConfirm] = useState<'leave' | 'save' | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const has = (code: string) => props.actorPermissions.includes('access:manage') || props.actorPermissions.includes(code);
  const effective = useMemo(() => draft.role_kind === 'composite' ? resolveCompositePermissions(draft.level_refs, domains) : draft.permission_codes, [draft, domains]);
  const selected = useMemo(() => new Set(effective), [effective]);
  const byCode = useMemo(() => new Map(permissions.map((permission) => [permission.permission_code, permission])), [permissions]);
  const before = creating ? [] : role?.permission_codes || [];
  const added = effective.filter((code) => !before.includes(code));
  const removed = before.filter((code) => !selected.has(code));
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(initial);
  const visibleDomains = domains.filter((domain) => domain.lifecycle_status === 'active' || draft.level_refs.some((ref) => ref.domain_code === domain.domain_code) || effective.some((code) => byCode.get(code)?.domain_code === domain.domain_code));
  const duplicate = draft.role_kind === 'composite' ? findDuplicateCompositeRole(draft.level_refs, roles, creating ? '' : draft.role_code) : null;
  const canReadPeople = ['access:directory_read', 'access:role_assignments_manage', 'access:local_users_manage'].some(has);
  const capabilityCount = effective.filter(isVisibleCapability).length;
  const navigationCount = effective.filter((code) => code.startsWith('domain:')).length;
  const planned = draft.role_kind === 'composite' && draft.level_refs.some((ref) => {
    const domain = domains.find((item) => item.domain_code === ref.domain_code);
    return domain?.lifecycle_status === 'planned' || domain?.levels.find((level) => level.level_code === ref.level_code)?.lifecycle_status === 'planned';
  });
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);

  const change = (patch: Partial<RoleAccessDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const toggle = (code: string) => change({ permission_codes: selected.has(code) ? draft.permission_codes.filter((item) => item !== code) : [...draft.permission_codes, code] });
  const setLevel = (domain_code: string, level_code: string) => change({ level_refs: [...draft.level_refs.filter((ref) => ref.domain_code !== domain_code), ...(level_code ? [{ domain_code, level_code }] : [])] });
  const leave = () => { if (dirty) setConfirm('leave'); else props.onBack(); };
  const validate = () => {
    if (draft.display_name.trim().length < 2 || draft.description.trim().length < 2) { props.onError('Completá el nombre y el propósito del rol.'); return false; }
    if (creating && !/^[a-z][a-z0-9_]{2,63}$/.test(draft.role_code)) { props.onError('El código debe tener entre 3 y 64 caracteres: letras minúsculas, números y guion bajo.'); return false; }
    return true;
  };
  const submit = async () => {
    if (!validate()) return;
    if (!creating) setConfirm('save');
    else await props.onSave(draft);
  };
  const allRows = useMemo(() => {
    const known = permissions.filter((permission) => permission.lifecycle_status === 'active' && isVisibleCapability(permission.permission_code) || selected.has(permission.permission_code) || permission.permission_code.startsWith('domain:') && permission.lifecycle_status === 'active');
    const unknown = effective.filter((code) => !byCode.has(code)).map((code): AccessPermission => ({ permission_code: code, domain_code: 'unknown', resource_code: '', action_code: '', description: 'Sin descripción en el catálogo. Se conserva hasta que lo quites explícitamente.', lifecycle_status: 'planned', system_managed: false }));
    return [...known, ...unknown];
  }, [permissions, effective, selected, byCode]);
  const filteredRows = allRows.filter((permission) => (!area || permission.domain_code === area) && (!selectedOnly || selected.has(permission.permission_code)) && `${capabilityLabel(permission.permission_code, permission)} ${permission.description} ${permission.permission_code}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const groups = [...visibleDomains.map((domain) => ({ code: domain.domain_code, name: domain.display_name })), ...(allRows.some((permission) => permission.domain_code === 'unknown') ? [{ code: 'unknown', name: 'Sin catalogar' }] : [])];
  const compartments = new Map<string, { tool: AccessTool; areas: typeof groups }>();
  for (const group of groups) {
    const tool = accessTool(group.code, domains);
    const compartment = compartments.get(tool.id) || { tool, areas: [] };
    compartment.areas.push(group);
    compartments.set(tool.id, compartment);
  }
  const toolCompartments = [...compartments.values()];
  const changes = <div className="role-review-changes" aria-label="Cambios de acceso">{[['Agrega', added], ['Quita', removed]].map(([label, codes]) => <div key={label as string}><strong>{label as string} ({(codes as string[]).length})</strong>{(codes as string[]).length ? <ul>{(codes as string[]).map((code) => <li key={code}>{capabilityLabel(code, byCode.get(code))}</li>)}</ul> : <p>Ningún permiso.</p>}</div>)}</div>;

  return <div className="role-access-editor">
    <header className="role-detail-header"><div><button ref={backRef} type="button" className="role-back" disabled={saving} onClick={leave}><ArrowLeft size={14} /> Todos los roles</button><h2>{creating ? copying ? 'Duplicar rol' : 'Nuevo rol' : role?.display_name}</h2><p>{creating ? 'Definí un perfil de acceso para tu equipo.' : role?.description}</p></div><div className="role-detail-actions">{!creating && canReadPeople ? <RoleMembers roleCode={role!.role_code} roleName={role!.display_name} count={roles.find((item) => item.role_code === role!.role_code)?.user_count ?? role!.user_count} canAssign={has('access:role_assignments_manage')} canGrant={has('access:role_assignments_manage') && role!.lifecycle_status === 'active'} currentActorId={props.currentActorId} onChanged={props.onAssignmentsChanged} onNotice={props.onNotice} onError={props.onError} /> : null}
      {!editing && props.canManage && <><button type="button" className="button subtle" disabled={role?.lifecycle_status === 'planned' && role.role_kind === 'direct'} onClick={props.onCopy}><Copy size={14} /> Duplicar como personalizado</button>{!role?.system_managed && <button className="button primary" type="button" onClick={() => { setEditing(true); setSelectedOnly(false); }}>Editar rol</button>}</>}
    </div></header>
    {editing ? <div className="role-identity-fields"><label>Nombre visible<input disabled={saving} autoComplete="off" value={draft.display_name} maxLength={100} onChange={(event) => change({ display_name: event.target.value })} /></label>{creating && <label>Código interno<input disabled={saving} autoComplete="off" value={draft.role_code} maxLength={64} placeholder="equipo_seguridad" onChange={(event) => change({ role_code: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} /></label>}<label className="role-purpose">Propósito<input disabled={saving} value={draft.description} maxLength={240} onChange={(event) => change({ description: event.target.value })} /></label></div> : <div className="role-detail-meta"><span>{role?.system_managed ? <><LockKeyhole size={13} /> Sistema · Sólo lectura</> : 'Personalizado'}</span><span>{draft.role_kind === 'composite' ? 'Niveles vinculados a roles base' : 'Permisos individuales'}</span>{role?.lifecycle_status === 'planned' && <span>Preparado · Sin acceso efectivo</span>}</div>}
    {creating && !copying && <fieldset className="role-build-mode"><legend>Cómo definir el acceso</legend><label><input type="radio" name="role-build-mode" value="direct" checked={draft.role_kind === 'direct'} disabled={saving} onChange={() => change({ role_kind: 'direct' })} /><span><strong>Capacidades concretas</strong><small>Elegí cada función que puede usar el equipo.</small></span></label><label><input type="radio" name="role-build-mode" value="composite" checked={draft.role_kind === 'composite'} disabled={saving} onChange={() => change({ role_kind: 'composite' })} /><span><strong>Niveles vinculados</strong><small>Heredá los permisos de un nivel por área.</small></span></label></fieldset>}
    <div className="role-config-layout"><section className="role-permissions-main" aria-label={`Accesos de ${draft.display_name || 'el nuevo rol'}`}>
      {draft.role_kind === 'composite' && <section className="role-level-builder" aria-label="Niveles por área"><div><h3>Niveles vinculados</h3><p>Los cambios del rol base se heredan. Las áreas sin participación no otorgan permisos.</p></div><div className="role-level-compartments">{toolCompartments.map(({ tool, areas: toolAreas }) => <section key={tool.id} className="role-level-tool"><h4><AccessToolMark tool={tool} />{tool.name}</h4><div className="role-level-grid">{visibleDomains.filter((domain) => toolAreas.some((group) => group.code === domain.domain_code)).map((domain) => {
        const value = draft.level_refs.find((ref) => ref.domain_code === domain.domain_code)?.level_code || '';
        const options = domain.levels.filter((level) => level.level_code === value || domain.lifecycle_status === 'active' && level.lifecycle_status === 'active' && level.permission_codes.every(has));
        return <label key={domain.domain_code}><span>{domain.display_name}{domain.lifecycle_status === 'planned' ? ' · Preparado' : ''}</span><CompactSelect ariaLabel={`Nivel para ${domain.display_name}`} disabled={!editing || saving} value={value} options={[{ value: '', label: 'Sin participación' }, ...options.map((level) => ({ value: level.level_code, label: level.display_name }))]} onChange={(next) => setLevel(domain.domain_code, next)} /></label>;
      })}</div></section>)}</div>{duplicate && <p className="role-inline-warning">La combinación coincide con {duplicate.display_name}.</p>}</section>}
      <div className="role-capability-heading"><h3>{editing && draft.role_kind === 'direct' ? 'Elegí las capacidades' : 'Capacidades incluidas'}</h3><span>{capabilityCount} capacidades · {navigationCount} accesos de navegación</span></div>
      <div className="role-capability-tools"><label className="search-box"><Search size={15} /><span className="sr-only">Buscar capacidades</span><input type="search" placeholder="Buscar función o permiso" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="role-only-selected"><input type="checkbox" checked={selectedOnly} onChange={(event) => setSelectedOnly(event.target.checked)} /> Sólo incluidos</label></div>
      <nav className="role-area-filters" aria-label="Filtrar capacidades por área"><button type="button" aria-pressed={!area} onClick={() => setArea('')}>Todas las áreas</button>{groups.map((group) => <button type="button" aria-pressed={area === group.code} key={group.code} onClick={() => setArea(group.code)}><AccessToolMark tool={accessTool(group.code, domains)} />{group.name}</button>)}</nav>
      <table className="role-capability-table" aria-label="Permisos por capacidad"><thead><tr><th scope="col">{editing && draft.role_kind === 'direct' ? 'Habilitar' : 'Incluido'}</th><th scope="col">Capacidad</th><th scope="col">Acción</th><th scope="col">Alcance</th></tr></thead>
        {toolCompartments.map(({ tool, areas: toolAreas }) => {
          const items = filteredRows.filter((permission) => toolAreas.some((group) => group.code === permission.domain_code));
          if (!items.length) return null;
          return <tbody key={tool.id}><tr className="role-area-band"><th scope="rowgroup" colSpan={4}><AccessToolMark tool={tool} /><span>{tool.name}</span></th></tr>{items.map((permission) => {
            const code = permission.permission_code;
            const included = selected.has(code);
            const allowed = included || has(code);
            const navigation = code.startsWith('domain:');
            const legacy = !isVisibleCapability(code) && !navigation;
            return <tr className={included ? 'is-included' : ''} key={code}><td>{editing && draft.role_kind === 'direct' ? <input type="checkbox" aria-label={`Habilitar ${capabilityLabel(code, permission)}`} checked={included} disabled={saving || !allowed || !included && (permission.lifecycle_status === 'planned' || legacy)} onChange={() => toggle(code)} /> : included ? <Check size={15} aria-label="Incluido" /> : <span aria-label="Sin incluir">—</span>}</td><th scope="row"><span>{capabilityLabel(code, permission)}</span><small><span className="role-permission-area">{groups.find((group) => group.code === permission.domain_code)?.name} · </span>{permission.description}{!allowed ? ' · Fuera de tu alcance de delegación.' : ''}{legacy ? ' · Permiso heredado sin función actual.' : ''}</small></th><td><span className={navigation ? 'role-action-navigation' : 'role-action-label'}>{navigation ? 'Navegación' : ACTIONS[permission.action_code] || (permission.action_code.endsWith('read') ? 'Consultar' : permission.action_code.endsWith('manage') ? 'Administrar' : permission.action_code ? 'Personalizada' : 'Sin dato')}</span></td><td>{navigation ? 'Menú del área' : permission.domain_code === 'unknown' ? 'Sin dato' : PER_USER_DATA.has(code) ? <span className="role-sensitive">Datos por usuario</span> : 'Área completa'}</td></tr>;
          })}</tbody>;
        })}
        {!filteredRows.length && <tbody><tr><td colSpan={4} className="role-capability-empty">No hay capacidades que coincidan con estos filtros.</td></tr></tbody>}
      </table>
      <p className="role-capability-note">La navegación abre el menú de un área. Cada función requiere además su permiso específico.</p>
      <details className="role-technical"><summary>Códigos técnicos</summary><p>{[...effective].sort().join(' · ') || 'Sin permisos.'}</p></details>
    </section><aside className="role-impact" aria-label="Resumen del acceso"><h3>{editing ? 'Antes de guardar' : 'Este perfil habilita'}</h3><ul className="role-access-summary">{groups.map((group) => {
      const codes = effective.filter((code) => byCode.get(code)?.domain_code === group.code && isVisibleCapability(code));
      if (!codes.length) return null;
      return <li key={group.code}><strong>{group.name}</strong><span>{codes.map((code) => capabilityLabel(code, byCode.get(code))).join(' · ')}</span></li>;
    })}</ul>{!capabilityCount && <p>Sin capacidades seleccionadas.</p>}
      {editing && <>{changes}<p className="role-impact-note">{creating ? 'Crear el rol no lo asigna a ninguna persona.' : 'El cambio alcanza a todas las identidades con este rol.'}</p></>}
      {draft.role_kind === 'composite' && <p className="role-impact-note">Las capacidades se actualizan al cambiar los roles base.</p>}
      {planned && <p className="role-inline-warning">Incluye un área preparada. El rol permanece sin acceso efectivo hasta que esté activo.</p>}
      <AccessWorkspacePreview codes={effective} unavailable={planned || !editing && role?.lifecycle_status === 'planned' ? 'Rol preparado: sin acceso efectivo.' : undefined} />
      {!creating && has('access:oidc_mappings_read') && <RoleGroupLinks groups={roles.find((item) => item.role_code === role?.role_code)?.oidc_groups || []} />}
    </aside></div>
    {editing && <footer className="role-save-bar"><span>{added.length} permisos agregados · {removed.length} quitados</span><div><button type="button" className="button subtle" disabled={saving} onClick={leave}>Cancelar</button><button type="button" className="button primary" disabled={saving || draft.role_kind === 'composite' && !draft.level_refs.length} onClick={() => void submit()}><Save size={14} /> {saving ? 'Guardando...' : creating ? 'Crear rol' : 'Guardar cambios'}</button></div></footer>}
    {confirm && createPortal(<ConfirmDialog titleId="role-review-title" descriptionId="role-review-description" title={confirm === 'leave' ? 'Descartar cambios' : 'Revisar cambios del rol'} description={confirm === 'leave' ? 'Los cambios de este rol todavía no se guardaron.' : 'Estos cambios afectan a todas las cuentas que tengan el rol, por Custodia o por Okta.'} icon={<ShieldAlert size={20} />} onClose={() => setConfirm(null)} closeDisabled={saving} confirmLabel={confirm === 'leave' ? 'Descartar' : 'Guardar cambios'} confirmBusyLabel="Guardando..." confirmBusy={saving} confirmTone={confirm === 'leave' ? 'danger' : 'primary'} backdropClassName="role-review-backdrop" fallbackFocusRef={backRef} onConfirm={() => { if (confirm === 'leave') props.onBack(); else void props.onSave(draft).then((ok) => { if (ok) setConfirm(null); }); }}>{confirm === 'save' && changes}</ConfirmDialog>, document.body)}
  </div>;
}
