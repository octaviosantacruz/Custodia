import { DateTime } from './date-time';
import { TriangleAlert } from 'lucide-react';
import { syncSourceLabel } from '../lib/sync-source';
import type { SyncTaskSchedule } from '../types/ingestion';
import './stale-data-banner.css';

/** SYNC-OBS-001: shown only for a workspace whose source has stale tasks with
 *  recorded runs. States the evidence (last success, intervals) and nothing else. */
export function StaleDataBanner({ tasks, onOpenActivity }: { tasks: readonly SyncTaskSchedule[]; onOpenActivity?: () => void }) {
  if (!tasks.length) return null;
  return <section className="stale-data-banner" role="status" aria-label="Datos desactualizados">
    <TriangleAlert size={16} aria-hidden="true" />
    <div>
      <strong>Datos posiblemente desactualizados</strong>
      <ul>{tasks.map((task) => <li key={task.task_key}>
        {syncSourceLabel(task.source_system, task.source_file)} · {task.task_key}: sin sincronización correcta desde {task.last_success_at ? <DateTime value={task.last_success_at} /> : 'una fecha desconocida'}
        {task.intervals_since_success === null ? '' : ` (${task.intervals_since_success.toLocaleString('es', { maximumFractionDigits: 1 })} intervalos de ${task.interval_minutes} min; se avisa tras ${task.stale_after_intervals})`}.
      </li>)}</ul>
    </div>
    {onOpenActivity && <button type="button" className="stale-data-banner-link" onClick={onOpenActivity}>Ver actividad</button>}
  </section>;
}
