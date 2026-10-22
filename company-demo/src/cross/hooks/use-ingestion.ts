/**
 * Lanza la sincronización manual sin paso de confirmación, observa
 * las corridas encoladas y comunica progreso y finalización a la interfaz.
 * El trabajo durable y la exclusión por fuente pertenecen al backend.
 */
import { SYNC_BY_SOURCE, REGISTERED_SYNCS } from '../../sources.ts';
import type { Domain, ManualSyncAction } from '../../source-contract.ts';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { syncSourcesForScope, syncToolLabel, syncToolsForSources } from '../lib/sync-source';
import type { IngestionRun } from '../types/ingestion';

export type SyncToast = {
  tone: 'running' | 'success' | 'error';
  title: string;
  detail: string;
  sources: string[];
};

type QueuedSyncBatch = { runs: Array<{ run_id: string; status: string; source_system: string; task_key?: string | null }> };
type LoadDashboard = (options?: { refreshStatic?: boolean }) => Promise<void>;

type UseIngestionOptions = {
  loadDashboard: LoadDashboard;
  onError: (message: string) => void;
  onCompleted: (domain: Domain) => void;
};

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes === 0 ? `${remainingSeconds} s` : `${minutes} min ${remainingSeconds} s`;
}

function sourceLabel(run: IngestionRun): string {
  return SYNC_BY_SOURCE[run.source_system || '']?.meta.label || run.source_system || 'fuente';
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

/** A run that ended "partial" finished and wrote data (a bounded capture or an
 * optional layer left work behind); only failed or cancelled runs are errors. */
function isFinishedRun(run: IngestionRun): boolean {
  return run.status === 'completed' || run.status === 'partial';
}

function warningSuffix(runs: readonly IngestionRun[]): string {
  const warned = runs.filter((run) => run.status === 'partial');
  return warned.length ? ' Con avisos: ' + warned.map(sourceLabel).join(', ') + '.' : '';
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

export function useIngestion({ loadDashboard, onError, onCompleted }: UseIngestionOptions) {
  const [syncBusy, setSyncBusy] = useState(false);
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
    onCompleted('pam');
  };

  const requestSourceRefresh = async (action: Extract<ManualSyncAction, { kind: 'direct' }>) => {
    if (syncBusy || ingestionBusy) return;
    setSyncBusy(true);
    setIngestionBusy(true);
    setSyncStartedAt(Date.now());
    setSyncElapsedSeconds(0);
    setSyncToast({
      tone: 'running', title: action.runningTitle,
      detail: action.runningDetail,
      sources: [action.source],
    });
    onError('');
    try {
      const queued = await api<{ run_id: string; status: string; runs?: Array<{ run_id: string }> }>(action.path, { method: 'POST' });
      // A source may enqueue several independent tasks; success needs all of them.
      const runs = await Promise.all((queued.runs?.length ? queued.runs : [queued]).map((item) => waitForRun(item.run_id)));
      const failed = runs.filter((run) => !isFinishedRun(run));
      if (failed.length) throw new Error(failed.map(ingestionErrorMessage).join(' · '));
      setSyncToast({
        tone: 'success', title: action.successTitle,
        detail: action.successDetail + warningSuffix(runs), sources: [action.source],
      });
      onCompleted(SYNC_BY_SOURCE[action.source].domain);
    } catch (error) {
      const message = error instanceof Error ? error.message : action.errorFallback;
      onError(message);
      setSyncToast({ tone: 'error', title: action.errorTitle, detail: message, sources: [action.source] });
    } finally {
      setSyncBusy(false);
      setIngestionBusy(false);
      setSyncStartedAt(null);
    }
  };

  const requestRefresh = async (scope: 'all' | 'cyberark') => {
    if (syncBusy || ingestionBusy) return;
    setSyncBusy(true);
    setIngestionBusy(true);
    setSyncToast({
      tone: 'running',
      title: 'Sincronización en progreso',
      detail: scope === 'cyberark'
        ? 'Actualizando CyberArk en corridas independientes.'
        : 'Actualizando las herramientas configuradas en corridas independientes.',
      sources: syncSourcesForScope(scope),
    });
    setSyncStartedAt(Date.now());
    setSyncElapsedSeconds(0);
    onError('');
    try {
      const started = await api<QueuedSyncBatch>('/ingestion/all/runs?scope=' + scope, {
        method: 'POST',
        body: JSON.stringify({ max_safes: 0, page_size: 100, member_delay_seconds: 0.3, reconcile_complete: true }),
      });
      const sources = [...new Set(started.runs.map((run) => run.source_system).filter(Boolean))];
      const tools = syncToolsForSources(sources);
      setSyncToast((current) => current ? { ...current, sources: tools } : current);
      // The durable queue owns the work now; leave the modal immediately so
      // navigation is never blocked while the sources run.
      const runs = await Promise.all(started.runs.map((queued) => waitForRun(queued.run_id)));
      const failed = runs.filter((run) => !isFinishedRun(run));
      if (failed.length) throw new Error(failed.map(ingestionErrorMessage).join(' · '));
      const completedTools = tools.map(syncToolLabel);
      setSyncToast({
        tone: 'success',
        title: 'Sincronización completada',
        detail: completedTools.length
          ? `${completedTools.join(' y ')} ${completedTools.length === 1 ? 'actualizado' : 'actualizados'}.${warningSuffix(runs)}`
          : `Sincronización completada.${warningSuffix(runs)}`,
        sources: tools,
      });
      await refreshAfterCompletion();
      const domains = new Set(REGISTERED_SYNCS.filter((sync) => sources.includes(sync.source)).map((sync) => sync.domain));
      for (const domain of domains) if (domain !== 'pam') onCompleted(domain);
    } catch (ingestionError) {
      const message = ingestionError instanceof Error ? ingestionError.message : 'No se pudo aplicar la sincronización';
      onError(message);
      setSyncToast({ tone: 'error', title: 'Sincronización interrumpida', detail: message, sources: [] });
    } finally {
      setSyncBusy(false);
      setIngestionBusy(false);
      setSyncStartedAt(null);
    }
  };

  return {
    syncBusy,
    ingestionBusy,
    syncToast,
    setSyncToast,
    syncElapsedSeconds,
    formatElapsed,
    requestRefresh,
    requestSourceRefresh,
  };
}
