import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { api } from '../../../cross/lib/api';
import type { Catalogs, MetadataForm, SafeRow, WorkflowStatus } from '../types/safe';
import type { SafeDetailState } from './use-safe-detail';
import { t } from '../../../cross/i18n/index.ts';

type LoadDashboard = (options?: { refreshStatic?: boolean }) => Promise<void>;

type UseSafeMutationsOptions = {
  catalogs: Catalogs;
  detail: SafeDetailState | null;
  form: MetadataForm;
  setDetail: Dispatch<SetStateAction<SafeDetailState | null>>;
  setForm: Dispatch<SetStateAction<MetadataForm>>;
  setSafes: Dispatch<SetStateAction<SafeRow[]>>;
  loadDashboard: LoadDashboard;
  selectSafe: (safeNumber: number) => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

export function useSafeMutations({
  catalogs, detail, form, setDetail, setForm, setSafes, loadDashboard, selectSafe,
  onError, onNotice,
}: UseSafeMutationsOptions) {
  const [saving, setSaving] = useState(false);
  const [savingSafeNumber, setSavingSafeNumber] = useState<number | null>(null);
  // Presentational only: holds a Safe for ~900ms after a successful write so
  // its row can play a one-shot "saved" flash. Never set on failure.
  const [savedSafeNumber, setSavedSafeNumber] = useState<number | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);
  const flashSaved = useCallback((safeNumber: number) => {
    window.clearTimeout(savedTimer.current);
    setSavedSafeNumber(safeNumber);
    savedTimer.current = window.setTimeout(() => setSavedSafeNumber(null), 900);
  }, []);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const quickUpdate = useCallback(async (safe: SafeRow, updates: { workflow_status?: WorkflowStatus; next_action?: string | null }) => {
    setSavingSafeNumber(safe.safe_number);
    onError('');
    const nextWorkflow = updates.workflow_status || safe.workflow_status;
    const nextAction = nextWorkflow === 'resolved' ? null : (updates.next_action === undefined ? safe.next_action : updates.next_action);
    try {
      await api(`/safes/${safe.safe_number}/quick-update`, {
        method: 'PATCH', body: JSON.stringify({ workflow_status: nextWorkflow, next_action: nextAction }),
      });
      setSafes((current) => current.map((row) => row.safe_number === safe.safe_number ? { ...row, workflow_status: nextWorkflow, next_action: nextAction } : row));
      setDetail((current) => current && current.safe.safe_number === safe.safe_number ? { ...current, safe: { ...current.safe, workflow_status: nextWorkflow, next_action: nextAction } } : current);
      setForm((current) => detail?.safe.safe_number === safe.safe_number ? { ...current, workflow_status: nextWorkflow, next_action: nextAction || '' } : current);
      onNotice('Cambio guardado');
      flashSaved(safe.safe_number);
    } catch (error) {
      onError(error instanceof Error ? error.message : t('No se pudo guardar el cambio'));
    } finally {
      setSavingSafeNumber(null);
    }
  }, [detail?.safe.safe_number, flashSaved, onError, onNotice, setDetail, setForm, setSafes]);

  const saveAssignment = useCallback(async (safe: SafeRow, assignment: { business_unit_id: number | null; responsible_id: number | null }) => {
    setSavingSafeNumber(safe.safe_number);
    onError('');
    try {
      await api(`/safes/${safe.safe_number}/assignment`, { method: 'PATCH', body: JSON.stringify(assignment) });
      const unit = catalogs.business_units.find((item) => item.business_unit_id === assignment.business_unit_id);
      const responsible = catalogs.responsibles.find((item) => item.responsible_id === assignment.responsible_id);
      setSafes((current) => current.map((row) => row.safe_number === safe.safe_number ? {
        ...row, ...assignment, business_unit_name: unit?.unit_name || null,
        responsible_name: responsible?.display_name || null,
        classification_status: assignment.business_unit_id && assignment.responsible_id ? 'assigned' : 'pending',
      } : row));
      onNotice(t('Asignación guardada'));
      flashSaved(safe.safe_number);
    } catch (error) {
      onError(error instanceof Error ? error.message : t('No se pudo guardar la asignación'));
      throw error;
    } finally {
      setSavingSafeNumber(null);
    }
  }, [catalogs.business_units, catalogs.responsibles, flashSaved, onError, onNotice, setSafes]);

  const applyBulkRowUpdate = useCallback((
    succeeded: { safe_number: number; business_unit_id: number | null; responsible_id: number | null }[],
  ) => {
    if (!succeeded.length) return;
    setSafes((current) => current.map((row) => {
      const match = succeeded.find((item) => item.safe_number === row.safe_number);
      if (!match) return row;
      const unit = catalogs.business_units.find((item) => item.business_unit_id === match.business_unit_id);
      const responsible = catalogs.responsibles.find((item) => item.responsible_id === match.responsible_id);
      return {
        ...row, business_unit_id: match.business_unit_id, responsible_id: match.responsible_id,
        business_unit_name: unit?.unit_name || null, responsible_name: responsible?.display_name || null,
        classification_status: match.business_unit_id && match.responsible_id ? 'assigned' : 'pending',
      };
    }));
  }, [catalogs.business_units, catalogs.responsibles, setSafes]);

  const bulkSaveAssignment = useCallback(async (
    rows: SafeRow[],
    changes: { business_unit_id: number | null | undefined; responsible_id: number | null | undefined },
  ) => {
    onError('');
    // Both fields chosen: one atomic transaction on the server (one audit row
    // per Safe, absent Safes reported rather than fabricated).
    if (changes.business_unit_id !== undefined && changes.responsible_id !== undefined) {
      try {
        const result = await api<{ updated: number; missing_safe_numbers: number[] }>('/safes/bulk-assignment', {
          method: 'POST',
          body: JSON.stringify({
            safe_numbers: rows.map((row) => row.safe_number),
            business_unit_id: changes.business_unit_id,
            responsible_id: changes.responsible_id,
          }),
        });
        const missing = new Set(result.missing_safe_numbers);
        applyBulkRowUpdate(rows.filter((row) => !missing.has(row.safe_number)).map((row) => ({
          safe_number: row.safe_number,
          business_unit_id: changes.business_unit_id as number | null,
          responsible_id: changes.responsible_id as number | null,
        })));
        if (!missing.size) onNotice(t('Asignación aplicada a {updated} {Safes}.', { updated: result.updated, Safes: result.updated === 1 ? 'Safe' : 'Safes' }));
        else onError(t('Se aplicó a {updated} de {rows}. {size} ya no existen en el inventario.', { updated: result.updated, rows: rows.length, size: missing.size }));
        return [...missing];
      } catch (error) {
        onError(error instanceof Error ? error.message : t('No se pudo aplicar la reclasificación masiva'));
        return rows.map((row) => row.safe_number);
      }
    }
    // Mixed with "no cambiar": resolve each row against its current value.
    const succeeded: { safe_number: number; business_unit_id: number | null; responsible_id: number | null }[] = [];
    const failed: number[] = [];
    for (const row of rows) {
      const assignment = {
        business_unit_id: changes.business_unit_id === undefined ? row.business_unit_id : changes.business_unit_id,
        responsible_id: changes.responsible_id === undefined ? row.responsible_id : changes.responsible_id,
      };
      setSavingSafeNumber(row.safe_number);
      try {
        await api(`/safes/${row.safe_number}/assignment`, { method: 'PATCH', body: JSON.stringify(assignment) });
        succeeded.push({ safe_number: row.safe_number, ...assignment });
      } catch {
        failed.push(row.safe_number);
      }
    }
    setSavingSafeNumber(null);
    applyBulkRowUpdate(succeeded);
    if (failed.length === 0) {
      onNotice(t('Asignación aplicada a {succeeded} {Safes}.', { succeeded: succeeded.length, Safes: succeeded.length === 1 ? 'Safe' : 'Safes' }));
    } else if (succeeded.length === 0) {
      onError(t('No se pudo aplicar la asignación a ninguna de las {failed} Safes seleccionadas.', { failed: failed.length }));
    } else {
      onError(t('Se aplicó a {succeeded} de {rows} Safes. {failed} fallaron, podés reintentar con las que quedaron seleccionadas.', { succeeded: succeeded.length, rows: rows.length, failed: failed.length }));
    }
    return failed;
  }, [applyBulkRowUpdate, onError, onNotice, setSavingSafeNumber]);

  const saveMetadata = useCallback(async () => {
    if (!detail) return;
    setSaving(true);
    try {
      await api(`/safes/${detail.safe.safe_number}/metadata`, { method: 'PATCH', body: JSON.stringify(form) });
      onNotice(t('Clasificación guardada'));
      flashSaved(detail.safe.safe_number);
      await Promise.all([loadDashboard({ refreshStatic: true }), selectSafe(detail.safe.safe_number)]);
    } catch (error) {
      onError(error instanceof Error ? error.message : t('No se pudo guardar'));
      throw error;
    } finally {
      setSaving(false);
    }
  }, [detail, flashSaved, form, loadDashboard, onError, onNotice, selectSafe]);

  return { saving, savingSafeNumber, savedSafeNumber, quickUpdate, saveAssignment, bulkSaveAssignment, saveMetadata };
}
