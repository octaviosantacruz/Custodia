import { AlertTriangle, Check, X } from 'lucide-react';
import { formatNumber } from '../lib/format';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import type { FieldChange, IngestionPreview } from '../types/ingestion';

type SyncPreviewProps = {
  preview: IngestionPreview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function ChangeLine({ label, value }: { label: string; value: number }) {
  return <div className="sync-change-line"><span>{label}</span><strong>{formatNumber(value)}</strong></div>;
}

function SampleList({ title, values }: { title: string; values: { safe_number: number; safe_name?: string; member_id?: string; member_name?: string }[] }) {
  if (!values.length) return null;
  return <div className="sync-sample-group"><strong>{title}</strong><span>{values.slice(0, 5).map((item) => item.safe_name || item.member_name || item.member_id).join(', ')}{values.length > 5 ? ' y ' + formatNumber(values.length - 5) + ' más' : ''}</span></div>;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  return String(value);
}

function ChangeRows({ changes }: { changes: FieldChange[] }) {
  return <ul className="sync-diff-rows">
    {changes.map((change, index) => <li key={`${change.field}-${index}`} className="sync-diff-row">
      <span className="sync-diff-field">{change.field}</span>
      <span className="sync-diff-values"><span className="sync-diff-before">{formatValue(change.before)}</span> → <span className="sync-diff-after">{formatValue(change.after)}</span></span>
    </li>)}
  </ul>;
}

function ChangedSafes({ items }: { items: IngestionPreview['samples']['changed_safes'] }) {
  const withDetail = items.filter((item) => item.changes.length);
  if (!withDetail.length) return null;
  return <details className="sync-diff-group">
    <summary>Safes modificados <span>{formatNumber(withDetail.length)}</span></summary>
    {withDetail.map((item) => <div key={item.safe_number} className="sync-diff-entry">
      <div className="sync-diff-entry-head"><strong>{item.safe_name}</strong></div>
      <ChangeRows changes={item.changes} />
    </div>)}
  </details>;
}

function ChangedMembers({ items }: { items: IngestionPreview['samples']['changed_members'] }) {
  const withDetail = items.filter((item) => item.changes.length);
  if (!withDetail.length) return null;
  const attention = withDetail.filter((item) => item.security_relevant).length;
  return <details className="sync-diff-group">
    <summary>
      Miembros de Safe modificados <span>{formatNumber(withDetail.length)}</span>
      {attention > 0 ? <span className="sync-diff-attention"><AlertTriangle size={13} /> {formatNumber(attention)} requiere atención</span> : null}
    </summary>
    {withDetail.map((item) => <div key={`${item.safe_number}-${item.member_id}`} className={item.security_relevant ? 'sync-diff-entry is-attention' : 'sync-diff-entry'}>
      <div className="sync-diff-entry-head">
        <strong>{item.member_name || item.member_id}</strong>
        <span className="muted">Safe {item.safe_number}</span>
        {item.security_relevant ? <span className="sync-diff-attention"><AlertTriangle size={12} /> permiso / tipo</span> : null}
      </div>
      <ChangeRows changes={item.changes} />
    </div>)}
  </details>;
}

function QueuedSourceCard({ title, description }: { title: string; description: string }) {
  return <div className="sync-preview-card sync-preview-source">
    <span>{title}</span>
    <strong>Se encolará</strong>
    <p>{description}</p>
  </div>;
}

export function SyncPreview({ preview, busy, onConfirm, onCancel }: SyncPreviewProps) {
  const safe = preview.safe_counts;
  const dialogRef = useDialogFocusTrap<HTMLElement>({ onClose: busy ? undefined : onCancel });
  return <div className="sync-modal-backdrop" role="presentation">
    <section ref={dialogRef} className="sync-modal" role="dialog" aria-modal="true" aria-labelledby="sync-preview-title" tabIndex={-1}>
      <div className="sync-modal-header">
        <div><p className="eyebrow">REVISIÓN DE CAMBIOS</p><h2 id="sync-preview-title">Sincronización lista para confirmar</h2><p>La comparación previa corresponde a Safes. Al confirmar se encola PAM, un refresh aislado de PSM y, si están configuradas, Identity Administration, SIA y Access space. Podés seguir navegando mientras las corridas avanzan.</p></div>
        <button className="icon-button" type="button" title="Cancelar" aria-label="Cancelar sincronización" onClick={onCancel} disabled={busy}><X size={18} /></button>
      </div>
      <div className="sync-preview-grid">
        <div className="sync-preview-card">
          <span>PAM · Safes y catálogos técnicos</span>
          <strong>{formatNumber(safe.incoming)}</strong>
          <ChangeLine label="Nuevos" value={safe.new} />
          <ChangeLine label="Modificados" value={safe.changed} />
          <ChangeLine label="Retirados" value={safe.retired} />
          <p>Si esta corrida de Safes es completa y no tiene errores, la misma corrida PAM también actualiza plataformas, PSM/conectores, salud de componentes y AIM. Si Safes falla, esos catálogos técnicos no se tocan.</p>
        </div>
        <QueuedSourceCard title="Identity Administration" description="Directorio SCIM. Se encola sólo si el contrato está configurado; el resultado se informa al finalizar su corrida." />
        <QueuedSourceCard title="SIA" description="Políticas de acceso y, si están configurados sus paths, conectores y VMs (source_system = sia). Se encola sólo si el contrato está configurado; el resultado se informa al finalizar su corrida." />
        <QueuedSourceCard title="Access space" description="Assets del Access space; la relación con plataformas PAM sólo se muestra por platformId exacto en lectura, nunca por nombre. Se encola sólo si el contrato está configurado; el resultado se informa al finalizar su corrida." />
      </div>
      {preview.warning && <div className="sync-preview-warning"><AlertTriangle size={17} /><span>{preview.warning}</span></div>}
      {!preview.can_reconcile && !preview.warning && <div className="sync-preview-warning"><AlertTriangle size={17} /><span>Esta corrida no puede marcar ausencias como retiradas; solo una corrida completa y exitosa reconcilia.</span></div>}
      <div className="sync-diff-detail">
        <ChangedSafes items={preview.samples.changed_safes} />
        <ChangedMembers items={preview.samples.changed_members} />
      </div>
      <div className="sync-samples">
        <SampleList title="Safes nuevos" values={preview.samples.new_safes} />
        <SampleList title="Miembros de Safe nuevos" values={preview.samples.new_members} />
        <SampleList title="Safes retirados" values={preview.samples.retired_safes} />
        <SampleList title="Miembros de Safe retirados" values={preview.samples.retired_members} />
      </div>
      <div className="sync-modal-actions">
        <button className="button secondary" type="button" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button className="button primary" type="button" onClick={onConfirm} disabled={busy || !preview.can_reconcile}><Check size={15} /> {busy ? 'Aplicando...' : 'Aplicar todas las fuentes'}</button>
      </div>
    </section>
  </div>;
}
