import { useEffect, useState, type FormEvent } from 'react';
import type { NetskopeGoldenSuggestion } from '../types/netskope';
import { Plus, Trash2, X } from 'lucide-react';
import { useDialogFocusTrap } from '../../../cross/hooks/use-dialog-focus-trap';
import { fetchNetskopeBaselines, fetchNetskopeFleet, fetchNetskopeGoldenSuggestion, saveNetskopeGoldenReleases, saveNetskopeOsMinimums } from '../lib/netskope-api';

export type NetskopeBaselineKind = 'client' | 'os';

type Props = { kind: NetskopeBaselineKind; osOptions: string[]; onClose: () => void; onSaved: () => void };

/* Admin-only editor for the Netskope compliance baselines. The backend
   validates, normalizes, enforces netskope:admin and audits every save;
   this form only collects the values. */
export function NetskopeBaselineEditor({ kind, osOptions, onClose, onSaved }: Props) {
  const [releases, setReleases] = useState('');
  const [suggestion, setSuggestion] = useState<NetskopeGoldenSuggestion>(null);
  const [minimums, setMinimums] = useState<Array<{ os: string; version: string }>>([]);
  const [observed, setObserved] = useState<Array<{ os: string; os_version: string; count: number }>>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogFocusTrap<HTMLFormElement>({ onClose: saving ? undefined : onClose });
  const isClient = kind === 'client';

  useEffect(() => {
    let cancelled = false;
    fetchNetskopeBaselines().then((baselines) => {
      if (cancelled) return;
      const client = baselines.client_golden_releases;
      const os = baselines.os_minimum_versions;
      setReleases(client ? client.value.releases.join(', ') : '');
      setMinimums(os ? Object.entries(os.value.minimums).map(([name, version]) => ({ os: name, version })) : osOptions.slice(0, 2).map((name) => ({ os: name, version: '' })));
      setNote((isClient ? client?.note : os?.note) || '');
    }).catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'No se pudo leer la línea base'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isClient, osOptions]);

  useEffect(() => {
    if (!isClient) return;
    let cancelled = false;
    // Best effort: the suggestion is a convenience, so a failed read never blocks the manual form.
    fetchNetskopeGoldenSuggestion().then((value) => { if (!cancelled) setSuggestion(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isClient]);

  useEffect(() => {
    if (isClient) return;
    let cancelled = false;
    // Reference only: what the fleet reports today. The minimum is still a decision the admin takes.
    fetchNetskopeFleet().then((fleet) => { if (!cancelled) setObserved(Array.isArray(fleet?.by_os_version) ? fleet.by_os_version : []); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isClient]);

  const suggestedText = Array.isArray(suggestion?.releases) ? suggestion.releases.join(', ') : '';
  const useSuggestion = () => {
    setReleases(suggestedText);
    setNote(`Sugerida por docs.netskope.com (leída ${suggestion?.fetched_at.slice(0, 10)}), confirmada por un admin`);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (isClient) await saveNetskopeGoldenReleases(releases.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean), note.trim());
      else await saveNetskopeOsMinimums(Object.fromEntries(minimums.filter((row) => row.os.trim() || row.version.trim()).map((row) => [row.os.trim(), row.version.trim()])), note.trim());
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar la línea base');
      setSaving(false);
    }
  };

  const title = isClient ? 'Releases golden del cliente' : 'Versiones mínimas de SO';
  return <div className="catalog-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form ref={dialogRef} className="catalog-modal netskope-baseline-editor" role="dialog" aria-modal="true" aria-labelledby="netskope-baseline-title" tabIndex={-1} onSubmit={(event) => void submit(event)}>
      <div className="catalog-modal-header">
        <div><p className="eyebrow">NETSKOPE · LÍNEA BASE</p><h2 id="netskope-baseline-title">{title}</h2><p>{isClient ? 'Cargá las releases golden vigentes según la documentación oficial de Netskope, de la más nueva a la más vieja. No se infieren del inventario.' : 'Versión mínima soportada por sistema operativo. El nombre debe coincidir exactamente con el que reporta Netskope.'}</p></div>
        <button className="icon-button" type="button" aria-label="Cerrar" title="Cerrar" onClick={onClose} disabled={saving}><X size={17} /></button>
      </div>
      <div className="catalog-modal-fields">
        {loading ? <p className="muted">Cargando línea base…</p> : isClient
          ? <><label>Releases golden<input value={releases} onChange={(event) => setReleases(event.target.value)} placeholder="141.0.0, 138.1.0, 135.0.0" required /><small className="muted">Al menos dos, separadas por coma. Se ordenan de la más nueva a la más vieja al guardar.</small></label>
            {suggestion && suggestedText && suggestedText !== releases ? <p className="muted netskope-golden-suggestion">Sugerida por la documentación pública de Netskope: <strong>{suggestedText}</strong> (leída el {suggestion.fetched_at.slice(0, 10)}). No se aplica sola. <button className="button subtle" type="button" onClick={useSuggestion}>Usar sugerida</button></p> : null}</>
          : <div className="netskope-os-minimums">
            {minimums.map((row, index) => <div className="netskope-os-minimum-row" key={index}>
              <label>Sistema operativo<input list="netskope-os-options" value={row.os} onChange={(event) => setMinimums((current) => current.map((item, i) => i === index ? { ...item, os: event.target.value } : item))} placeholder="Windows" /></label>
              <label>Versión mínima<input value={row.version} onChange={(event) => setMinimums((current) => current.map((item, i) => i === index ? { ...item, version: event.target.value } : item))} placeholder="10.0.19045" /></label>
              <button className="icon-button" type="button" aria-label={`Quitar ${row.os || 'fila'}`} onClick={() => setMinimums((current) => current.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
            </div>)}
            {observed.length ? <div className="netskope-os-observed" aria-label="Versiones de SO informadas hoy">
              <small className="muted">Versiones informadas hoy (referencia, no un mínimo):</small>
              <ul>{observed.map((row) => <li key={`${row.os}-${row.os_version}`}><strong>{row.os}</strong> {row.os_version} <span className="muted">· {row.count} equipos</span></li>)}</ul>
            </div> : null}
            <datalist id="netskope-os-options">{osOptions.map((name) => <option key={name} value={name} />)}</datalist>
            <button className="button subtle" type="button" onClick={() => setMinimums((current) => [...current, { os: '', version: '' }])} disabled={minimums.length >= 10}><Plus size={13} aria-hidden="true" /> Agregar sistema operativo</button>
          </div>}
        <label>Nota (opcional)<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Fuente o motivo del cambio" /></label>
        {error ? <p className="netskope-baseline-error" role="alert">{error}</p> : null}
      </div>
      <div className="catalog-modal-actions"><button className="button subtle" type="button" onClick={onClose} disabled={saving}>Cancelar</button><button className="button primary" type="submit" disabled={saving || loading}>{saving ? 'Guardando...' : 'Guardar línea base'}</button></div>
    </form>
  </div>;
}
