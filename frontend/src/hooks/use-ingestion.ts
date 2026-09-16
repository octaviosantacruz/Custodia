import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { IngestionPreview, IngestionRun } from '../types/ingestion';

export type SyncToast = { tone: 'running' | 'success' | 'error'; title: string; detail: string };

type QueuedSyncBatch = { runs: Array<{ run_id: string; status: string; source_system: string }> };
type LoadDashboard = (options?: { refreshStatic?: boolean }) => Promise<void>;

type UseIngestionOptions = {
  loadDashboard: LoadDashboard;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onCompleted: () => void;
};

const SOURCE_LABELS: Record<string, string> = {
  cyberark: 'CyberArk PAM',
  identity_administration: 'Identity Administration',
  sia: 'SIA',
  access: 'Access space',
};

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes === 0 ? `${remainingSeconds} s` : `${minutes} min ${remainingSeconds} s`;
}

function sourceLabel(run: IngestionRun): string {
  return SOURCE_LABELS[run.source_system || ''] || run.source_system || 'fuente';
}

function ingestionErrorMessage(run: IngestionRun): string {
  const details = Array.isArray(run.error_details) ? run.error_details : [];
  const first = details.find((item) => item.error);
  if (first?.error) {
    const scope = first.safeName && first.safeName !== '<run>' ? ' (' + first.safeName + ')' : '';
    return sourceLabel(run) + ' terminó en estado ' + run.status + scope + ': ' + first.error;
  }
  return sourceLabel(run) + ' terminó en estado ' + run.status;
}

async function waitForRun(runId: string): Promise<IngestionRun> {
  let run: IngestionRun | null = null;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    run = await api<IngestionRun>('/ingestion/runs/' + runId);
    if (!['queued', 'running'].includes(run.status)) return run;
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error('La corrida superó el tiempo de espera de la interfaz');
}

export function useIngestion({ loadDashboard, onError, onNotice, onCompleted }: UseIngestionOptions) {
  const [syncPreview, setSyncPreview] = useState<IngestionPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [ingestionBusy, setIngestionBusy] = useState(false);
  const [syncToast, setSyncToast] = useState<SyncToast | null>(null);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);
  const [syncElapsedSeconds, setSyncElapsedSeconds] = useState(0);

  useEffect(() => {
    if (syncStartedAt === null) return;
    const updateElapsed = () => setSyncElapsedSeconds(Math.floor((Date.now() - syncStartedAt) / 1000));
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [syncStartedAt]);

  useEffect(() => {
    if (!syncToast || syncToast.tone === 'running') return;
    const timeout = window.setTimeout(() => setSyncToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [syncToast]);

  const refreshAfterCompletion = async () => {
    await loadDashboard({ refreshStatic: true });
    onCompleted();
  };

  const applyIngestion = async () => {
    if (!syncPreview) return;
    setPreviewBusy(true);
    setIngestionBusy(true);
    setSyncToast({
      tone: 'running',
      title: 'Sincronización en progreso',
      detail: 'Encolando PAM (Safes y catálogos técnicos), un refresh aislado de PSM, Identity Administration, SIA y Access space. Podés seguir navegando mientras cada fuente avanza por separado.',
    });
    setSyncStartedAt(Date.now());
    setSyncElapsedSeconds(0);
    onError('');
    try {
      const started = await api<QueuedSyncBatch>('/ingestion/all/runs', {
        method: 'POST',
        body: JSON.stringify({ max_safes: 0, page_size: 100, member_delay_seconds: 0.3, reconcile_complete: true }),
      });
      // The durable queue owns the work now; leave the modal immediately so
      // navigation is never blocked while the sources run.
      setSyncPreview(null);
      const runs = await Promise.all(started.runs.map((queued) => waitForRun(queued.run_id)));
      const failed = runs.filter((run) => run.status !== 'completed');
      if (failed.length) throw new Error(failed.map(ingestionErrorMessage).join(' · '));
      const pam = runs.find((run) => run.source_system === 'cyberark');
      const pamTechnicalCatalogsRefreshed = Boolean(pam && pam.status === 'completed' && pam.pam_synced);
      onNotice(
        'Sincronización completa: Safes'
        + (pamTechnicalCatalogsRefreshed ? ' y catálogos técnicos PAM (plataformas, PSM/conectores, salud, AIM)' : '')
        + ', Identity Administration, SIA y Access space actualizados.',
      );
      setSyncToast({
        tone: 'success',
        title: 'Sincronización completada',
        detail: (pam?.received_safe_count || 0).toLocaleString('es-AR') + ' safes actualizados'
          + (pamTechnicalCatalogsRefreshed ? ' junto con plataformas, PSM/conectores, salud de componentes y AIM' : '')
          + '. Identity Administration, SIA y Access space también terminaron sus corridas aisladas.',
      });
      await refreshAfterCompletion();
    } catch (ingestionError) {
      const message = ingestionError instanceof Error ? ingestionError.message : 'No se pudo aplicar la sincronización';
      onError(message);
      setSyncToast({ tone: 'error', title: 'Sincronización interrumpida', detail: message });
    } finally {
      setPreviewBusy(false);
      setIngestionBusy(false);
      setSyncStartedAt(null);
    }
  };

  const startIngestion = async () => {
    if (previewBusy || ingestionBusy) return;
    setPreviewBusy(true);
    setSyncStartedAt(Date.now());
    setSyncElapsedSeconds(0);
    setSyncToast({ tone: 'running', title: 'Preparando comparación', detail: 'Consultando Safes de CyberArk PAM. Al confirmar también se encolan Identity Administration, SIA y Access space; los catálogos técnicos (plataformas, PSM/conectores, salud, AIM) se actualizan en la misma acción y PSM tiene un refresh aislado.' });
    onError('');
    try {
      const preview = await api<IngestionPreview>('/ingestion/preview', { method: 'POST', body: JSON.stringify({ max_safes: 0, page_size: 100, member_delay_seconds: 0.3 }) });
      setSyncPreview(preview);
      setSyncToast(null);
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : 'No se pudo preparar la comparación';
      onError(message);
      setSyncToast({ tone: 'error', title: 'Comparación interrumpida', detail: message });
    } finally {
      setPreviewBusy(false);
      setSyncStartedAt(null);
    }
  };

  return {
    syncPreview,
    setSyncPreview,
    previewBusy,
    ingestionBusy,
    syncToast,
    setSyncToast,
    syncElapsedSeconds,
    formatElapsed,
    applyIngestion,
    startIngestion,
  };
}
