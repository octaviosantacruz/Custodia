import { dateTimeHint, formatDate } from '../lib/format';
import { t } from '../i18n/index.ts';

export function DateTime({ value, missing = t('Sin dato'), className, hint }: {
  value: string | null | undefined; missing?: string; className?: string; hint?: string;
}) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return <span className={className}>{missing}</span>;
  return <time className={className} dateTime={value} title={hint ? `${hint} · ${dateTimeHint(value)}` : dateTimeHint(value)}>{formatDate(value)}</time>;
}
