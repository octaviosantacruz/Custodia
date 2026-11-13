import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NetskopeOfficePersonDay } from '../types/netskope';
import { StateBlock } from '../../../cross/components/state-block';
import { ApiError } from '../../../cross/lib/api';
import { formatNumber } from '../../../cross/lib/format';
import { fetchNetskopeOfficePerson } from '../lib/netskope-api';
import { dayLabel, weekdayShort } from '../lib/netskope-office';
import { t } from '../../../cross/i18n/index.ts';

const PLACE_LABELS = { office: t('Oficina'), remote: t('Remoto'), no_signal: t('Sin señal') } as const;
const minutes = (value: number) => value >= 60 ? `${Math.floor(value / 60)} h ${value % 60 ? `${value % 60} min` : ''}`.trim() : `${value} min`;

/** The score of the place where the person worked that day; a day not yet measured says so instead of a score. */
function DayScore({ day }: { day: NetskopeOfficePersonDay }) {
  if (day.place === 'no_signal') return <span className="nsk-user-week-empty">—</span>;
  if (!day.measured) return <span className="nsk-user-week-empty">{t('Pendiente')}</span>;
  const [value, spent] = day.place === 'office' ? [day.office_score, day.office_minutes] : [day.remote_score, day.remote_minutes];
  return value === null ? <span className="nsk-user-week-empty">{t('Sin dato')}</span>
    : <span>{formatNumber(Math.round(value))}{spent ? <small> · {minutes(spent)}</small> : null}</span>;
}

type Props = { email: string; refreshKey: number; onUnauthorized: () => void };

/** NSK-EXP-OFFICE-001: where the person worked each of the last 7 complete days and, once measured, how it went. */
export function NetskopeUserWeek({ email, refreshKey, onUnauthorized }: Props) {
  const week = useQuery({
    queryKey: ['netskope', 'experience', 'office-person', email, refreshKey],
    enabled: Boolean(email),
    queryFn: ({ signal }) => fetchNetskopeOfficePerson(email, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (week.error instanceof ApiError && week.error.status === 401) onUnauthorized();
  }, [week.error, onUnauthorized]);
  return <section className="detail-section nsk-user-week" aria-label={t('Últimos 7 días de la persona')}>
    <h3>{t('Últimos 7 días')}</h3>
    <p>Dónde reportaron sus equipos y el puntaje medido en ese lugar. «Sin señal»: ningún equipo envió eventos ese día; «Pendiente»: el día todavía no se midió.</p>
    {week.isPending ? <StateBlock compact variant="loading" title={t('Leyendo los últimos 7 días…')} />
      : week.isError || !Array.isArray(week.data?.days) ? <StateBlock compact variant="error" title={t('No se pudieron leer los últimos 7 días')} action={<button className="button subtle" type="button" onClick={() => void week.refetch()}>{t('Reintentar')}</button>} />
      : <div className="compact-table-wrap"><table className="compact-table nsk-user-week-table">
        <caption className="sr-only">{t('Lugar y puntaje por día')}</caption>
        <thead><tr><th scope="col"><span className="sr-only">{t('Dato')}</span></th>{week.data.days.map((day) => <th key={day.day} scope="col">{weekdayShort(day.day)} <small>{dayLabel(day.day)}</small></th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">{t('Lugar')}</th>{week.data.days.map((day) => <td key={day.day} className={`nsk-user-week-place is-${day.place}`}>{PLACE_LABELS[day.place]}</td>)}</tr>
          <tr><th scope="row">{t('Puntaje')}</th>{week.data.days.map((day) => <td key={day.day}><DayScore day={day} /></td>)}</tr>
        </tbody>
      </table></div>}
  </section>;
}
