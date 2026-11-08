import { DateTime } from './date-time';
import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, CircleAlert, Clock3, LoaderCircle } from 'lucide-react';
import { ApiError } from '../lib/api';
import { fetchIngestionRuns, fetchSyncStageHistory, fetchSyncStages } from '../lib/ingestion-api';
import { dateTimeHint, formatDate, formatNumber, relativeTime } from '../lib/format';
import { summarizeStageHistory, type StageHistorySummary } from '../lib/sync-freshness';
import type { IngestionRun, SyncStage, SyncStageHistoryRow } from '../types/ingestion';
import { StateBlock } from './state-block';
import { StatusBadge } from './semantic';
import { groupSyncRunsByToolCycle, syncStatusLabel, syncToolLabel } from '../lib/sync-source';
import { buildSyncTimeline } from '../lib/sync-timeline';
import { SyncRunsTimeline } from './sync-runs-timeline';
import './sync-runs-view.css';
import { t } from '../i18n/index.ts';

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'running') return 'info';
  return 'warning';
}

function heartbeatLabel(group: ReturnType<typeof groupSyncRunsByToolCycle<IngestionRun>>[number]): string {
  if (group.status === 'queued') return 'Esperando worker';
  if (group.status === 'completed') return 'Finalizada';
  if (group.status === 'failed') return 'Terminó con errores';
  if (group.status === 'partial') return 'Terminó con avisos';
  if (group.status !== 'running') return 'Última actualización';
  if (!group.heartbeat_at) return 'Sin señal del worker';
  const age = Date.now() - new Date(group.heartbeat_at).getTime();
  return age > 90_000 ? `Sin novedades ${relativeTime(group.heartbeat_at).toLowerCase()}` : `Última señal ${relativeTime(group.heartbeat_at).toLowerCase()}`;
}

function runDescription(group: ReturnType<typeof groupSyncRunsByToolCycle<IngestionRun>>[number]): string {
  if (group.affectedComponents.length) {
    const failed = group.affectedComponents.filter((component) => component.status === 'failed').length;
    const partial = group.affectedComponents.length - failed;
    return [
      failed ? `${formatNumber(failed)} ${failed === 1 ? t('componente fallido') : t('componentes fallidos')}` : '',
      partial ? `${formatNumber(partial)} ${partial === 1 ? 'parcial' : 'parciales'}` : '',
    ].filter(Boolean).join(' · ');
  }
  if (group.status === 'completed') {
    const completed = group.components.filter((component) => component.status === 'completed').length;
    return `${formatNumber(completed)} ${completed === 1 ? t('componente completado') : t('componentes completados')}`;
  }
  const activeMessage = group.runs.find((run) => run.status === 'running' && run.status_message)?.status_message;
  if (activeMessage) return activeMessage;
  if (group.status === 'failed') return `${formatNumber(group.runs.reduce((total, run) => total + (run.error_count || 0), 0))} errores registrados`;
  return `${formatNumber(group.received_object_count)} objetos recibidos`;
}

function stageDuration(ms: number): string {
  return ms < 1000 ? `${formatNumber(ms)} ms` : `${(ms / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} s`;
}

const STAGE_STATUS: Record<SyncStage['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  completed: { label: t('Completada'), tone: 'success' },
  failed: { label: t('Fallida'), tone: 'danger' },
  skipped: { label: t('Omitida'), tone: 'neutral' },
};

/** Per-layer outcome of one run. An optional layer that failed does not fail
 * the run, but it must stay visible: what that layer governs was not retired. */
function RunStages({ runId, label, status, source }: { runId: string; label: string; status: string; source: string }) {
  const [stages, setStages] = useState<SyncStage[]>([]);
  const [history, setHistory] = useState<Record<string, StageHistorySummary>>({});
  useEffect(() => {
    if (status === 'queued' || status === 'running') { setStages([]); return undefined; }
    const controller = new AbortController();
    fetchSyncStages(runId, controller.signal).then(setStages).catch(() => { if (!controller.signal.aborted) setStages([]); });
    return () => controller.abort();
  }, [runId, status]);
  useEffect(() => {
    if (!source || status === 'queued' || status === 'running') return undefined;
    const controller = new AbortController();
    fetchSyncStageHistory(source, controller.signal).then((rows: SyncStageHistoryRow[]) => setHistory(summarizeStageHistory(rows))).catch(() => { if (!controller.signal.aborted) setHistory({}); });
    return () => controller.abort();
  }, [source, status]);
  if (!stages.length) return null;
  return <div className="sync-run-table-wrap">
    <table className="sync-run-component-table sync-run-stage-table" aria-label={`Capas de ${label}`}>
      <colgroup><col /><col /><col /><col /><col /><col /></colgroup>
      <thead><tr>
        <th scope="col">{t('Capa')}</th><th scope="col">{t('Tipo')}</th><th scope="col">{t('Estado')}</th><th scope="col" className="sync-run-objects">{t('Filas')}</th><th scope="col">{t('Detalle')}</th><th scope="col">{t('Historial reciente')}</th>
      </tr></thead>
      <tbody>{stages.map((stage) => {
        const view = STAGE_STATUS[stage.status];
        return <tr key={stage.stage}>
          <th scope="row">{stage.stage.replaceAll('_', ' ')}</th>
          <td>{stage.required ? t('Obligatoria') : t('Opcional')}</td>
          <td><StatusBadge tone={view.tone}>{view.label}</StatusBadge></td>
          <td className="sync-run-objects">{stage.item_count === null ? '—' : formatNumber(stage.item_count)}</td>
          <td className="sync-run-stage">{stage.status === 'failed'
            ? <>{stage.error_kind}<small>{stage.required ? t('La corrida se detuvo sin escribir.') : t('No se retiró lo que esta capa gobierna.')}</small></>
            : stage.status === 'skipped' ? stage.detail || 'No aplica'
              : stageDuration(stage.duration_ms)}</td>
          <td className="sync-run-stage">{history[stage.stage] ? <>{history[stage.stage].runs} {history[stage.stage].runs === 1 ? 'corrida' : 'corridas'} · mediana {stageDuration(history[stage.stage].medianDurationMs)}{history[stage.stage].lastItemCount === null ? '' : ` · ${formatNumber(history[stage.stage].lastItemCount as number)} filas`}{history[stage.stage].failedRuns ? <small>{history[stage.stage].failedRuns} con fallo</small> : null}</> : '—'}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function RunComponentDetails({ group }: { group: ReturnType<typeof groupSyncRunsByToolCycle<IngestionRun>>[number] }) {
  const [open, setOpen] = useState(false);
  return <details className="sync-run-components" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t('Detalle por componente')}</summary>
    <div className="sync-run-table-wrap">
      <table className="sync-run-component-table" aria-label={`Componentes de ${syncToolLabel(group.tool)}`}>
        <colgroup><col /><col /><col /><col /><col /></colgroup>
        <thead><tr>
          <th scope="col">{t('Componente')}</th><th scope="col">{t('Estado')}</th><th scope="col" className="sync-run-objects">{t('Objetos')}</th><th scope="col">{t('Etapa')}</th><th scope="col">{t('Última actualización')}</th>
        </tr></thead>
        <tbody>{group.components.map((component) => {
          const run = component.runs.find((candidate) => candidate.status === component.status) ?? component.runs[0];
          const updatedAt = run.completed_at || run.heartbeat_at || run.enqueued_at || run.started_at;
          const stage = component.status === 'completed' ? 'Finalizada'
            : component.status === 'queued' ? 'Esperando worker'
              : run.status_message || 'Etapa no informada';
          const stale = component.status === 'running' && (!run.heartbeat_at || Date.now() - new Date(run.heartbeat_at).getTime() > 90_000);
          return <tr key={component.label}>
            <th scope="row">{component.label}</th>
            <td><StatusBadge tone={statusTone(component.status)}>{syncStatusLabel(component.status)}</StatusBadge></td>
            <td className="sync-run-objects">{formatNumber(component.objects)}</td>
            <td className="sync-run-stage">{stage}{run.error_count ? <small>{formatNumber(run.error_count)} {run.error_count === 1 ? t('error registrado') : t('errores registrados')}</small> : null}</td>
            <td className={stale ? 'sync-run-update is-stale' : 'sync-run-update'}>
              {component.status === 'running'
                ? <span>{run.heartbeat_at ? `Última señal ${relativeTime(run.heartbeat_at).toLowerCase()}` : 'Sin señal del worker'}</span>
                : <time dateTime={updatedAt || undefined} title={dateTimeHint(updatedAt)}>{formatDate(updatedAt || null)}</time>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {open ? group.components.map((component) => {
      const run = component.runs.find((candidate) => candidate.status === component.status) ?? component.runs[0];
      return <RunStages key={component.label} runId={run.run_id} label={component.label} status={run.status} source={run.source_system || ''} />;
    }) : null}
  </details>;
}

export function SyncRunsView({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const groups = groupSyncRunsByToolCycle(runs);
  const hasActiveRuns = runs.some((run) => run.status === 'queued' || run.status === 'running');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const nextRuns = await fetchIngestionRuns(50);
        if (!cancelled) { setRuns(nextRuns); setError(''); setLoading(false); }
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) { if (!cancelled) onUnauthorized?.(); return; }
        if (!cancelled) { setError(caught instanceof Error ? caught.message : 'No se pudieron cargar las sincronizaciones'); setLoading(false); }
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, hasActiveRuns ? 2000 : 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onUnauthorized is only called on a 401; its identity must not restart the polling timer
  }, [hasActiveRuns, reloadKey]);

  return <section className="activity-panel sync-runs-panel">
    <div className="activity-meta"><span><Activity size={14} /> {t('Estado operativo de la cola')}</span><strong>{formatNumber(groups.length)} ciclos recientes</strong></div>
    <p className="operational-errors-note">{t('Cada ciclo agrupa las corridas de una plataforma. Abrí el detalle para ver el estado y la etapa de cada componente.')}</p>
    {!loading && !error ? <SyncRunsTimeline rows={buildSyncTimeline(groups)} /> : null}
    <div className="sync-runs-list">
      {loading ? <StateBlock variant="loading" title={t('Cargando sincronizaciones…')} />
        : error ? <StateBlock variant="error" title={t('No se pudieron cargar las sincronizaciones')} hint={error} action={<button type="button" className="button subtle" onClick={() => { setLoading(true); setReloadKey((value) => value + 1); }}>{t('Reintentar')}</button>} />
          : groups.length ? groups.map((group) => <article className={`sync-run-item is-${group.status}`} key={group.runs[0].run_id}>
              <div className="sync-run-status" aria-hidden="true">{group.status === 'running' ? <LoaderCircle size={18} className="spin" /> : group.status === 'completed' ? <CheckCircle2 size={18} /> : group.status === 'failed' || group.status === 'partial' ? <CircleAlert size={18} /> : <Clock3 size={18} />}</div>
              <div className="sync-run-main">
                <div className="sync-run-heading"><strong>{syncToolLabel(group.tool)}</strong><StatusBadge tone={statusTone(group.status)}>{syncStatusLabel(group.status)}</StatusBadge>{[...new Set(group.affectedComponents.map((component) => component.status))].filter((status) => status !== group.status).map((status) => <StatusBadge key={status} tone={statusTone(status)}>{syncStatusLabel(status)}</StatusBadge>)}</div>
                <span>{runDescription(group)}</span>
                <small>{group.automatic ? t('Automática') : t('Manual')} · <DateTime value={group.latest_at} /> · {formatNumber(group.runs.length)} {group.runs.length === 1 ? 'corrida' : 'corridas'}</small>
              </div>
              <div className="sync-run-heartbeat">
                <strong>{heartbeatLabel(group)}</strong>
                <span>{formatNumber(group.received_object_count)} objetos</span>
              </div>
              <RunComponentDetails group={group} />
            </article>)
            : <StateBlock variant="empty" title={t('Sin sincronizaciones registradas')} />}
    </div>
  </section>;
}
