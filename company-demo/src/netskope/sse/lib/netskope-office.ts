/* NSK-EXP-OFFICE-001 helpers shared by the office experience charts and tables. */

const DAY = new Intl.DateTimeFormat('es-AR', { day: 'numeric', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** A Monday-to-Sunday UTC week as a range: "12–18 oct", or "28 sept–4 oct" across months. */
export function weekRange(weekStart: string): string {
  const start = utc(weekStart);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${DAY.format(start)}–${DAY_MONTH.format(end)}`
    : `${DAY_MONTH.format(start)}–${DAY_MONTH.format(end)}`;
}

export const dayLabel = (iso: string) => DAY_MONTH.format(utc(iso));
export const weekdayShort = (iso: string) => new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' }).format(utc(iso));
