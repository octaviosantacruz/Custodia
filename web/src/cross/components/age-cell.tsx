import { dateTimeHint, formatDate } from '../lib/format';
import { ageTone, DEFAULT_AGE_THRESHOLDS, type AgeThresholds } from '../lib/age';
import './age-cell.css';
import { t } from '../i18n/index.ts';

type Props = { value: string | null | undefined; thresholds?: AgeThresholds };

/** Relative age with the exact date on hover; the tone also appears as text
 *  for stale values so color is never the only signal. */
export function AgeCell({ value, thresholds = DEFAULT_AGE_THRESHOLDS }: Props) {
  const tone = ageTone(value, thresholds);
  if (tone === 'unknown') return <span className="age-cell is-unknown">{t('Sin dato')}</span>;
  return <time className={`age-cell is-${tone}`} dateTime={value || undefined} title={formatDate(value || null)}>
    {dateTimeHint(value).replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase('es-AR'))}
    {tone === 'stale' ? <span className="age-cell-flag"> {t('· desactualizado')}</span> : null}
  </time>;
}
