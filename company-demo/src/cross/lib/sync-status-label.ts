import { dateTimeHint, relativeTime } from './format.ts';

export type SyncStatusRun = { status: string; source_system?: string | null; completed_at: string | null; started_at: string | null };

/** UX-QA-001: the header label for the active tool's latest run. A failed run
 *  and "no run at all" are different facts and must not read as "pending". */
export function syncStatusLabel(run: SyncStatusRun | null | undefined, busy: boolean, sourceLabel?: string): { label: string; title?: string } {
  if (busy || run?.status === 'running') return { label: 'Sincronizando…' };
  if (!run) return { label: 'Sin sincronizaciones todavía', title: 'No hay corridas registradas para esta herramienta' };
  const when = run.completed_at || run.started_at;
  const detail = `${sourceLabel ? `${sourceLabel} · ` : ''}${when ? dateTimeHint(when) : 'sin hora registrada'}`;
  if (run.status === 'queued') return { label: 'Sincronización en espera' };
  if (run.status === 'completed' || run.status === 'partial') return { label: `Sincronizado ${when ? relativeTime(when).toLowerCase() : ''}`.trim() };
  if (run.status === 'failed') return { label: 'Última sincronización fallida', title: `Última corrida fallida · ${detail}` };
  return { label: 'Sincronización pendiente', title: `Estado de la última corrida: ${run.status} · ${detail}` };
}
