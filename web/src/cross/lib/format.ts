import { localeTag, t } from '../i18n/index.ts';

export const formatNumber = (value: number) => new Intl.NumberFormat(localeTag()).format(value || 0);

export const resultCountLabel = (count: number) => `${formatNumber(count)} ${count === 1 ? t('resultado') : t('resultados')}`;

export const formatDate = (value: string | null) => {
  if (!value) return t('Sin dato');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('Sin dato');
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat(localeTag(), {
    dateStyle: 'medium',
    ...(dateOnly ? {} : { timeStyle: 'short' as const }),
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  }).format(date);
};

export const relativeTime = (value: string | null) => {
  if (!value) return t('Sin fecha');
  const elapsed = Date.now() - new Date(value).getTime();
  if (Number.isNaN(elapsed)) return t('Sin fecha');
  const minutes = Math.round(Math.abs(elapsed) / 60000);
  if (minutes < 1) return t('hace instantes');
  if (minutes < 60) return t('hace {n} min', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('hace {n} h', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 30) return t('hace {n} d', { n: days });
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? t('hace {n} mes', { n: months }) : t('hace {n} meses', { n: months });
  return t('hace {n} a', { n: Math.round(months / 12) });
};

export const timeUntil = (value: string | null) => {
  if (!value) return t('sin fecha programada');
  const remaining = new Date(value).getTime() - Date.now();
  if (Number.isNaN(remaining)) return t('sin fecha programada');
  if (remaining <= 60_000) return t('en menos de 1 min');
  const minutes = Math.round(remaining / 60000);
  if (minutes < 60) return t('en {n} min', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('en {n} h', { n: hours });
  return t('en {n} d', { n: Math.round(hours / 24) });
};

// Presentation keeps the original string; this only chooses the tooltip.
export const dateTimeHint = (value: string | null | undefined) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return t('Sin fecha');
  return new Date(value).getTime() > Date.now() ? timeUntil(value) : relativeTime(value);
};

// Callers explicitly declare epoch seconds; strings and other precision are not coerced.
export const epochSecondsToIso = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/* Time distinguishes repeated samples without dropping any point. Date-only
   and non-temporal labels retain their meaning; no missing time is invented. */
const padChartTick = (value: number) => String(value).padStart(2, '0');

const parseChartTick = (value: string): { date: Date; hasTime: boolean } | null => {
  const trimmed = value.trim();
  const hasTime = /\d{1,2}:\d{2}/.test(trimmed);
  const normalized = hasTime && !trimmed.includes('T') ? trimmed.replace(' ', 'T') : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : { date, hasTime };
};

export const formatChartTickLabels = (labels: readonly string[]): string[] => {
  const parsed = labels.map(parseChartTick);
  if (parsed.some((point) => point === null)) return [...labels];
  const points = parsed as Array<{ date: Date; hasTime: boolean }>;
  const days = points.map(({ date }) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  const sameDay = new Set(days).size === 1;
  const repeatedDays = new Set(days).size < days.length;
  const showTime = points.every(({ hasTime }) => hasTime) && (sameDay || repeatedDays);
  const ticks = points.map(({ date }) => {
    const day = `${padChartTick(date.getDate())}/${padChartTick(date.getMonth() + 1)}`;
    const time = `${padChartTick(date.getHours())}:${padChartTick(date.getMinutes())}`;
    return showTime ? (sameDay ? time : `${day} ${time}`) : day;
  });
  if (showTime && new Set(ticks).size < ticks.length) {
    return ticks.map((tick, index) => `${tick}:${padChartTick(points[index].date.getSeconds())}`);
  }
  return ticks;
};

export const inventoryScopeLabel = (value: string) =>
  ({ pending: 'Pendiente de definir', business: 'Safe de negocio', internal: 'Interno CyberArk' } as Record<string, string>)[value] || value;

export const qualityStatusLabel = (value: string) =>
  ({ pending: 'Pendiente', clean: 'Depurado', obsolete: 'Obsoleto', duplicate: 'Duplicado' } as Record<string, string>)[value] || value;

export function businessUnitLabel(unit: { unit_code: string; unit_name: string }): string {
  const code = unit.unit_code.trim();
  const name = unit.unit_name.trim();
  if (!code) return name;
  if (!name || code.localeCompare(name, undefined, { sensitivity: 'base' }) === 0) return code;
  return `${code} - ${name}`;
}

export const siaPolicyStatusLabel = (value: string) =>
  ({ Enabled: 'Habilitada', Disabled: 'Deshabilitada' } as Record<string, string>)[value] || value || 'Sin dato';

export const nextActionOptions = ['Migrar a SIA', 'Consultar', 'Revisar', 'Dar de baja', 'Rotar credencial'];

const actionLabels: Record<string, string> = {
  "migrar a sia": "Migrar a SIA",
  "migrar sia": "Migrar a SIA",
  "consultar": "Consultar",
  "revisar": "Revisar",
  "dar de baja": "Dar de baja",
  "revisar / dar de baja": "Revisar",
  "revisar/dar de baja": "Revisar",
  "rotar credencial": "Rotar credencial",
  "sin definir": "Sin definir",
  "sin clasificar": "Sin clasificar",
};

export const actionLabel = (value: string | null | undefined) => {
  const normalized = (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return actionLabels[normalized] || (value || 'Sin definir').trim() || 'Sin definir';
};

export const bucketLabel = (value: string) => {
  const workflow = ({ pending: 'Pendiente', in_progress: 'En curso', blocked: 'Bloqueada', resolved: 'Resuelto', retired: 'Retirada', retention_hold: 'Baja retenida' } as Record<string, string>)[value];
  return workflow || actionLabel(value.replace(/_/g, ' '));
};

/* CyberArk sometimes reports a placeholder "0.0.0.0" instance version; it is
   not a real version and must not be presented as one next to real versions. */
export const versionListLabel = (versions: Array<string | null | undefined> | null | undefined): string => {
  const visible = (versions || [])
    .map((value) => (value || '').trim())
    .filter((value) => value && value !== '0.0.0.0');
  return visible.length ? visible.join(', ') : 'Sin versión observada';
};
