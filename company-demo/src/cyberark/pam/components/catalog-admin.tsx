import { useEffect, useState } from 'react';
import { Plus, ToggleLeft, ToggleRight, X } from 'lucide-react';
import { api } from '../../../cross/lib/api';
import { fetchIdentityUsers } from '../../identity_administration/lib/identity-admin-api';
import { useDialogFocusTrap } from '../../../cross/hooks/use-dialog-focus-trap';
import type { Catalogs } from '../types/safe';
import type { IdentityUserRow } from '../../identity_administration/types/identity';
import './catalog-admin.css';

type Props = { catalogs: Catalogs; onChanged: () => Promise<void>; onNotice: (message: string) => void; onError: (message: string) => void; onClose: () => void };

export function CatalogAdmin({ catalogs, onChanged, onNotice, onError, onClose }: Props) {
  const [unitDraft, setUnitDraft] = useState({ unit_code: '', unit_name: '' });
  const [responsibleDraft, setResponsibleDraft] = useState({ display_name: '', email: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [directoryMatches, setDirectoryMatches] = useState<IdentityUserRow[]>([]);
  const [directoryOpen, setDirectoryOpen] = useState(false);

  useEffect(() => {
    const query = responsibleDraft.display_name.trim();
    if (query.length < 2 || !directoryOpen) { setDirectoryMatches([]); return; }
    const timeout = setTimeout(() => {
      fetchIdentityUsers(query, 0, 'active').then((response) => setDirectoryMatches(response.rows.slice(0, 6))).catch(() => setDirectoryMatches([]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [responsibleDraft.display_name, directoryOpen]);

  const pickFromDirectory = (person: IdentityUserRow) => {
    setResponsibleDraft({ display_name: person.display_name, email: person.attributes.email || '' });
    setDirectoryOpen(false);
  };

  const create = async (kind: 'unit' | 'responsible') => {
    setBusy('create-' + kind);
    try {
      if (kind === 'unit') {
        await api('/business-units', { method: 'POST', body: JSON.stringify(unitDraft) });
        setUnitDraft({ unit_code: '', unit_name: '' });
      } else {
        await api('/responsibles', { method: 'POST', body: JSON.stringify(responsibleDraft) });
        setResponsibleDraft({ display_name: '', email: '' });
      }
      await onChanged();
      onNotice(kind === 'unit' ? 'Unidad creada' : 'Responsable creado');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo crear el registro');
    } finally { setBusy(null); }
  };

  const update = async (kind: 'unit' | 'responsible', item: any) => {
    setBusy(kind + '-' + item.business_unit_id + item.responsible_id);
    try {
      const path = kind === 'unit' ? '/business-units/' + item.business_unit_id : '/responsibles/' + item.responsible_id;
      const body = kind === 'unit'
        ? { unit_code: item.unit_code, unit_name: item.unit_name, is_active: item.is_active }
        : { display_name: item.display_name, email: item.email, is_active: item.is_active };
      await api(path, { method: 'PATCH', body: JSON.stringify(body) });
      await onChanged();
      onNotice('Cambios guardados');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo guardar el registro');
    } finally { setBusy(null); }
  };

  const dialogRef = useDialogFocusTrap<HTMLElement>({ onClose: busy !== null ? undefined : onClose });

  return <div className="catalog-manager-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="catalog-manager-panel" role="dialog" aria-modal="true" aria-labelledby="catalog-manager-title" tabIndex={-1}>
      <section className="catalog-admin">
        <div className="catalog-admin-header"><div><p className="eyebrow">ADMINISTRACIÓN</p><h2 id="catalog-manager-title">Catálogos operativos</h2><p className="database-caption">Unidades y responsables disponibles para asignar Safes.</p></div><button className="icon-button" type="button" aria-label="Cerrar catálogos" title="Cerrar" onClick={onClose}><X size={17} /></button></div>
    <div className="catalog-grid">
      <article className="catalog-card"><div className="catalog-card-heading"><div><p className="eyebrow">UNIDADES</p><h3>Unidades de negocio</h3></div><span>{catalogs.business_units.length}</span></div>
        <div className="catalog-create"><input aria-label="Código de unidad" placeholder="Código" value={unitDraft.unit_code} onChange={e => setUnitDraft({ ...unitDraft, unit_code: e.target.value })} /><input aria-label="Nombre de unidad" placeholder="Nombre" value={unitDraft.unit_name} onChange={e => setUnitDraft({ ...unitDraft, unit_name: e.target.value })} /><button className="icon-button" title="Crear unidad" aria-label="Crear unidad" disabled={!unitDraft.unit_code || !unitDraft.unit_name || busy !== null} onClick={() => void create('unit')}><Plus size={16} /></button></div>
        <div className="catalog-list">{catalogs.business_units.map(unit => <div className={'catalog-row ' + (!unit.is_active ? 'inactive' : '')} key={unit.business_unit_id}><div><strong>{unit.unit_code}</strong><span>{unit.unit_name}</span></div><button className="icon-button" title={unit.is_active ? 'Desactivar unidad' : 'Activar unidad'} aria-label={unit.is_active ? 'Desactivar unidad' : 'Activar unidad'} disabled={busy !== null} onClick={() => void update('unit', { ...unit, is_active: !unit.is_active })}>{unit.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}</button></div>)}</div>
      </article>
      <article className="catalog-card"><div className="catalog-card-heading"><div><p className="eyebrow">RESPONSABLES</p><h3>Personas responsables</h3></div><span>{catalogs.responsibles.length}</span></div>
        <p className="database-caption">Catálogo manual, independiente del directorio de Identity Administration. Buscá por nombre para autocompletar si la persona ya está en ese directorio.</p>
        <div className="catalog-create" style={{ position: 'relative' }}>
          <input
            aria-label="Nombre del responsable"
            placeholder="Nombre"
            value={responsibleDraft.display_name}
            onFocus={() => setDirectoryOpen(true)}
            onBlur={() => setTimeout(() => setDirectoryOpen(false), 150)}
            onChange={e => { setResponsibleDraft({ ...responsibleDraft, display_name: e.target.value }); setDirectoryOpen(true); }}
          />
          <input aria-label="Email del responsable" placeholder="Email" type="email" value={responsibleDraft.email} onChange={e => setResponsibleDraft({ ...responsibleDraft, email: e.target.value })} />
          <button className="icon-button" title="Crear responsable" aria-label="Crear responsable" disabled={!responsibleDraft.display_name || !responsibleDraft.email || busy !== null} onClick={() => void create('responsible')}><Plus size={16} /></button>
          {directoryOpen && directoryMatches.length > 0 && <div className="catalog-directory-suggestions" role="listbox">
            {directoryMatches.map((person) => (
              <button type="button" key={person.object_id} className="catalog-directory-suggestion" onMouseDown={() => pickFromDirectory(person)}>
                <strong>{person.display_name}</strong><span>{person.attributes.email || 'Sin email'}</span>
              </button>
            ))}
          </div>}
        </div>
        <div className="catalog-list">{catalogs.responsibles.map(person => <div className={'catalog-row ' + (!person.is_active ? 'inactive' : '')} key={person.responsible_id}><div><strong>{person.display_name}</strong><span>{person.email}</span></div><button className="icon-button" title={person.is_active ? 'Desactivar responsable' : 'Activar responsable'} aria-label={person.is_active ? 'Desactivar responsable' : 'Activar responsable'} disabled={busy !== null} onClick={() => void update('responsible', { ...person, is_active: !person.is_active })}>{person.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}</button></div>)}</div>
      </article>
    </div>
      </section>
    </section>
  </div>;
}
