import { Plus, Save, Shield, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Field } from '../../../cross/components/dashboard';
import { CompactSelect } from '../../../cross/components/compact-select';
import { actionLabel, businessUnitLabel, formatDate, formatNumber, inventoryScopeLabel, qualityStatusLabel, dateTimeHint } from '../../../cross/lib/format';
import { workflowLabel, workflowStatusesFor } from '../lib/safe-labels';
import type { Account, Catalogs, Member, MetadataForm, SafeDetail } from '../types/safe';
import type { AuditEntry } from '../types/audit';
import type { WorkspaceView } from '../../../cross/lib/workspaces';
import { SafeAccountList, SafeMemberList, SafeSummary } from './safe-detail-sections';
import { OverflowActions } from './overflow-actions';
import { useDialogFocusTrap } from '../../../cross/hooks/use-dialog-focus-trap';
import './safe-detail-drawer.css';

type SafeDetailDrawerProps = {
  detail: { safe: SafeDetail; members: Member[] };
  accounts: Account[];
  audit: AuditEntry[];
  catalogs: Catalogs;
  form: MetadataForm;
  saving: boolean;
  canEdit: boolean;
  onClose: () => void;
  onFormChange: (updates: Partial<MetadataForm>) => void;
  onSave: () => Promise<void>;
  onAddBusinessUnit: () => void;
  onAddResponsible: () => void;
  actionOptions: string[];
  onNavigate: (view: WorkspaceView, query?: string) => void;
};

function actionTone(action: string): string {
  const value = action.toLowerCase();
  if (value.includes('migrar')) return 'migrate';
  if (value.includes('rotar')) return 'rotate';
  if (value.includes('consultar')) return 'consult';
  if (value.includes('revisar') || value.includes('baja')) return 'retire';
  return 'undefined';
}

type DraftChange = { label: string; before: string; after: string };

function normalized(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '' : String(value);
}

function changesFor(safe: SafeDetail, form: MetadataForm, catalogs: Catalogs): DraftChange[] {
  const unitName = (value: string | number | null | undefined) => {
    if (!value) return 'Sin asignar';
    const unit = catalogs.business_units.find((item) => item.business_unit_id === Number(value));
    return unit ? businessUnitLabel(unit) : String(value);
  };
  const responsibleName = (value: string | number | null | undefined) => value ? catalogs.responsibles.find((person) => person.responsible_id === Number(value))?.display_name || String(value) : 'Sin asignar';
  const candidates: Array<[string, string | number | null | undefined, string | number | null | undefined, (value: string | number | null | undefined) => string]> = [
    ['Nombre interno', safe.internal_name, form.internal_name, (value) => normalized(value) || 'Sin definir'],
    ['Unidad de negocio', safe.business_unit_id, form.business_unit_id, unitName],
    ['Responsable', safe.responsible_id, form.responsible_id, responsibleName],
    ['Alcance', safe.inventory_scope, form.inventory_scope, (value) => inventoryScopeLabel(normalized(value))],
    ['Calidad del dato', safe.data_quality_status, form.data_quality_status, (value) => qualityStatusLabel(normalized(value))],
    ['Clasificación', safe.classification_status, form.classification_status, (value) => ({ pending: 'Pendiente', assigned: 'Asignada', review: 'Revisión' }[normalized(value)] || normalized(value))],
    ['Estado operativo', safe.workflow_status, form.workflow_status, (value) => workflowLabel(normalized(value) as MetadataForm['workflow_status']) || normalized(value)],
    ['Acción siguiente', actionLabel(safe.next_action), actionLabel(form.next_action), (value) => normalized(value) || 'Sin definir'],
    ['Asignado por', safe.assigned_by, form.assigned_by, (value) => normalized(value) || 'Sin definir'],
    ['Notas', safe.notes, form.notes, (value) => normalized(value) || 'Sin notas'],
  ];
  return candidates
    .filter(([, before, after]) => normalized(before) !== normalized(after))
    .map(([label, before, after, format]) => ({ label, before: format(before), after: format(after) }));
}

export function SafeDetailDrawer({
  detail,
  accounts,
  audit,
  catalogs,
  form,
  saving,
  canEdit,
  onClose,
  onFormChange,
  onSave,
  onAddBusinessUnit,
  onAddResponsible,
  actionOptions,
  onNavigate,
}: SafeDetailDrawerProps) {
  const selectedAction = actionLabel(form.next_action);
  const detailActions = Array.from(new Set(['', ...actionOptions, ...(selectedAction !== 'Sin definir' ? [selectedAction] : [])]));
  const [activeTab, setActiveTab] = useState<'summary' | 'accounts' | 'members' | 'classify' | 'history'>('summary');
  const tabsRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const draftChanges = changesFor(detail.safe, form, catalogs);
  const updateForm = (updates: Partial<MetadataForm>) => {
    setSaveState('idle');
    setSaveError('');
    onFormChange(updates);
  };
  const save = async () => {
    setSaveError('');
    try {
      await onSave();
      setSaveState('saved');
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar la clasificación');
    }
  };
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onClose, initialFocusRef: closeRef });
  useLayoutEffect(() => {
    const nav = tabsRef.current;
    const active = nav?.querySelector<HTMLButtonElement>('button.active');
    if (!nav || !active) return;
    const place = () => {
      nav.style.setProperty('--tab-indicator-x', `${active.offsetLeft}px`);
      nav.style.setProperty('--tab-indicator-w', `${active.offsetWidth}px`);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [activeTab, detail.safe.safe_number, detail.safe.account_count, detail.members.length, audit.length]);

  return <div ref={dialogRef} className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="safe-drawer-title" tabIndex={-1}>
    <button className="drawer-backdrop" type="button" aria-label="Cerrar detalle del Safe" onClick={onClose} />
    <aside className="detail-drawer">
      <div className="detail-title"><div className="detail-icon"><Shield size={18} /></div><div className="detail-heading"><p className="eyebrow">SAFE #{detail.safe.safe_number}</p><h2 id="safe-drawer-title">{detail.safe.safe_name}</h2><p>{detail.safe.safe_url_id} · {formatNumber(detail.safe.account_count)} cuentas · {formatNumber(detail.members.length)} miembros</p></div><button ref={closeRef} className="icon-button drawer-close" type="button" title="Cerrar detalle" aria-label="Cerrar" onClick={onClose}><X size={16} /></button></div>
      <nav className="detail-tabs" aria-label="Secciones del detalle" ref={tabsRef}>{([['summary', 'Resumen'], ['accounts', `Cuentas ${detail.safe.account_count ? `(${formatNumber(detail.safe.account_count)})` : ''}`], ['members', `Miembros ${detail.members.length ? `(${formatNumber(detail.members.length)})` : ''}`], ['classify', 'Clasificar'], ['history', `Historial ${audit.length ? `(${formatNumber(audit.length)})` : ''}`]] as const).map(([key, label]) => <button key={key} className={activeTab === key ? 'active' : ''} type="button" title={`Mostrar ${label.toLowerCase()} del Safe`} onClick={() => setActiveTab(key)}>{label}</button>)}</nav>

      {activeTab === 'summary' && <SafeSummary safe={detail.safe} />}

      {activeTab === 'summary' && <section className="detail-section safe-cross-links">
        <div className="detail-section-heading"><div><h3>Saltos a otros módulos</h3><p className="detail-summary-copy">Saltos rápidos para investigar esta Safe en otros módulos.</p></div></div>
        <div className="safe-cross-link-grid">
          <button type="button" className="identity-conn-link" onClick={() => onNavigate('sia', detail.safe.safe_name)}><span className="identity-conn-text"><strong>Buscar en SIA</strong><small>Coincidencias por nombre de Safe</small></span></button>
          {detail.members[0] && <button type="button" className="identity-conn-link" onClick={() => onNavigate(detail.members[0].member_type.toLowerCase() === 'group' ? 'identityGroups' : 'identityUsers', detail.members[0].member_name)}><span className="identity-conn-text"><strong>Buscar miembro en Identidades</strong><small>{detail.members[0].member_name} · coincidencia por nombre</small></span></button>}
        </div>
      </section>}

      {activeTab === 'classify' && <fieldset className="detail-section detail-edit-section" aria-label="Clasificación del Safe" disabled={!canEdit} style={{ border: 0, margin: 0, minWidth: 0 }}>
        <div className="detail-section-heading">
          <div>
            <h3>Seguimiento del Safe</h3>
            <p className="detail-summary-copy">Definí el estado, la próxima acción y quién lo sigue.</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Estado operativo"><CompactSelect ariaLabel="Estado operativo" value={form.workflow_status} options={workflowStatusesFor(form.workflow_status).map((status) => ({ value: status, label: workflowLabel(status) }))} onChange={(value) => updateForm({ workflow_status: value as MetadataForm['workflow_status'] })} /></Field>
          <Field label="Acción siguiente"><CompactSelect className={`action-select ${actionTone(selectedAction)}`} value={selectedAction === 'Sin definir' ? '' : selectedAction} ariaLabel="Acción siguiente" options={detailActions.map((action) => ({ value: action, label: action || 'Sin definir' }))} onChange={(value) => updateForm({ next_action: value || '' })} /></Field>
          <Field label="Unidad de negocio"><CompactSelect className={`drawer-assignment-select unit-select${form.business_unit_id ? '' : ' is-unassigned'}`} value={form.business_unit_id ? String(form.business_unit_id) : ''} ariaLabel="Unidad de negocio" onAdd={onAddBusinessUnit} addLabel="Agregar unidad" options={[{ value: '', label: 'Sin asignar' }, ...catalogs.business_units.filter((unit) => unit.is_active !== false).map((unit) => ({ value: String(unit.business_unit_id), label: businessUnitLabel(unit) }))]} onChange={(value) => updateForm({ business_unit_id: value ? Number(value) : '' })} /></Field>
          <Field label="Responsable"><CompactSelect className="drawer-assignment-select responsible-select" value={form.responsible_id ? String(form.responsible_id) : ''} ariaLabel="Responsable" onAdd={onAddResponsible} addLabel="Agregar responsable" options={[{ value: '', label: 'Sin asignar' }, ...catalogs.responsibles.filter((person) => person.is_active !== false).map((person) => ({ value: String(person.responsible_id), label: person.display_name }))]} onChange={(value) => updateForm({ responsible_id: value ? Number(value) : '' })} /></Field>
          <Field label="Notas" full><textarea value={form.notes} onChange={(event) => updateForm({ notes: event.target.value })} placeholder="Observaciones de clasificación" /></Field>
        </div>
        <details className="safe-classification-advanced">
          <summary>Más datos de clasificación <span>Opcional</span></summary>
          <div className="form-grid">
            <Field label="Nombre interno"><input value={form.internal_name} onChange={(event) => updateForm({ internal_name: event.target.value })} placeholder="Pendiente de nomenclatura" /></Field>
            <Field label="Alcance del inventario"><CompactSelect ariaLabel="Alcance del inventario" value={form.inventory_scope} options={(['pending', 'business', 'internal'] as const).map((value) => ({ value, label: inventoryScopeLabel(value) }))} onChange={(value) => updateForm({ inventory_scope: value as MetadataForm['inventory_scope'] })} /></Field>
            <Field label="Calidad del dato"><CompactSelect ariaLabel="Calidad del dato" value={form.data_quality_status} options={(['pending', 'clean', 'obsolete', 'duplicate'] as const).map((value) => ({ value, label: qualityStatusLabel(value) }))} onChange={(value) => updateForm({ data_quality_status: value as MetadataForm['data_quality_status'] })} /></Field>
            <Field label="Clasificación"><CompactSelect ariaLabel="Clasificación" value={form.classification_status} options={[{ value: 'pending', label: 'Pendiente' }, { value: 'assigned', label: 'Asignada' }, { value: 'review', label: 'Revisión' }]} onChange={(value) => updateForm({ classification_status: value as MetadataForm['classification_status'] })} /></Field>
            <Field label="Asignado por"><input value={form.assigned_by} onChange={(event) => updateForm({ assigned_by: event.target.value })} placeholder="Usuario web" /></Field>
          </div>
        </details>
        <section className="drawer-change-summary" aria-label="Resumen de cambios pendientes">
          <div className="detail-section-heading"><div><h3>Cambios pendientes</h3><p className="detail-summary-copy">Revisá qué se enviará antes de guardar.</p></div><strong>{formatNumber(draftChanges.length)}</strong></div>
          {draftChanges.length ? <div className="drawer-change-list">{draftChanges.map((change) => <div key={change.label}><span>{change.label}</span><del>{change.before}</del><b>{change.after}</b></div>)}</div> : <p className="muted">No hay cambios pendientes.</p>}
        </section>
        <div className="form-actions"><OverflowActions
          className="catalog-actions"
          ariaLabel="Acciones de catálogos"
          actions={[
            { id: 'business-unit', label: 'Unidad', icon: <Plus size={14} />, title: 'Crear una unidad de negocio para clasificar Safes', onSelect: onAddBusinessUnit },
            { id: 'responsible', label: 'Responsable', icon: <Plus size={14} />, title: 'Crear un responsable para asignar Safes', onSelect: onAddResponsible },
          ]}
        /><div className="drawer-save-area">{saveState === 'saved' && <span className="drawer-save-feedback success" role="status">Guardado correctamente</span>}{saveState === 'error' && <span className="drawer-save-feedback error" role="alert">{saveError}</span>}<button className="button primary" type="button" title="Guardar los cambios de clasificación en Custodia" onClick={() => void save()} disabled={saving || !draftChanges.length}><Save size={15} /> {saving ? 'Guardando...' : saveState === 'saved' ? 'Guardado' : 'Guardar clasificación'}</button></div></div>
      </fieldset>}

      {activeTab === 'history' && <section className="detail-section audit-section">
        <div className="detail-section-heading"><h3>Historial de cambios <span>{formatNumber(audit.length)}</span></h3></div>
        <div className="audit-list">{audit.length ? audit.map((entry) => <div className="audit-row" key={entry.audit_id}><div><strong>{entry.action === 'create' ? 'Creación' : 'Actualización'}</strong><span>{entry.entity_type} · {entry.actor_id}</span></div><time dateTime={entry.created_at} title={dateTimeHint(entry.created_at)}>{formatDate(entry.created_at)}</time></div>) : <p className="muted">Sin cambios manuales registrados.</p>}</div>
      </section>}

      {activeTab === 'accounts' && <SafeAccountList accounts={accounts} total={detail.safe.account_count} />}

      {activeTab === 'members' && <SafeMemberList members={detail.members} />}
    </aside>
  </div>;
}
