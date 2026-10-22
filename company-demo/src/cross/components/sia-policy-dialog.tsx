import { useEffect, useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { fetchSiaPolicies, saveSiaPolicyCapabilities } from '../lib/connection-inventory-api';
import { POLICY_CAPABILITY_LABELS } from '../lib/connection-coverage-reading';
import { formatNumber } from '../lib/format';
import type { PolicyCapability, SiaPolicyRow } from '../types/connection';
import { CompactSelect } from './compact-select';
import { ConfirmDialog } from './confirm-dialog';

type Props = { onSaved: (changed: number) => void; onClose: () => void };

const UNSET = '';
const OPTIONS = [{ value: UNSET, label: 'Sin clasificar' }, ...(Object.entries(POLICY_CAPABILITY_LABELS) as [PolicyCapability, string][]).map(([value, label]) => ({ value, label }))];

/** A person decides what each SIA policy is (Platform, DBA or other); the name only offers a suggestion. */
export function SiaPolicyDialog({ onSaved, onClose }: Props) {
  const [policies, setPolicies] = useState<SiaPolicyRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchSiaPolicies(controller.signal)
      .then((rows) => { setPolicies(rows); setDraft(Object.fromEntries(rows.map((row) => [row.source_id, row.capability ?? UNSET]))); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : 'No se pudieron cargar las políticas'); });
    return () => controller.abort();
  }, []);

  const changes = useMemo(() => (policies ?? []).filter((row) => (draft[row.source_id] ?? UNSET) !== (row.capability ?? UNSET)), [policies, draft]);
  const suggestable = (policies ?? []).filter((row) => row.suggested && (draft[row.source_id] ?? UNSET) === UNSET);

  const save = async () => {
    setSaving(true); setFailure('');
    try {
      const result = await saveSiaPolicyCapabilities(changes.map((row) => ({ policy_source_id: row.source_id, capability: (draft[row.source_id] || null) as PolicyCapability | null })));
      onSaved(result.changed);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'No se pudo guardar la clasificación');
    } finally { setSaving(false); }
  };

  return <ConfirmDialog
    icon={<ListChecks size={18} aria-hidden />} titleId="sia-policy-title" title="Clasificar políticas SIA"
    descriptionId="sia-policy-description"
    description="Decidí qué es cada política. Con eso se compara lo declarado en la planilla contra lo que SIA muestra."
    confirmTone="primary" confirmLabel={changes.length ? `Guardar ${changes.length}` : 'Guardar'} confirmBusyLabel="Guardando…"
    confirmBusy={saving} confirmDisabled={changes.length === 0} onConfirm={() => void save()} onClose={onClose} closeDisabled={saving}
    backdropClassName="connection-import-backdrop"
  >
    {failure && <p className="connection-import-error" role="alert">{failure}</p>}
    {!policies && !failure && <p className="muted" role="status">Cargando políticas…</p>}
    {policies && <>
      <div className="policy-dialog-tools">
        <button type="button" className="button subtle" disabled={saving || suggestable.length === 0} onClick={() => setDraft((current) => ({ ...current, ...Object.fromEntries(suggestable.map((row) => [row.source_id, row.suggested as string])) }))}>Usar sugerencias por nombre ({suggestable.length})</button>
      </div>
      <ul className="policy-dialog-list">
        {policies.map((row) => <li key={row.source_id}>
          <span className="policy-dialog-name"><strong>{row.display_name}</strong><span className="muted">{formatNumber(row.destinations)} {row.destinations === 1 ? 'destino' : 'destinos'}{row.suggested && (draft[row.source_id] ?? UNSET) !== row.suggested ? ` · sugerida: ${POLICY_CAPABILITY_LABELS[row.suggested]}` : ''}</span></span>
          <CompactSelect value={draft[row.source_id] ?? UNSET} ariaLabel={`Clasificación de ${row.display_name}`} disabled={saving} options={OPTIONS} onChange={(value) => setDraft((current) => ({ ...current, [row.source_id]: value }))} />
        </li>)}
      </ul>
    </>}
  </ConfirmDialog>;
}
