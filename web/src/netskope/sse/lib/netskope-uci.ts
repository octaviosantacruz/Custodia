import { formatNumber } from '../../../cross/lib/format.ts';
import type { NetskopeUciRating, NetskopeUciRow } from '../types/netskope';
import { localeTag } from '../../../cross/i18n/index.ts';

/* NSK-UBA-002: labels and pure helpers for the UCI view. The list holds only
   users Netskope rated Poor or Moderate among the recently active; an absent
   user is never labelled as good or safe. */

export const UCI_TITLE = 'Usuarios con señales de riesgo';
export const UCI_SCORE_LABEL = 'Índice de confianza';
export const UCI_SCALE = 'De 0 a 1000: menor puntaje, mayor riesgo.';
export const UCI_EXPLANATION = 'Netskope resume en este índice las señales de riesgo que detecta en la actividad de una cuenta.';
export const UCI_CHANGE_EXPLANATION = 'La variación compara el puntaje con una lectura de hace aproximadamente 7 días: si sube, mejora la confianza; si baja, aumenta el riesgo. Sin una lectura anterior se muestra Sin dato.';
export const UCI_CAPTION = 'Se muestran usuarios activos con confianza baja o moderada según Netskope. Una cuenta ausente puede tener confianza buena o no haber estado activa recientemente; su ausencia no confirma que esté libre de riesgo.';
export const UCI_PAGE_SIZE = 25;
export const UCI_MAX_SCORE = 1000;
/** The task runs daily: a reading is normal for a day and a half, stale after three days. */
export const UCI_AGE_THRESHOLDS = { agingAfterHours: 36, staleAfterHours: 72 } as const;

export const UCI_RATING_LABELS: Record<NetskopeUciRating, string> = { Poor: 'Baja', Moderate: 'Moderada' };

export const UCI_RATING_FILTER_OPTIONS = [
  { value: '', label: 'Todas las calificaciones' },
  { value: 'Poor', label: 'Baja' },
  { value: 'Moderate', label: 'Moderada' },
] as const;

export type UciRatingFilter = '' | NetskopeUciRating;

export function uciUserLabel(row: Pick<NetskopeUciRow, 'name' | 'email'>): string {
  return row.name || row.email;
}

/** Score change against the reading about a week earlier; null when there is none. */
export function uciDelta(row: Pick<NetskopeUciRow, 'score' | 'previous_score'>): number | null {
  return typeof row.previous_score === 'number' ? row.score - row.previous_score : null;
}

export function uciDeltaLabel(delta: number | null): string {
  if (delta === null) return 'Sin dato';
  if (delta === 0) return 'Sin cambio';
  return `${delta > 0 ? 'Mejora +' : 'Empeora −'}${formatNumber(Math.abs(delta))}`;
}

/** Positive means the user recovered; negative means the score fell. */
export function uciDeltaTone(delta: number | null): 'up' | 'down' | 'flat' | 'unknown' {
  if (delta === null) return 'unknown';
  return delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
}

export function filterUciRows(rows: NetskopeUciRow[], rating: UciRatingFilter, query: string): NetskopeUciRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => (!rating || row.rating === rating)
    && (!needle || row.email.toLowerCase().includes(needle) || (row.name ?? '').toLowerCase().includes(needle)));
}


/** True when the one page did not cover every rated user. */
export function uciIsTruncated(total: number, shown: number): boolean {
  return total > shown;
}

/** Share of a company's users at risk: a proportion over users with an email, never an average score. */
export function uciRiskShare(company: { users: number; poor: number; moderate: number }): number {
  return company.users > 0 ? (company.poor + company.moderate) / company.users : 0;
}

export function uciRiskLabel(company: { users: number; poor: number; moderate: number }): string {
  return `${(uciRiskShare(company) * 100).toLocaleString(localeTag(), { maximumFractionDigits: 1 })} %`;
}

/** Change in the at-risk share versus the last weekly snapshot, in percentage points; null without a snapshot. */
export function uciRiskChange(company: { users: number; poor: number; moderate: number; previous: { users: number; poor: number; moderate: number } | null }): number | null {
  if (!company.previous || company.previous.users <= 0) return null;
  return (uciRiskShare(company) - uciRiskShare(company.previous)) * 100;
}

export function uciRiskChangeLabel(change: number | null): string {
  if (change === null) return 'Sin dato';
  const rounded = Math.round(change * 10) / 10;
  if (rounded === 0) return 'Sin cambio';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString(localeTag(), { maximumFractionDigits: 1 })} pp`;
}
