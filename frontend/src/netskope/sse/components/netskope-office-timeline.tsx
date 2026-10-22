import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import type { NetskopeOfficeTimeline, NetskopeOfficeTimelinePoint } from '../types/netskope';
import { CompactSelect } from '../../../cross/components/compact-select';
import { DateRangeField } from '../../../cross/components/date-range-field';
import { HelpHint } from '../../../cross/components/help-hint';
import { StateBlock } from '../../../cross/components/state-block';
import { ApiError } from '../../../cross/lib/api';
import { formatNumber } from '../../../cross/lib/format';
import { useDebouncedValue } from '../../../cross/hooks/use-debounced-value';
import { fetchNetskopeOfficeTimeline, fetchNetskopeUsers } from '../lib/netskope-api';
import { EMPTY_NETSKOPE_USERS_FILTERS } from '../lib/netskope-device-filters';
import { dayLabel, weekdayShort } from '../lib/netskope-office';
import { PERFORMANCE_EXPLANATION, PERFORMANCE_SCALE } from '../lib/netskope-user-score';
import { OfficeSwitch } from './netskope-office-experience';
import './netskope-office-experience.css';
import './netskope-office-timeline.css';

type Place = 'office' | 'remote' | 'both';
type Person = { email: string; name: string };
const RANGES = [['30', '30 días'], ['90', '90 días'], ['180', '180 días'], ['dates', 'Fechas']] as const;
const KEPT_DAYS = 180;
/** YYYY-MM-DD of the UTC day `offset` days from today (the measurement works in complete UTC days). */
const utcDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const ALL = '';

const WIDTH = 1100;
const HEIGHT = 260;
const TOP = 14;
const BOTTOM = 26;
const LEFT = 30;
const RIGHT = 16;
const PLOT_W = WIDTH - LEFT - RIGHT;
const PLOT_H = HEIGHT - TOP - BOTTOM;

type Line = { key: string; label: string; place: 'office' | 'remote'; person: boolean; value: (point: NetskopeOfficeTimelinePoint) => number | null | undefined; people?: (point: NetskopeOfficeTimelinePoint) => number | null };

/** NSK-EXP-OFFICE-002: the daily average score for everyone or one company, in the office and remote, with one
    person's own line on top. Each person weighs the same; a day not measured is a gap, never a zero. */
export function NetskopeOfficeTimeline({ enabled, refreshKey, onUnauthorized, onPick }: {
  enabled: boolean; refreshKey: number; onUnauthorized: () => void; onPick: (person: { email: string; name: string | null }) => void;
}) {
  const [days, setDays] = useState<(typeof RANGES)[number][0]>('30');
  const [company, setCompany] = useState(ALL);
  const [place, setPlace] = useState<Place>('both');
  const [person, setPerson] = useState<Person | null>(null);
  const [range, setRange] = useState({ start: utcDay(-7), end: utcDay(-1) });
  const dates = days === 'dates';
  const validRange = !dates || (Boolean(range.start) && Boolean(range.end) && range.start <= range.end);
  const query = useQuery({
    queryKey: ['netskope', 'experience', 'office-timeline', days, dates ? range.start : '', dates ? range.end : '', company, person?.email ?? '', refreshKey],
    enabled: enabled && validRange,
    queryFn: ({ signal }) => fetchNetskopeOfficeTimeline({ days: dates ? 30 : Number(days), company, email: person?.email ?? '', ...(dates ? range : {}) }, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false, placeholderData: (previous) => previous,
  });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
  }, [query.error, onUnauthorized]);

  const data = query.data;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { setSelected(new Set()); }, [data]);
  const scope = company || 'Todas las empresas';
  const personCompany = data?.person?.company ?? null;
  return <section className="list-panel database-surface nsk-office nsk-timeline" aria-label="Evolución diaria">
    <div className="nsk-attention-head">
      <h2>Evolución diaria</h2>
      <HelpHint label="Evolución diaria">
        <p>Puntaje de rendimiento digital (ADEM) promedio de cada día, medido por separado en los horarios en la oficina y en remoto. Cada persona pesa lo mismo, sin importar cuántas horas estuvo conectada.</p>
        <p>Remoto incluye solo a quienes también van a la oficina, que son las personas que se miden. Un punto hueco es un día con menos de {data?.min_people ?? 5} personas medidas: el promedio es poco representativo.</p>
        <p>Al elegir una persona, su línea se superpone al promedio del filtro de empresa. {PERFORMANCE_EXPLANATION} {PERFORMANCE_SCALE}</p>
      </HelpHint>
    </div>
    <div className="nsk-timeline-controls">
      <CompactSelect ariaLabel="Empresa" value={company} onChange={setCompany}
        options={[{ value: ALL, label: 'Todas las empresas' }, ...(data?.companies ?? []).map((row) => ({ value: row.company, label: `${row.company} · ${formatNumber(row.people)}` }))]} />
      <PersonPicker person={person} onChange={setPerson} enabled={enabled} />
      <OfficeSwitch label="Lugar" value={place} onChange={setPlace} options={[['both', 'Oficina y remoto'], ['office', 'Oficina'], ['remote', 'Remoto']]} />
      <OfficeSwitch label="Período" value={days} onChange={setDays} options={RANGES} />
      {dates ? <DateRangeField label="Fechas" value={range} onChange={setRange} min={utcDay(-KEPT_DAYS)} max={utcDay(-1)}
        presets={[{ label: 'Ayer', range: { start: utcDay(-1), end: utcDay(-1) } }, { label: 'Últimos 7 días', range: { start: utcDay(-7), end: utcDay(-1) } }, { label: 'Últimos 30 días', range: { start: utcDay(-30), end: utcDay(-1) } }]} /> : null}
    </div>
    {person && data?.person ? <p className="nsk-timeline-person-note">
      <button type="button" className="button subtle" onClick={() => onPick({ email: person.email, name: data.person?.name ?? person.name })}>Abrir ficha de {data.person.name || person.name}</button>
      {personCompany && personCompany !== company ? <button type="button" className="button subtle" onClick={() => setCompany(personCompany)}>Comparar con su empresa ({personCompany})</button> : null}
    </p> : null}
    {!validRange ? <StateBlock compact variant="empty" title="Elegí un rango válido" hint="«Desde» tiene que ser anterior o igual a «Hasta». Se guardan los últimos 180 días completos." />
      : query.isPending ? <StateBlock compact variant="loading" title="Leyendo la evolución diaria…" />
      : query.isError || !data || !Array.isArray(data.points) ? <StateBlock compact variant="error" title="No se pudo leer la evolución diaria" action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>Reintentar lectura</button>} />
      : !data.points.length ? <StateBlock compact variant="empty" title="Todavía no hay días medidos en este período" hint={company ? `Puede que ${company} no tenga personas medidas.` : undefined} />
      : <>
        <PeriodSummary data={data} place={place} scope={scope} personName={person ? data.person?.name || person.name : null} selected={selected} onClear={() => setSelected(new Set())} />
        <TimelineChart data={data} place={place} scope={scope} personName={person ? data.person?.name || person.name : null} selected={selected} onSelect={setSelected} />
      </>}
  </section>;
}

/** Search a person in the Netskope users inventory; the chosen one becomes a removable chip. */
function PersonPicker({ person, onChange, enabled }: { person: Person | null; onChange: (person: Person | null) => void; enabled: boolean }) {
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim());
  const users = useQuery({
    queryKey: ['netskope', 'experience', 'timeline-person', term],
    enabled: enabled && !person && term.length >= 2,
    queryFn: ({ signal }) => fetchNetskopeUsers(term, 0, EMPTY_NETSKOPE_USERS_FILTERS, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  if (person) {
    return <span className="nsk-timeline-chip">{person.name}
      <button type="button" aria-label={`Quitar a ${person.name}`} onClick={() => onChange(null)}><X size={12} aria-hidden /></button>
    </span>;
  }
  const rows = (users.data?.rows ?? []).filter((row) => String(row.attributes.email || '').includes('@'));
  return <div className="nsk-timeline-search">
    <label className="search-box"><Search size={14} aria-hidden /><input type="search" aria-label="Buscar una persona para comparar"
      placeholder="Persona (nombre o correo)" maxLength={160} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    {term.length >= 2 && search.trim() === term && users.data ? <div className="nsk-timeline-results" role="listbox" aria-label="Personas encontradas">
      {rows.length ? rows.slice(0, 8).map((row) => <button key={row.object_id} type="button" role="option" aria-selected="false"
        onClick={() => { onChange({ email: String(row.attributes.email).trim().toLowerCase(), name: row.display_name }); setSearch(''); }}>
        <strong>{row.display_name}</strong><small>{String(row.attributes.email)}</small>
      </button>) : <p>Sin personas para esta búsqueda</p>}
    </div> : null}
  </div>;
}

/** "12, 13 y 16 oct"-style list for a few days; a long selection reads as its first and last day and a count. */
function daysLabel(days: string[]) {
  if (days.length <= 4) return days.length === 1 ? dayLabel(days[0]) : `${days.slice(0, -1).map(dayLabel).join(', ')} y ${dayLabel(days[days.length - 1])}`;
  return `${dayLabel(days[0])} al ${dayLabel(days[days.length - 1])}`;
}

/** The answer at a glance for the days chosen on the chart or, with none chosen, for every measured day shown:
    one date reads its own averages and people; several the mean of their measured days. */
function PeriodSummary({ data, place, scope, personName, selected, onClear }: {
  data: NetskopeOfficeTimeline; place: Place; scope: string; personName: string | null; selected: ReadonlySet<string>; onClear: () => void;
}) {
  const shown = selected.size ? data.points.filter((point) => selected.has(point.day)) : data.points;
  const measured = shown.filter((point) => point.measured);
  const mean = (values: (number | null | undefined)[]) => {
    const present = values.filter((value): value is number => typeof value === 'number');
    return present.length ? Math.round((present.reduce((sum, value) => sum + value, 0) / present.length) * 10) / 10 : null;
  };
  const show = (value: number | null) => (value === null ? 'sin dato' : formatNumber(value));
  const one = measured.length === 1 ? measured[0] : null;
  const places = place === 'both' ? (['office', 'remote'] as const) : ([place] as const);
  const days = shown.map((point) => point.day);
  const period = one && shown.length === 1 ? `${weekdayShort(one.day)} ${dayLabel(one.day)}`
    : `${selected.size ? `${formatNumber(selected.size)} ${selected.size === 1 ? 'día elegido' : 'días elegidos'}: ${daysLabel(days)}` : `${dayLabel(days[0])} al ${dayLabel(days[days.length - 1])}`} · promedio de ${formatNumber(measured.length)} ${measured.length === 1 ? 'día medido' : 'días medidos'}`;
  return <p className="nsk-timeline-summary" aria-label="Resumen del período">
    <span className="nsk-timeline-summary-period">{selected.size && one && shown.length === 1 ? `Día elegido: ${period}` : period}</span>
    {places.map((where) => {
      const name = where === 'office' ? 'Oficina' : 'Remoto';
      const value = mean(measured.map((point) => (where === 'office' ? point.office_avg : point.remote_avg)));
      const people = one ? (where === 'office' ? one.office_people : one.remote_people) : null;
      return <span key={where}><i className={`nsk-office-line-swatch is-${where}${mutedWhen(personName)}`} aria-hidden />{name} · {scope} <strong>{show(value)}</strong>{people !== null ? <small> · {formatNumber(people ?? 0)} personas</small> : null}</span>;
    })}
    {selected.size ? <button type="button" className="button subtle" onClick={onClear}>Quitar selección</button> : null}
    {personName ? places.map((where) => <span key={`p-${where}`}><i className={`nsk-office-line-swatch is-${where} is-person`} aria-hidden />{personName} en {where === 'office' ? 'oficina' : 'remoto'} <strong>{show(mean(measured.map((point) => (where === 'office' ? point.person_office : point.person_remote))))}</strong></span>) : null}
  </p>;
}

type Modifiers = { toggle: boolean; extend: boolean };

function TimelineChart({ data, place, scope, personName, selected, onSelect }: {
  data: NetskopeOfficeTimeline; place: Place; scope: string; personName: string | null; selected: ReadonlySet<string>; onSelect: (days: ReadonlySet<string>) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const points = data.points;
  // Drag: the day it started on, the selection it adds to (Ctrl/Cmd keeps the previous days) and whether it moved.
  // Pressing the only chosen day clears it only if released without moving, so a drag can start there.
  const drag = useRef<{ anchor: number; base: ReadonlySet<string>; moved: boolean; clearOnRelease: boolean } | null>(null);
  const lastAnchor = useRef<number | null>(null);
  useEffect(() => {
    const end = () => {
      if (drag.current?.clearOnRelease && !drag.current.moved) onSelect(new Set());
      drag.current = null;
    };
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, [onSelect]);
  const span = (from: number, to: number) => points.slice(Math.min(from, to), Math.max(from, to) + 1).map((point) => point.day);
  const choose = (index: number, { toggle, extend }: Modifiers) => {
    const day = points[index].day;
    if (extend && lastAnchor.current !== null) {
      onSelect(new Set([...(toggle ? selected : []), ...span(lastAnchor.current, index)]));
      return false;
    }
    lastAnchor.current = index;
    if (toggle) {
      const next = new Set(selected);
      if (next.has(day)) { next.delete(day); onSelect(next); return false; }
      next.add(day);
      onSelect(next);
      return true;
    }
    // A plain click on the only chosen day clears it; otherwise it becomes the only one.
    onSelect(selected.size === 1 && selected.has(day) ? new Set() : new Set([day]));
    return !(selected.size === 1 && selected.has(day));
  };
  const onPointerDown = (index: number, event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const modifiers = { toggle: event.ctrlKey || event.metaKey, extend: event.shiftKey };
    if (modifiers.toggle || modifiers.extend) {
      if (choose(index, modifiers) && !modifiers.extend) drag.current = { anchor: index, base: new Set(selected), moved: false, clearOnRelease: false };
      return;
    }
    const day = points[index].day;
    lastAnchor.current = index;
    const onlyThis = selected.size === 1 && selected.has(day);
    if (!onlyThis) onSelect(new Set([day]));
    drag.current = { anchor: index, base: new Set(), moved: false, clearOnRelease: onlyThis };
  };
  const onPointerEnter = (index: number) => {
    setActive(index);
    if (drag.current && index !== drag.current.anchor) {
      drag.current.moved = true;
      onSelect(new Set([...drag.current.base, ...span(drag.current.anchor, index)]));
    }
  };
  const onKeyDown = (index: number, event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    choose(index, { toggle: event.ctrlKey || event.metaKey, extend: event.shiftKey });
  };
  const places = place === 'both' ? (['office', 'remote'] as const) : ([place] as const);
  const lines: Line[] = places.flatMap((where) => {
    const name = where === 'office' ? 'Oficina' : 'Remoto';
    const base: Line = { key: `${where}-base`, label: `${name} · ${scope}`, place: where, person: false,
      value: (point) => (where === 'office' ? point.office_avg : point.remote_avg), people: (point) => (where === 'office' ? point.office_people : point.remote_people) };
    const own: Line = { key: `${where}-person`, label: `${name} · ${personName}`, place: where, person: true,
      value: (point) => (where === 'office' ? point.person_office : point.person_remote) };
    return personName ? [base, own] : [base];
  });
  const values = points.flatMap((point) => lines.map((line) => line.value(point))).filter((value): value is number => typeof value === 'number');
  const low = values.length ? Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10) : 0;
  const step = PLOT_W / Math.max(1, points.length);
  const x = (index: number) => LEFT + step * index + step / 2;
  const y = (value: number) => TOP + PLOT_H - ((value - low) / (100 - low)) * PLOT_H;
  const runs = (line: Line) => {
    // Consecutive days with a value form one segment; a missing day breaks the line.
    const result: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];
    points.forEach((point, index) => {
      const value = line.value(point);
      if (typeof value !== 'number') { if (run.length) result.push(run); run = []; return; }
      run.push({ x: x(index), y: y(value) });
    });
    if (run.length) result.push(run);
    return result;
  };
  const tickEvery = Math.max(1, Math.ceil(points.length / 8));
  const few = (line: Line, point: NetskopeOfficeTimelinePoint) => !line.person && (line.people?.(point) ?? 0) < data.min_people;
  const describe = (point: NetskopeOfficeTimelinePoint) => !point.measured ? `${dayLabel(point.day)}: sin medición`
    : `${dayLabel(point.day)}: ${lines.map((line) => { const value = line.value(point); return `${line.label} ${typeof value === 'number' ? formatNumber(value) : 'sin dato'}${line.people ? ` (${formatNumber(line.people(point) ?? 0)} personas)` : ''}`; }).join('; ')}`;
  const activePoint = active === null ? null : points[active];
  return <figure className="nsk-office-trend nsk-timeline-chart">
    {/* The period summary above names each line with its swatch, so it doubles as the legend. */}
    <figcaption className="nsk-timeline-caption">
      <span className="nsk-attention-explanation">{table ? null : 'Clic en un día para verlo; arrastrá para elegir varios seguidos; Ctrl (⌘ en Mac) + clic suma o quita días sueltos.'}</span>
      <button type="button" className="button subtle" aria-pressed={table} onClick={() => setTable((value) => !value)}>{table ? 'Ver gráfico' : 'Ver como tabla'}</button>
    </figcaption>
    {points.filter((point) => point.measured).length < 2 ? <p className="nsk-attention-explanation">Un solo día medido: la línea aparece desde el segundo.</p> : null}
    {table ? <div className="compact-table-wrap"><table className="compact-table">
      <caption className="sr-only">Puntaje promedio por día</caption>
      <thead><tr><th scope="col">Día</th>{lines.map((line) => <th key={line.key} scope="col">{line.label}</th>)}</tr></thead>
      <tbody>{points.slice().reverse().map((point) => <tr key={point.day}>
        <th scope="row">{weekdayShort(point.day)} {dayLabel(point.day)}</th>
        {!point.measured ? <td colSpan={lines.length} className="nsk-attention-empty">Sin medición</td>
          : lines.map((line) => { const value = line.value(point); return <td key={line.key}>{typeof value === 'number' ? formatNumber(value) : <span className="nsk-attention-empty">Sin dato</span>}{line.people ? <small className="nsk-timeline-people"> · {formatNumber(line.people(point) ?? 0)} personas</small> : null}</td>; })}
      </tr>)}</tbody>
    </table></div>
      : <div className="nsk-office-trend-plot nsk-timeline-plot" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={`Evolución diaria del puntaje promedio, ${scope}`}>
          {[low, Math.round((low + 100) / 2), 100].map((tick) => <g key={tick}>
            <line className="nsk-office-grid" x1={LEFT} x2={LEFT + PLOT_W} y1={y(tick)} y2={y(tick)} />
            <text className="nsk-office-tick" x={LEFT - 6} y={y(tick) + 4} textAnchor="end">{tick}</text>
          </g>)}
          {points.map((point, index) => selected.has(point.day) ? <rect key={point.day} className="nsk-timeline-selected" x={LEFT + step * index} y={TOP} width={step} height={PLOT_H} /> : null)}
          {active !== null ? <line className="nsk-office-crosshair" x1={x(active)} x2={x(active)} y1={TOP} y2={TOP + PLOT_H} /> : null}
          {lines.map((line) => <g key={line.key} className={`nsk-office-series is-${line.place}${line.person ? ' is-person' : mutedWhen(personName)}`}>
            {runs(line).map((run, index) => <polyline key={index} points={run.map((point) => `${point.x},${point.y}`).join(' ')} />)}
            {points.map((point, index) => {
              const value = line.value(point);
              return typeof value === 'number' ? <circle key={point.day} className={few(line, point) ? 'is-few' : undefined} cx={x(index)} cy={y(value)} r={line.person ? 6 : 4.5} /> : null;
            })}
          </g>)}
          {points.map((point, index) => <g key={point.day} tabIndex={0} role="button" aria-pressed={selected.has(point.day)} className="nsk-office-week nsk-timeline-day" aria-label={describe(point)}
            onPointerDown={(event) => onPointerDown(index, event)} onPointerEnter={() => onPointerEnter(index)} onKeyDown={(event) => onKeyDown(index, event)}
            onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
            <rect className="nsk-office-hit" x={LEFT + step * index} y={0} width={step} height={HEIGHT} />
            {index % tickEvery === 0 || selected.has(point.day) ? <text className={`nsk-office-tick${selected.has(point.day) ? ' is-selected' : ''}`} x={x(index)} y={HEIGHT - 8} textAnchor="middle">{dayLabel(point.day)}</text> : null}
          </g>)}
        </svg>
        {activePoint ? <div className={`nsk-office-tooltip${(active ?? 0) >= points.length / 2 ? ' is-left' : ''}`} role="tooltip" style={{ left: `${(x(active ?? 0) / WIDTH) * 100}%` }}>
          <strong>{weekdayShort(activePoint.day)} {dayLabel(activePoint.day)}</strong>
          {!activePoint.measured ? <span>Sin medición</span> : lines.map((line) => {
            const value = line.value(activePoint);
            return <span key={line.key}><i className={`nsk-office-line-swatch is-${line.place}${line.person ? ' is-person' : ''}`} aria-hidden />
              {line.label} {typeof value === 'number' ? formatNumber(value) : 'sin dato'}
              {line.people ? ` · ${formatNumber(line.people(activePoint) ?? 0)} personas${few(line, activePoint) ? ' (pocas)' : ''}` : ''}</span>;
          })}
        </div> : null}
      </div>}
  </figure>;
}

/** With a person on top, the group lines step back so the person's line reads first. */
const mutedWhen = (personName: string | null) => (personName ? ' is-muted' : '');
