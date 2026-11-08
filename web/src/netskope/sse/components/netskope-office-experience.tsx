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

const BAND_LABELS: Record<NetskopePerformanceBand, string> = { poor: 'Malo', fair: 'Regular', good: 'Bglobex' };
const BAND_TONES = { poor: 'danger', fair: 'warning', good: 'success' } as const;
const score = (value: number | null) => value === null ? <span className="nsk-attention-empty">Sin dato</span> : formatNumber(Math.round(value));

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
    ? ['neutral', 'No activada', 'La medición en la oficina no está activada en este entorno.'] as const
    : isMeasuring(measurement?.status)
      ? ['info', 'Midiendo ahora', `Cada día lleva unos 10 minutos y cada corrida mide hasta 2 días. ${missing > 0 ? `Faltan ${missing} de 7; se completan en las próximas corridas (cada 3 h).` : ''} La pantalla se actualiza sola.`] as const
      : measurement?.status === 'failed'
        ? ['warning', 'Falló la última medición', 'Los días pendientes se vuelven a intentar en la próxima corrida (cada 3 h).'] as const
        : ['neutral', 'Pendiente', missing > 0 ? `Faltan ${missing} de 7 días; se miden en las próximas corridas (cada 3 h).` : 'Esperando la próxima corrida.'] as const;
  const since = measurement?.started_at && isMeasuring(measurement.status) ? measurement.started_at : measurement?.completed_at;
  return <div className="nsk-office-status" role="status">
    <StatusBadge tone={tone}>{label}</StatusBadge>
    <span><strong>{daysMeasured} de 7 días medidos.</strong> {text}</span>
    {since ? <small>{isMeasuring(measurement?.status) ? 'Desde' : 'Última corrida'}: <DateTime value={since} /></small> : null}
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

  if (query.isPending) return <StateBlock variant="loading" title="Leyendo el rendimiento en la oficina…" />;
  const data = query.data;
  // A malformed answer is an error inside this view, never a crash of the workspace.
  if (query.isError || !data || !Array.isArray(data.series) || !Array.isArray(data.people) || !data.summary) {
    return <StateBlock variant="error" title="No se pudo leer el rendimiento en la oficina" action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>Reintentar lectura</button>} />;
  }
  const everMeasured = data.series.some((week) => week.days_measured > 0) || data.summary.days_measured > 0;
  // Before the first measured day: only where the measurement stands.
  if (!everMeasured) {
    return <section className="list-panel database-surface nsk-office" aria-label="Rendimiento en la oficina">
      <div className="nsk-attention-head"><h2>Rendimiento en la oficina</h2></div>
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
  return <section className="list-panel database-surface nsk-office" aria-label="Rendimiento en la oficina">
    <div className="nsk-attention-head">
      <h2>Rendimiento en la oficina</h2>
      <HelpHint label="Rendimiento en la oficina">
        <p>Puntaje de rendimiento digital (ADEM) medido solo en los horarios en que el equipo de cada persona estuvo en la oficina, según la detección on-premises de Netskope. Se promedia por minutos y no se mezcla con los días remotos. Se compara con el puntaje de sus horarios remotos: «Peor en oficina» marca {data.office_gap} puntos o más por debajo.</p>
        <p>{PERFORMANCE_EXPLANATION} {PERFORMANCE_SCALE} Bandas de Netskope: malo 0–30, regular 31–70, bglobex 71–100.</p>
        <p>Se miden días completos (UTC), hasta ayer. Una persona sin puntaje en la oficina figura «Sin dato», nunca como buena. Una semana sin días medidos no es cero.</p>
      </HelpHint>
      <small className="nsk-office-freshness">{summary.days_measured} de 7 días medidos{data.last_measured_at ? <> · <DateTime value={data.last_measured_at} /></> : null}</small>
    </div>
    <div className="nsk-office-headline" role="group" aria-label="Resumen de los últimos 7 días">
      <p><strong>{formatNumber(flaggedCount)}</strong> de {formatNumber(summary.measured)} personas medidas en la oficina tuvieron rendimiento malo o regular <small>· {dayLabel(data.window_start)} al {dayLabel(data.window_end)}</small></p>
      <p className="nsk-office-facts">
        <span><i className="nsk-office-dot is-poor" aria-hidden />Malo {formatNumber(summary.poor)}</span>
        <span><i className="nsk-office-dot is-fair" aria-hidden />Regular {formatNumber(summary.fair)}</span>
        <span><i className="nsk-office-dot is-good" aria-hidden />Bglobex {formatNumber(summary.good)}</span>
        <span>Peor en oficina que en remoto {formatNumber(summary.worse_in_office)}</span>
        {withoutScore > 0 ? <span>Sin dato {formatNumber(withoutScore)}</span> : null}
        {summary.office_avg !== null ? <span>Promedio {formatNumber(summary.office_avg)} en oficina{summary.remote_avg !== null ? `, ${formatNumber(summary.remote_avg)} en remoto` : ''}</span> : null}
      </p>
    </div>
    {summary.days_measured < 7 || isMeasuring(data.measurement?.status) || data.measurement?.status === 'failed'
      ? <MeasurementStatus configured={data.configured} measurement={data.measurement ?? null} daysMeasured={summary.days_measured} /> : null}
    <section className="nsk-office-block" aria-label="Evolución por semana">
      <div className="nsk-office-block-head">
        <h3 className="nsk-office-subtitle">Evolución por semana</h3>
        <OfficeSwitch label="Métrica de la evolución" value={chart} onChange={setChart} options={[['flagged', 'Malo o regular'], ['average', 'Promedio']]} />
      </div>
      {series.filter((week) => week.days_measured > 0).length < 2
        ? <p className="nsk-attention-explanation">La evolución aparece cuando haya dos semanas medidas. Por ahora: {series.map((week) => `${weekRange(week.week_start)}, ${week.days_measured} de 7 días`).join('; ')}.</p>
        : chart === 'flagged'
          ? <section aria-label="Personas con rendimiento malo o regular por semana"><NetskopeOfficeTrend series={series} /></section>
          : <section aria-label="Puntaje promedio por semana"><NetskopeOfficeAverages series={series} /></section>}
    </section>
    <section className="nsk-office-block" aria-label="Detalle">
      <div className="nsk-office-block-head">
        <OfficeSwitch label="Detalle" value={detail} onChange={(value) => { setDetail(value); setShown(PAGE); }} options={[['people', 'Personas'], ['weekdays', 'Por día'], ['companies', 'Por empresa']]} />
        {detail === 'people' ? <OfficeSwitch label="Alcance" value={effectiveScope} onChange={(value) => { setScope(value); setShown(PAGE); }}
          options={[['flagged', `Malo, regular o peor en oficina · ${formatNumber(flaggedPeople)}`], ['all', `Todas en oficina · ${formatNumber(data.people_total)}`]]} /> : null}
      </div>
      {detail === 'weekdays' ? <section aria-label="Por día de la semana">
        <div className="compact-table-wrap"><table className="compact-table">
          <caption className="sr-only">Por día de la semana, en los días medidos de las semanas del gráfico</caption>
          <thead><tr><th scope="col">Día</th><th scope="col">Personas en oficina por día</th><th scope="col">Puntaje en oficina</th><th scope="col">Días-persona malos o regulares</th></tr></thead>
          <tbody>{(data.weekdays ?? []).map((day) => <tr key={day.weekday}>
            <th scope="row">{day.name}</th>
            {day.days_measured === 0 ? <td colSpan={3} className="nsk-attention-empty">Sin medición</td> : <>
              <td>{formatNumber(day.office_people_per_day ?? 0)}</td><td>{score(day.office_avg)}</td><td>{formatNumber(day.flagged_person_days ?? 0)}</td>
            </>}
          </tr>)}</tbody>
        </table></div>
      </section>
        : detail === 'companies' ? <section aria-label="Por empresa">
          <div className="compact-table-wrap"><table className="compact-table">
            <caption className="sr-only">Por empresa, últimos 7 días</caption>
            <thead><tr><th scope="col">Empresa</th><th scope="col">En oficina</th><th scope="col">Malo o regular</th><th scope="col">Peor en oficina</th><th scope="col">Promedio</th></tr></thead>
            <tbody>{(data.companies?.rows ?? []).map((company) => <tr key={company.company}>
              <th scope="row">{company.company}</th>
              <td>{formatNumber(company.office_people)}</td><td>{formatNumber(company.flagged)} de {formatNumber(company.measured)}</td>
              <td>{formatNumber(company.worse_in_office)}</td><td>{score(company.office_avg)}</td>
            </tr>)}</tbody>
          </table></div>
          {data.companies && data.companies.omitted_people > 0 ? <p className="nsk-attention-explanation">Otras empresas: {formatNumber(data.companies.omitted_people)} personas.</p> : null}
        </section>
        : !people.length ? <StateBlock compact variant="empty" title={effectiveScope === 'flagged' ? 'Nadie tuvo rendimiento malo, regular o peor en la oficina' : 'Nadie fue a la oficina en los días medidos'} />
        : <>
          <div className="compact-table-wrap"><table className="compact-table nsk-office-table">
            <caption className="sr-only">Personas que fueron a la oficina, peor rendimiento primero</caption>
            <thead><tr><th scope="col">Usuario</th><th scope="col">Días en oficina</th><th scope="col">En la oficina</th><th scope="col">En remoto</th><th scope="col">Diferencia</th></tr></thead>
            <tbody>{people.slice(0, shown).map((person) => {
              const gap = person.office_score !== null && person.remote_score !== null ? Math.round(person.office_score - person.remote_score) : null;
              return <tr key={person.email}>
                <th scope="row"><button type="button" className="nsk-attention-user" onClick={() => onPick({ email: person.email, name: person.name })}>
                  <strong>{person.name || person.email}</strong><small>{person.name ? person.email : null}{person.company ? `${person.name ? ' · ' : ''}${person.company}` : null}</small>
                </button></th>
                <td>{person.office_days} de 7</td>
                <td><span className="nsk-attention-uci">{person.office_band ? <StatusBadge tone={BAND_TONES[person.office_band]}>{BAND_LABELS[person.office_band]}</StatusBadge> : null}{score(person.office_score)}</span></td>
                <td>{score(person.remote_score)}</td>
                <td>{gap === null ? <span className="nsk-attention-empty">Sin dato</span> : person.worse_in_office ? <StatusBadge tone="warning">{`Peor en oficina ${gap}`}</StatusBadge> : `${gap > 0 ? '+' : ''}${gap}`}</td>
              </tr>;
            })}</tbody>
          </table></div>
          <p className="nsk-attention-explanation nsk-office-more">
            {formatNumber(Math.min(shown, people.length))} de {formatNumber(effectiveScope === 'all' ? data.people_total : people.length)}
            {effectiveScope === 'all' && data.people_total > data.people.length ? ` · se listan las ${formatNumber(data.people.length)} con peor rendimiento` : ''}
            {shown < people.length ? <button type="button" className="button subtle" onClick={() => setShown((value) => value + PAGE)}>Ver {formatNumber(Math.min(PAGE, people.length - shown))} más</button> : null}
          </p>
        </>}
    </section>
  </section>;
}
