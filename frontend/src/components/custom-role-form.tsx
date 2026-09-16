import { useMemo, useState } from 'react';
import { AlertTriangle, Layers3, Save, X } from 'lucide-react';

import { findDuplicateCompositeRole, resolveCompositePermissions } from '../lib/access-role-resolution';
import type { AccessDomain, AccessRole, CustomRoleDraft } from '../lib/access-control-api';
import { CompactSelect } from './compact-select';

type Props = {
  domains: AccessDomain[];
  roles: AccessRole[];
  initialRole?: AccessRole | null;
  saving: boolean;
  onCancel: () => void;
  onError: (message: string) => void;
  onSave: (draft: CustomRoleDraft) => Promise<void>;
};

function initialSelections(domains: AccessDomain[], role?: AccessRole | null) {
  const selectedByDomain = new Map(role?.level_refs.map((ref) => [ref.domain_code, ref.level_code]) || []);
  return domains.map((domain) => ({
    domain_code: domain.domain_code,
    level_code: selectedByDomain.get(domain.domain_code) || domain.levels[0]?.level_code || '',
  }));
}

export function CustomRoleForm({ domains, roles, initialRole, saving, onCancel, onError, onSave }: Props) {
  const editing = Boolean(initialRole);
  const [draft, setDraft] = useState<CustomRoleDraft>(() => ({
    role_code: initialRole?.role_code || '',
    display_name: initialRole?.display_name || '',
    description: initialRole?.description || '',
    level_refs: initialSelections(domains, initialRole),
  }));
  const effectivePermissions = useMemo(() => resolveCompositePermissions(draft.level_refs, domains), [domains, draft.level_refs]);
  const duplicate = useMemo(() => findDuplicateCompositeRole(draft.level_refs, roles, initialRole?.role_code), [draft.level_refs, initialRole?.role_code, roles]);
  const missingLevel = draft.level_refs.some((ref) => !ref.level_code);

  const setLevel = (domainCode: string, levelCode: string) => {
    setDraft((current) => ({
      ...current,
      level_refs: current.level_refs.map((ref) => ref.domain_code === domainCode ? { ...ref, level_code: levelCode } : ref),
    }));
  };

  const submit = async () => {
    if (!draft.display_name.trim()) { onError('Ingresá un nombre visible para el rol custom.'); return; }
    if (!draft.description.trim()) { onError('Ingresá una descripción para el rol custom.'); return; }
    if (!editing && !/^[a-z][a-z0-9_]{2,63}$/.test(draft.role_code)) { onError('Ingresá un código interno válido.'); return; }
    if (missingLevel) { onError('Seleccioná un nivel para cada dominio.'); return; }
    await onSave({ ...draft, display_name: draft.display_name.trim(), description: draft.description.trim() });
  };

  return <div className="custom-role-form">
    <div className="custom-role-intro">
      <span className="custom-role-icon"><Layers3 size={18} /></span>
      <div><p className="eyebrow">ROL CUSTOM</p><h3>{editing ? draft.display_name : 'Combinar niveles por dominio'}</h3><span>Referencia niveles existentes. Si cambia un nivel base, este rol hereda el cambio automáticamente.</span></div>
    </div>

    <div className="role-form-grid custom-role-fields">
      <label>Nombre visible<input value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} /></label>
      {!editing ? <label>Código interno<input value={draft.role_code} onChange={(event) => setDraft({ ...draft, role_code: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="ej. security_lead" /></label> : null}
      <label className="role-description-field">Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} /></label>
    </div>

    <div className="custom-role-levels" aria-label="Niveles por dominio">
      {domains.map((domain) => {
        const selected = draft.level_refs.find((ref) => ref.domain_code === domain.domain_code)?.level_code || '';
        return <section className="custom-role-domain" key={domain.domain_code}>
          <div><strong>{domain.display_name}</strong><span className={`access-status ${domain.lifecycle_status}`}>{domain.lifecycle_status === 'planned' ? 'Preparado' : 'Activo'}</span></div>
          {domain.levels.length ? <CompactSelect
            value={selected}
            options={domain.levels.map((level) => ({ value: level.level_code, label: level.display_name }))}
            onChange={(levelCode) => setLevel(domain.domain_code, levelCode)}
            ariaLabel={`Nivel para ${domain.display_name}`}
          /> : <span className="custom-role-no-levels">No hay niveles disponibles.</span>}
        </section>;
      })}
    </div>

    {duplicate ? <div className="custom-role-warning" role="status"><AlertTriangle size={15} /><span>La combinación coincide con <strong>{duplicate.display_name}</strong>. Podés guardarla igualmente.</span></div> : null}

    <div className="custom-role-effective">
      <div><strong>Permisos efectivos</strong><span>{effectivePermissions.length} resultantes de {domains.length} dominios</span></div>
      <div>{effectivePermissions.map((code) => <code key={code}>{code}</code>)}</div>
    </div>

    <div className="role-editor-actions">
      <button className="button subtle" type="button" onClick={onCancel}><X size={14} /> Cancelar</button>
      <button className="button primary" type="button" disabled={saving || missingLevel} onClick={() => void submit()}><Save size={14} /> {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear rol custom'}</button>
    </div>
  </div>;
}
