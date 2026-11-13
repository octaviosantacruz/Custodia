/* Pure pagination helpers for the retired-Safes list. The backend exposes a
   single `limit` (1..500) with no offset, ordered by retirement date, so the
   view accumulates rows in batches of 50 up to the API cap. Kept import-free
   so it can be unit-tested without the API transport. */

export const RETIRED_PAGE_SIZE = 50;
export const RETIRED_LIMIT_MAX = 500;

const positiveInteger = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** Next `limit` to request while accumulating rows: +50, never above the API cap
 *  nor the reported total. */
export function nextRetiredLimit(loaded: number, total: number): number {
  const safeLoaded = positiveInteger(loaded);
  const safeTotal = positiveInteger(total);
  if (safeLoaded >= RETIRED_LIMIT_MAX || safeLoaded >= safeTotal) return safeLoaded;
  return Math.min(safeLoaded + RETIRED_PAGE_SIZE, RETIRED_LIMIT_MAX, safeTotal);
}

/** True while more retired Safes can still be loaded within the API cap. */
export function hasMoreRetired(loaded: number, total: number): boolean {
  const safeLoaded = positiveInteger(loaded);
  const safeTotal = positiveInteger(total);
  return safeLoaded < RETIRED_LIMIT_MAX && safeLoaded < safeTotal;
}

/** Explains the API cap only when the tenant has more retired Safes than the cap. */
export function retiredLimitNote(loaded: number, total: number): string | null {
  const safeLoaded = positiveInteger(loaded);
  const safeTotal = positiveInteger(total);
  if (safeTotal > RETIRED_LIMIT_MAX && safeLoaded >= RETIRED_LIMIT_MAX) {
    return t('La API devuelve como máximo {RETIRED_LIMIT_MAX} Safes retiradas por consulta; hay {RETIRED_LIMIT_MAX2} más sin mostrar.', { RETIRED_LIMIT_MAX: RETIRED_LIMIT_MAX, RETIRED_LIMIT_MAX2: safeTotal - RETIRED_LIMIT_MAX });
  }
  return null;
}

import { t } from '../../../cross/i18n/index.ts';