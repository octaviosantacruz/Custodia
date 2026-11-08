import { DateTime } from './date-time';
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Play, Save } from 'lucide-react';
import { ApiError } from '../lib/api';
import { fetchSyncTaskSchedules, runSyncTask, updateSyncTaskSchedule } from '../lib/ingestion-api';
import { formatNumber } from '../lib/format';
import type { SyncTaskSchedule } from '../types/ingestion';
import { StateBlock } from './state-block';
import { StatusBadge } from './semantic';
import './sync-schedule-view.css';
import { t } from '../i18n/index.ts';

function intervalSourceLabel(source: SyncTaskSchedule['interval_source']): string {
  return ({ administrative: 'Ajuste administrativo', environment_task: 'Entorno · tarea', environment_source: 'Entorno · fuente', task_policy: 'Política de tarea', global_default: 'Valor global' })[source];
}

function sourceLabel(source: string): string {
  return ({ cyberark: 'CyberArk', identity_administration: 'Identity Administration', sia: 'SIA', access: 'Access space', netskope: 'Netskope' })[source] || source;
}

export function SyncScheduleView({ permissions, onUnauthorized }: { permissions: string[]; onUnauthorized?: () => void }) {
  const canManage = permissions.includes('access:manage');
  const canRun = permissions.includes('ingestion:run');
  const [rows, setRows] = useState<SyncTaskSchedule[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const hasActiveTasks = rows.some((row) => row.active);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchSyncTaskSchedules(signal);
      if (signal?.aborted) return;
      setRows(next);
      setError('');
      setDrafts((current) => Object.fromEntries(next.map((row) => [row.task_key, current[row.task_key] ?? (row.admin_override === null ? '' : String(row.admin_override))])));
      setLoading(false);
    } catch (caught) {
      if (signal?.aborted) return;
      if (caught instanceof ApiError && caught.status === 401) { onUnauthorized?.(); return; }
      setError(caught instanceof Error ? caught.message : 'No se pudo cargar la agenda');
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => { void load(controller.signal); }, hasActiveTasks ? 2000 : 15000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [hasActiveTasks, load, reloadKey]);

  async function save(row: SyncTaskSchedule) {
    const raw = drafts[row.task_key]?.trim() ?? '';
    let interval: number | null = null;
    if (raw) {
      interval = Number(raw);
      if (!Number.isFinite(interval) || interval < 0 || (interval > 0 && interval < 5)) {
        setError(t('Usá 0 para deshabilitar o un intervalo de al menos 5 minutos.'));
        return;
      }
    }
    setBusyKey(row.task_key);
    setError('');
    try {
      await updateSyncTaskSchedule(row.task_key, interval);
      setNotice(`Agenda de ${row.task_key} actualizada.`);
      setReloadKey((key) => key + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar el intervalo');
    } finally {
      setBusyKey('');
    }
  }

  async function runNow(row: SyncTaskSchedule) {
    setBusyKey(row.task_key);
    setError('');
    setNotice('');
    try {
      await runSyncTask(row.task_key);
      setNotice(`Se encoló ${row.task_key}.`);
      setReloadKey((key) => key + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo encolar la tarea');
    } finally {
      setBusyKey('');
    }
  }

  return <section className="activity-panel sync-schedule-panel">
    <div className="activity-meta"><span><CalendarClock size={14} /> {t('Programación por tarea')}</span><strong>{formatNumber(rows.length)} tareas registradas</strong></div>
    <p className="operational-errors-note">{t('La cadencia refleja precedencia administrativa, entorno y política. El lock de ejecución continúa siendo por fuente.')}</p>
    {notice && <p className="sync-schedule-notice" role="status">{notice}</p>}
    {error && !loading && rows.length > 0 && <p className="sync-schedule-error" role="alert">{error}</p>}
    {loading ? <StateBlock variant="loading" title={t('Cargando agenda…')} />
      : error && rows.length === 0 ? <StateBlock variant="error" title={t('No se pudo cargar la agenda')} hint={error} action={<button type="button" className="button subtle" onClick={() => { setLoading(true); setReloadKey((key) => key + 1); }}>{t('Reintentar')}</button>} />
        : <div className="sync-schedule-table-wrap"><table className="sync-schedule-table"><thead><tr>
          <th>{t('Tarea')}</th><th>{t('Fuente')}</th><th>{t('Estado')}</th><th>{t('Intervalo')}</th><th>{t('Último éxito')}</th><th>{t('Último intento / fallos')}</th><th>{t('Próxima')}</th><th>{t('Acciones')}</th>
        </tr></thead><tbody>{rows.map((row) => {
          const sourceText = intervalSourceLabel(row.interval_source);
          const dirty = (row.admin_override === null ? '' : String(row.admin_override)) !== (drafts[row.task_key] ?? '');
          return <tr key={row.task_key}>
            <th scope="row"><span className="sync-schedule-task">{row.task_key}</span><small>{row.source_file}</small></th>
            <td>{sourceLabel(row.source_system)}</td>
            <td><StatusBadge tone={!row.configured ? 'neutral' : row.active ? 'info' : row.interval_minutes === 0 ? 'neutral' : row.last_status === 'failed' ? 'danger' : row.last_status === 'partial' ? 'warning' : 'success'}>
              {!row.configured ? 'Sin configurar' : row.active ? 'En cola o curso' : row.interval_minutes === 0 ? 'Deshabilitada' : row.last_status ? ({ completed: 'Completada', partial: 'Con avisos', failed: 'Fallida', queued: 'En cola', running: 'En curso' } as Record<string, string>)[row.last_status] || row.last_status : 'Sin corridas'}
            </StatusBadge>{row.consecutive_failures > 0 && <small>{row.consecutive_failures} fallos consecutivos</small>}</td>
            <td><strong>{row.interval_minutes === 0 ? 'Deshabilitada' : `${formatNumber(row.interval_minutes)} min`}</strong><small>{sourceText}</small></td>
            <td>{row.last_success_at ? <DateTime value={row.last_success_at} /> : 'Sin éxito registrado'}</td>
            <td>{row.last_attempt_at ? <DateTime value={row.last_attempt_at} /> : 'Sin intentos'}{row.consecutive_failures > 0 && <small>{t('Backoff según política de tarea')}</small>}</td>
            <td>{row.next_scheduled_at ? <DateTime value={row.next_scheduled_at} /> : row.configured && row.interval_minutes > 0 ? t('Al liberarse la tarea') : t('No programada')}</td>
            <td><div className="sync-schedule-actions">
              {canManage && <><label className="sync-schedule-editor">{`Intervalo ${row.task_key}`}<input aria-label={`Intervalo de ${row.task_key} en minutos`} type="number" min="0" step="5" value={drafts[row.task_key] ?? ''} placeholder={t('Heredar')} onChange={(event) => setDrafts((current) => ({ ...current, [row.task_key]: event.target.value }))} disabled={busyKey === row.task_key} /><small>Vacío hereda; 0 deshabilita</small></label><button className="button subtle" type="button" onClick={() => void save(row)} disabled={!dirty || busyKey === row.task_key}><Save size={13} /> {t('Guardar')}</button></>}
              {canRun && <button className="button subtle" type="button" onClick={() => void runNow(row)} disabled={!row.configured || busyKey === row.task_key}><Play size={13} /> {busyKey === row.task_key ? t('Procesando…') : t('Sincronizar ahora')}</button>}
            </div></td>
          </tr>;
        })}{!rows.length && <tr><td colSpan={8}><StateBlock variant="empty" title={t('No hay tareas registradas')} /></td></tr>}</tbody></table></div>}
  </section>;
}
