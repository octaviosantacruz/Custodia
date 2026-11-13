import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NetskopeOfficeExperience as OfficeData, NetskopeOfficePerson, NetskopePerformanceBand } from '../types/netskope';
import { DateTime } from '../../../cross/components/date-time';
import { HelpHint } from '../../../cross/components/help-hint';
import { StateBlock } from '../../../cross/components/state-block';
import { StatusBadge } from '../../../cross/components/semantic';
import { ApiError } from '../../../cross/lib/api';
import { formatNumber } from '../../../cross/lib/format';
import { fetchNetskopeOfficeExperience } from '../lib/netskope-api';
import { dayLabel, weekRange } from '../lib/netskope-office';
import { PERFORMANCE_EXPLANATION, PERFORMANCE_SCALE } from '../lib/netskope-user-score';
import { NetskopeOfficeAverages } from './netskope-office-averages';
import { NetskopeOfficeTrend } from './netskope-office-trend';
import './netskope-attention-queue.css';
import './netskope-office-experience.css';
import { t } from '../../../cross/i18n/index.ts';

const BAND_LABELS: Record<NetskopePerformanceBand, string> = { poor: 'Malo', fair: 'Regular', good: 'Bglobex' };
const BAND_TONES = { poor: 'danger', fair: 'warning', good: 'success' } as const;
const score = (value: number | null) => value === null ? <span className="nsk-attention-empty">{t('Sin dato')}</span> : formatNumber(Math.round(value));

type Scope = 'flagged' | 'all';
type Chart = 'flagged' | 'average';
type Detail = 'people' | 'weekdays' | 'companies';
const PAGE = 20;

/** The weeks from the first to the last measured one: weeks before the measurement existed (or the current one, not
    yet measured) are not drawn, while an unmeasured week in between stays as a gap, never a zero. */
function measuredSpan(series: OfficeData['series']) {
  const measured = series.map((week, index) => (week.days_measured > 0 ? index : -1)).filter((index) => index >= 0);
  return measured.length ? series.slice(measured[0], measured[measured.length - 1] + 1) : [];
}

/** A small pressed-button group: one choice among a few, never a navigation. */
export function OfficeSwitch<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: T) => void; options: readonly (readonly [T, string])[] }) {
  return <div className="nsk-office-switch" role="group" aria-label={label}>
    {options.map(([id, text]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}
  </div>;
}
type Measurement = OfficeData['measurement'];
const isMeasuring = (status: string | undefined) => status === 'running' || status === 'queued';

/** Where the daily office measurement stands: running now, failed, waiting, or not enabled, and how many days are in. */
function MeasurementStatus({ configured, measurement, daysMeasured }: { configured: boolean; measurement: Measurement; daysMeasured: number }) {
  const missing = 7 - daysMeasured;
  const [tone, label, text] = !configured
    ? ['neutral', 'No activada', t('La medición en la oficina no está activada en este entorno.')] as const
    : isMeasuring(measurement?.status)
      ? ['info', 'Midiendo ahora', `Cada día lleva unos 10 minutos y cada corrida mide hasta 2 días. ${missing > 0 ? `Faltan ${missing} de 7; se completan en las próximas corridas (cada 3 h).` : ''} La pantalla se actualiza sola.`] as const
      : measurement?.status === 'failed'
        ? ['warning', t('Falló la última medición'), t('Los días pendientes se vuelven a intentar en la próxima corrida (cada 3 h).')] as const
        : ['neutral', t('Pendiente'), missing > 0 ? t('Faltan {missing} de 7 días; se miden en las próximas corridas (cada 3 h).', { missing: missing }) : t('Esperando la próxima corrida.')] as const;
  const since = measurement?.started_at && isMeasuring(measurement.status) ? measurement.started_at : measurement?.completed_at;
  return <div className="nsk-office-status" role="status">
    <StatusBadge tone={tone}>{label}</StatusBadge>
    <span><strong>{t('{daysMeasured} de 7 días medidos.', { daysMeasured: daysMeasured })}</strong> {text}</span>
    {since ? <small>{isMeasuring(measurement?.status) ? t('Desde') : t('Última corrida')}: <DateTime value={since} /></small> : null}
  </div>;
}

type Props = { enabled: boolean; refreshKey: number; onUnauthorized: () => void; onPick: (person: { email: string; name: string | null }) => void };

/** NSK-EXP-OFFICE-001: how working from the office goes, week by week, and who had a poor or fair experience there. */
export function NetskopeOfficeExperience({ enabled, refreshKey, onUnauthorized, onPick }: Props) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [chart, setChart] = useState<Chart>('flagged');
  const [detail, setDetail] = useState<Detail>('people');
  const [shown, setShown] = useState(PAGE);
  const query = useQuery({
    queryKey: ['netskope', 'experience', 'office', refreshKey],
    enabled,
    queryFn: ({ signal }) => fetchNetskopeOfficeExperience(signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
    // While a measurement is queued or running, re-read every minute so finished days appear on their own.
    refetchInterval: (current) => (isMeasuring(current.state.data?.measurement?.status) ? 60_000 : false),
  });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
  }, [query.error, onUnauthorized]);

  if (query.isPending) return <StateBlock variant="loading" title={t('Leyendo el rendimiento en la oficina…')} />;
  const data = query.data;
  // A malformed answer is an error inside this view, never a crash of the workspace.
  if (query.isError || !data || !Array.isArray(data.series) || !Array.isArray(data.people) || !data.summary) {
    return <StateBlock variant="error" title={t('No se pudo leer el rendimiento en la oficina')} action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>{t('Reintentar lectura')}</button>} />;
  }
  const everMeasured = data.series.some((week) => week.days_measured > 0) || data.summary.days_measured > 0;
  // Before the first measured day: only where the measurement stands.
  if (!everMeasured) {
    return <section className="list-panel database-surface nsk-office" aria-label={t('Rendimiento en la oficina')}>
      <div className="nsk-attention-head"><h2>{t('Rendimiento en la oficina')}</h2></div>
      <MeasurementStatus configured={data.configured} measurement={data.measurement ?? null} daysMeasured={0} />
    </section>;
  }
  const { summary } = data;
  const flaggedCount = summary.poor + summary.fair;
  const isFlagged = (person: NetskopeOfficePerson) => person.office_band === 'poor' || person.office_band === 'fair' || person.worse_in_office;
  const flaggedPeople = data.people.filter(isFlagged).length;
  const effectiveScope: Scope = scope ?? (flaggedPeople > 0 ? 'flagged' : 'all');
  const people = effectiveScope === 'flagged' ? data.people.filter(isFlagged) : data.people;
  const series = measuredSpan(data.series);
  const withoutScore = summary.office_people - summary.measured;
  return <section className="list-panel database-surface nsk-office" aria-label={t('Rendimiento en la oficina')}>
    <div className="nsk-attention-head">
      <h2>{t('Rendimiento en la oficina')}</h2>
      <HelpHint label={t('Rendimiento en la oficina')}>
        <p>{t('Puntaje de rendimiento digital (ADEM) medido solo en los horarios en que el equipo de cada persona estuvo en la oficina, según la detección on-premises de Netskope. Se promedia por minutos y no se mezcla con los días remotos. Se compara con el puntaje de sus horarios remotos: «Peor en oficina» marca {office_gap} puntos o más por debajo.', { office_gap: data.office_gap })}</p>
        <p>{t('{PERFORMANCE_EXPLANATION} {PERFORMANCE_SCALE} Bandas de Netskope: malo 0–30, regular 31–70, bueno 71–100.', { PERFORMANCE_EXPLANATION: PERFORMANCE_EXPLANATION, PERFORMANCE_SCALE: PERFORMANCE_SCALE })}</p>
        <p>{t('Se miden días completos (UTC), hasta ayer. Una persona sin puntaje en la oficina figura «Sin dato», nunca como buena. Una semana sin días medidos no es cero.')}</p>
      </HelpHint>
      <small className="nsk-office-freshness">{summary.days_measured} de 7 días medidos{data.last_measured_at ? <> · <DateTime value={data.last_measured_at} /></> : null}</small>
    </div>
    <div className="nsk-office-headline" role="group" aria-label={t('Resumen de los últimos 7 días')}>
      <p><strong>{formatNumber(flaggedCount)}</strong> {t('de {measured} personas medidas en la oficina tuvieron rendimiento malo o regular', { measured: formatNumber(summary.measured) })} <small>· {dayLabel(data.window_start)} al {dayLabel(data.window_end)}</small></p>
      <p className="nsk-office-facts">
        <span><i className="nsk-office-dot is-poor" aria-hidden />Malo {formatNumber(summary.poor)}</span>
        <span><i className="nsk-office-dot is-fair" aria-hidden />Regular {formatNumber(summary.fair)}</span>
        <span><i className="nsk-office-dot is-good" aria-hidden />Bglobex {formatNumber(summary.good)}</span>
        <span>{t('Peor en oficina que en remoto {worse_in_office}', { worse_in_office: formatNumber(summary.worse_in_office) })}</span>
        {withoutScore > 0 ? <span>{t('Sin dato {withoutScore}', { withoutScore: formatNumber(withoutScore) })}</span> : null}
        {summary.office_avg !== null ? <span>{t('Promedio {office_avg} en oficina{remote_avg}', { office_avg: formatNumber(summary.office_avg), remote_avg: summary.remote_avg !== null ? t(', {remote_avg} en remoto', { remote_avg: formatNumber(summary.remote_avg) }) : '' })}</span> : null}
      </p>
    </div>
    {summary.days_measured < 7 || isMeasuring(data.measurement?.status) || data.measurement?.status === 'failed'
      ? <MeasurementStatus configured={data.configured} measurement={data.measurement ?? null} daysMeasured={summary.days_measured} /> : null}
    <section className="nsk-office-block" aria-label={t('Evolución por semana')}>
      <div className="nsk-office-block-head">
        <h3 className="nsk-office-subtitle">{t('Evolución por semana')}</h3>
        <OfficeSwitch label={t('Métrica de la evolución')} value={chart} onChange={setChart} options={[['flagged', 'Malo o regular'], ['average', 'Promedio']]} />
      </div>
      {series.filter((week) => week.days_measured > 0).length < 2
        ? <p className="nsk-attention-explanation">La evolución aparece cuando haya dos semanas medidas. Por ahora: {series.map((week) => t('{week_start}, {days_measured} de 7 días', { week_start: weekRange(week.week_start), days_measured: week.days_measured })).join('; ')}.</p>
        : chart === 'flagged'
          ? <section aria-label={t('Personas con rendimiento malo o regular por semana')}><NetskopeOfficeTrend series={series} /></section>
          : <section aria-label={t('Puntaje promedio por semana')}><NetskopeOfficeAverages series={series} /></section>}
    </section>
    <section className="nsk-office-block" aria-label={t('Detalle')}>
      <div className="nsk-office-block-head">
        <OfficeSwitch label={t('Detalle')} value={detail} onChange={(value) => { setDetail(value); setShown(PAGE); }} options={[['people', 'Personas'], ['weekdays', t('Por día')], ['companies', 'Por empresa']]} />
        {detail === 'people' ? <OfficeSwitch label={t('Alcance')} value={effectiveScope} onChange={(value) => { setScope(value); setShown(PAGE); }}
          options={[['flagged', t('Malo, regular o peor en oficina · {flaggedPeople}', { flaggedPeople: formatNumber(flaggedPeople) })], ['all', t('Todas en oficina · {people_total}', { people_total: formatNumber(data.people_total) })]]} /> : null}
      </div>
      {detail === 'weekdays' ? <section aria-label={t('Por día de la semana')}>
        <div className="compact-table-wrap"><table className="compact-table">
          <caption className="sr-only">{t('Por día de la semana, en los días medidos de las semanas del gráfico')}</caption>
          <thead><tr><th scope="col">{t('Día')}</th><th scope="col">{t('Personas en oficina por día')}</th><th scope="col">{t('Puntaje en oficina')}</th><th scope="col">{t('Días-persona malos o regulares')}</th></tr></thead>
          <tbody>{(data.weekdays ?? []).map((day) => <tr key={day.weekday}>
            <th scope="row">{day.name}</th>
            {day.days_measured === 0 ? <td colSpan={3} className="nsk-attention-empty">{t('Sin medición')}</td> : <>
              <td>{formatNumber(day.office_people_per_day ?? 0)}</td><td>{score(day.office_avg)}</td><td>{formatNumber(day.flagged_person_days ?? 0)}</td>
            </>}
          </tr>)}</tbody>
        </table></div>
      </section>
        : detail === 'companies' ? <section aria-label={t('Por empresa')}>
          <div className="compact-table-wrap"><table className="compact-table">
            <caption className="sr-only">{t('Por empresa, últimos 7 días')}</caption>
            <thead><tr><th scope="col">{t('Empresa')}</th><th scope="col">{t('En oficina')}</th><th scope="col">{t('Malo o regular')}</th><th scope="col">{t('Peor en oficina')}</th><th scope="col">{t('Promedio')}</th></tr></thead>
            <tbody>{(data.companies?.rows ?? []).map((company) => <tr key={company.company}>
              <th scope="row">{company.company}</th>
              <td>{formatNumber(company.office_people)}</td><td>{t('{flagged} de {measured}', { flagged: formatNumber(company.flagged), measured: formatNumber(company.measured) })}</td>
              <td>{formatNumber(company.worse_in_office)}</td><td>{score(company.office_avg)}</td>
            </tr>)}</tbody>
          </table></div>
          {data.companies && data.companies.omitted_people > 0 ? <p className="nsk-attention-explanation">{t('Otras empresas: {omitted_people} personas.', { omitted_people: formatNumber(data.companies.omitted_people) })}</p> : null}
        </section>
        : !people.length ? <StateBlock compact variant="empty" title={effectiveScope === 'flagged' ? t('Nadie tuvo rendimiento malo, regular o peor en la oficina') : t('Nadie fue a la oficina en los días medidos')} />
        : <>
          <div className="compact-table-wrap"><table className="compact-table nsk-office-table">
            <caption className="sr-only">{t('Personas que fueron a la oficina, peor rendimiento primero')}</caption>
            <thead><tr><th scope="col">{t('Usuario')}</th><th scope="col">{t('Días en oficina')}</th><th scope="col">{t('En la oficina')}</th><th scope="col">{t('En remoto')}</th><th scope="col">{t('Diferencia')}</th></tr></thead>
            <tbody>{people.slice(0, shown).map((person) => {
              const gap = person.office_score !== null && person.remote_score !== null ? Math.round(person.office_score - person.remote_score) : null;
              return <tr key={person.email}>
                <th scope="row"><button type="button" className="nsk-attention-user" onClick={() => onPick({ email: person.email, name: person.name })}>
                  <strong>{person.name || person.email}</strong><small>{person.name ? person.email : null}{person.company ? `${person.name ? ' · ' : ''}${person.company}` : null}</small>
                </button></th>
                <td>{t('{office_days} de 7', { office_days: person.office_days })}</td>
                <td><span className="nsk-attention-uci">{person.office_band ? <StatusBadge tone={BAND_TONES[person.office_band]}>{BAND_LABELS[person.office_band]}</StatusBadge> : null}{score(person.office_score)}</span></td>
                <td>{score(person.remote_score)}</td>
                <td>{gap === null ? <span className="nsk-attention-empty">{t('Sin dato')}</span> : person.worse_in_office ? <StatusBadge tone="warning">{t('Peor en oficina {gap}', { gap: gap })}</StatusBadge> : `${gap > 0 ? '+' : ''}${gap}`}</td>
              </tr>;
            })}</tbody>
          </table></div>
          <p className="nsk-attention-explanation nsk-office-more">
            {formatNumber(Math.min(shown, people.length))} de {formatNumber(effectiveScope === 'all' ? data.people_total : people.length)}
            {effectiveScope === 'all' && data.people_total > data.people.length ? t(' · se listan las {people} con peor rendimiento', { people: formatNumber(data.people.length) }) : ''}
            {shown < people.length ? <button type="button" className="button subtle" onClick={() => setShown((value) => value + PAGE)}>{t('Ver {shown} más', { shown: formatNumber(Math.min(PAGE, people.length - shown)) })}</button> : null}
          </p>
        </>}
    </section>
  </section>;
}
