import { useEffect, useState } from 'react';
import { FileUp } from 'lucide-react';
import { previewConnectionImport } from '../lib/connection-inventory-api';
import { formatNumber } from '../lib/format';
import type { ConnectionImportMode, ConnectionImportPreview, ConnectionImportSample, ConnectionInventoryImportRow } from '../types/connection';
import { ConfirmDialog } from './confirm-dialog';

type Props = {
  fileName: string;
  rows: ConnectionInventoryImportRow[];
  busy: boolean;
  onConfirm: (mode: ConnectionImportMode) => void;
  onClose: () => void;
};

const MODE_LABELS: Record<ConnectionImportMode, string> = { update: 'Actualizar', replace: 'Reemplazar todo' };
const FIELD_LABELS: Record<string, string> = {
  instance_name: 'instancia', environment: 'ambiente', ca_sia: 'Platform', ca_dba: 'DBA',
  zsp_implemented: 'ZSP', access_available: 'acceso', description: 'descripción',
};

function destination(sample: ConnectionImportSample): string {
  return sample.port ? `${sample.private_ip}:${sample.port}` : sample.private_ip;
}

function SampleList({ title, samples, total, detail }: { title: string; samples: ConnectionImportSample[]; total: number; detail?: (sample: ConnectionImportSample) => string }) {
  if (!total) return null;
  return <div className="connection-import-group">
    <strong>{title} <span className="muted">({formatNumber(total)})</span></strong>
    <ul>{samples.map((sample) => <li key={`${sample.private_ip}:${sample.port ?? ''}`}><span className="mono">{destination(sample)}</span> {sample.instance_name}{detail ? <span className="muted"> · {detail(sample)}</span> : null}</li>)}</ul>
    {total > samples.length && <span className="muted">y {formatNumber(total - samples.length)} más</span>}
  </div>;
}

export function ConnectionImportDialog({ fileName, rows, busy, onConfirm, onClose }: Props) {
  const [mode, setMode] = useState<ConnectionImportMode>('update');
  const [preview, setPreview] = useState<ConnectionImportPreview | null>(null);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let current = true;
    setPreview(null);
    setFailure('');
    previewConnectionImport({ file_name: fileName, rows, mode })
      .then((result) => { if (current) setPreview(result); })
      .catch((error: unknown) => { if (current) setFailure(error instanceof Error ? error.message : 'No se pudo calcular la vista previa'); });
    return () => { current = false; };
  }, [fileName, rows, mode]);

  const counts = preview?.counts;
  const blocked = !preview || preview.errors.length > 0;
  const missingLabel = mode === 'update' ? 'Se retiran' : 'Se quitan';
  return <ConfirmDialog
    icon={<FileUp size={18} aria-hidden />} titleId="connection-import-title" title="Importar destinos"
    descriptionId="connection-import-description"
    description={<>{fileName} · {formatNumber(rows.length)} filas. La clave es IP y puerto.</>}
    confirmTone="primary" confirmLabel="Importar" confirmBusyLabel="Importando…"
    confirmBusy={busy} confirmDisabled={blocked} onConfirm={() => onConfirm(mode)} onClose={onClose} closeDisabled={busy}
    backdropClassName="connection-import-backdrop"
  >
    <div className="connection-import-modes" role="radiogroup" aria-label="Modo de importación">
      {(['update', 'replace'] as const).map((value) => <label key={value} className={mode === value ? 'is-active' : ''}>
        <input type="radio" name="connection-import-mode" checked={mode === value} onChange={() => setMode(value)} disabled={busy} />{MODE_LABELS[value]}
      </label>)}
    </div>
    {failure ? <p role="alert" className="connection-import-error">{failure}</p> : !preview ? <p className="muted" role="status">Calculando cambios…</p> : <>
      <dl className="connection-import-counts" aria-label="Resumen de la importación">
        <div><dt>Nuevos</dt><dd>{formatNumber(counts!.new)}</dd></div>
        <div><dt>Cambian</dt><dd>{formatNumber(counts!.changed)}</dd></div>
        <div><dt>Sin cambios</dt><dd>{formatNumber(counts!.unchanged)}</dd></div>
        <div><dt>{missingLabel}</dt><dd>{formatNumber(counts!.missing)}</dd></div>
      </dl>
      {preview.errors.length > 0 && <div className="connection-import-group" role="alert"><strong>Filas con error</strong>
        <ul>{preview.errors.slice(0, 20).map((error) => <li key={error.row}>Fila {error.row}: {error.message}</li>)}</ul></div>}
      <SampleList title="Nuevos" samples={preview.samples.new} total={counts!.new} />
      <SampleList title="Cambian" samples={preview.samples.changed} total={counts!.changed} detail={(sample) => sample.reactivated && !sample.fields.length ? 'vuelve a Activo' : sample.fields.map((field) => FIELD_LABELS[field] ?? field).join(', ')} />
      <SampleList title={missingLabel} samples={preview.samples.missing} total={counts!.missing} />
    </>}
  </ConfirmDialog>;
}
