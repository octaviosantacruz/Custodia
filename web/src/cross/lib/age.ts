/* Pure helpers for AgeCell: how old a timestamp is and how worrying that is.
   A missing or invalid date is "unknown", never "fresh". */

export type AgeTone = 'fresh' | 'aging' | 'stale' | 'unknown';

export type AgeThresholds = { agingAfterHours: number; staleAfterHours: number };

export const DEFAULT_AGE_THRESHOLDS: AgeThresholds = { agingAfterHours: 24, staleAfterHours: 72 };

export function ageHours(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, (now - at) / 3_600_000);
}

export function ageTone(value: string | null | undefined, thresholds: AgeThresholds = DEFAULT_AGE_THRESHOLDS, now: number = Date.now()): AgeTone {
  const hours = ageHours(value, now);
  if (hours === null) return 'unknown';
  if (hours >= thresholds.staleAfterHours) return 'stale';
  return hours >= thresholds.agingAfterHours ? 'aging' : 'fresh';
}
