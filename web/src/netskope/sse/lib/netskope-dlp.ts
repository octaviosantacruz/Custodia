/* NSK-DLP-001 presentation helpers.
   Pure functions shared by the policy screen and its unit tests: the drill query
   only carries the policy name, and the freshness states never present
   missing data as zero. */

import type { NetskopeDlpQuery, NetskopeDlpStatus } from '../types/netskope';

export const NETSKOPE_DLP_WINDOW_DAYS = 30;
/** Recent incidents shown when a policy row is opened. */
export const NETSKOPE_DLP_DRILL_SIZE = 5;

export function netskopeDlpQueryString(query: NetskopeDlpQuery, offset: number, limit = NETSKOPE_DLP_DRILL_SIZE): string {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query.policy) params.set('policy', query.policy);
  return params.toString();
}

export type NetskopeDlpTrend = { direction: 'up' | 'down' | 'flat' | 'new'; label: string };

/** Last 7 days against the 7 before: never a percentage over a zero base. */
export function netskopeDlpTrend(last7: number, previous7: number): NetskopeDlpTrend {
  if (previous7 === 0) return last7 === 0 ? { direction: 'flat', label: 'Sin actividad' } : { direction: 'new', label: 'Nueva' };
  if (last7 === previous7) return { direction: 'flat', label: 'Igual' };
  const percent = Math.round((Math.abs(last7 - previous7) / previous7) * 100);
  return last7 > previous7 ? { direction: 'up', label: `+${percent}%` } : { direction: 'down', label: `−${percent}%` };
}

export const DLP_CAPTURE_STALE_MS = 24 * 3_600_000;

export type NetskopeDlpFreshness = { tone: 'ok' | 'attention' | 'off'; label: string; detail: string };

export function netskopeDlpFreshness(
  summary: { configured: boolean; captured_at: string | null; partial: boolean | null },
  status: Pick<NetskopeDlpStatus, 'partial'> | null = null,
  now: number = Date.now(),
): NetskopeDlpFreshness {
  if (!summary.configured) {
    return {
      tone: 'off',
      label: 'Captura no configurada',
      detail: 'El contrato de incidentes DLP no está habilitado en este ambiente: no hay alertas que mostrar todavía.',
    };
  }
  if (!summary.captured_at) {
    return {
      tone: 'attention',
      label: 'Sin captura todavía',
      detail: 'La próxima sincronización de Netskope capturará las alertas de la ventana; no se presenta como cero.',
    };
  }
  if ((summary.partial ?? status?.partial) === true) {
    return {
      tone: 'attention',
      label: 'Captura parcial',
      detail: 'La última captura no alcanzó el final del stream: los conteos pueden estar incompletos.',
    };
  }
  /* FE-AUD-004: completeness is not freshness. A complete capture older than the 24 h rule the inventory uses
     for current evidence keeps its label but is flagged, so an old capture never reads as up to date. */
  const age = now - new Date(summary.captured_at).getTime();
  if (Number.isFinite(age) && age > DLP_CAPTURE_STALE_MS) {
    return {
      tone: 'attention',
      label: 'Captura completa',
      detail: 'Alcanzó el final del stream, pero tiene más de 24 horas: puede no reflejar alertas recientes.',
    };
  }
  return {
    tone: 'ok',
    label: 'Captura completa',
    detail: 'La última captura alcanzó el final del stream para esta ventana.',
  };
}
