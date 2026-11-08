import { dateTimeHint, relativeTime } from './format.ts';
import { t } from '../i18n/index.ts';

export type SyncStatusRun = { status: string; source_system?: string | null; completed_at: string | null; started_at: string | null };

/** UX-QA-001: the header label for the active tool's latest run. A failed run
 *  and "no run at all" are different facts and must not read as "pending". */
export function syncStatusLabel(run: SyncStatusRun | null | undefined, busy: boolean, sourceLabel?: string): { label: string; title?: string } {
  if (busy || run?.status === 'running') return { label: t('Sincronizando…') };
  if (!run) return { label: t('Sin sincronizaciones todavía'), title: t('No hay corridas registradas para esta herramienta') };
  const when = run.completed_at || run.started_at;
  const detail = `${sourceLabel ? `${sourceLabel} · ` : ''}${when ? dateTimeHint(when) : t('sin hora registrada')}`;
  if (run.status === 'queued') return { label: t('Sincronización en espera') };
  if (run.status === 'completed' || run.status === 'partial') return { label: when ? t('Sincronizado {when}', { when: relativeTime(when).toLowerCase() }) : t('Sincronizado') };
  if (run.status === 'failed') return { label: t('Última sincronización fallida'), title: t('Última corrida fallida · {detail}', { detail }) };
  return { label: t('Sincronización pendiente'), title: t('Estado de la última corrida: {status} · {detail}', { status: run.status, detail }) };
}
