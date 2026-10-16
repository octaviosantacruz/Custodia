import { DateTime } from '../../../cross/components/date-time';
import { Activity, BadgeCheck, Copy, GitCompareArrows } from 'lucide-react';
import { StateBlock } from '../../../cross/components/state-block';
import { MetricReading } from '../../../cross/components/metric-reading';
import { HelpHint } from '../../../cross/components/help-hint';
import { ErrorDetailsButton } from '../../../cross/components/error-details';
import { type ErrorDetails } from '../../../cross/lib/error-details';
import { formatNumber } from '../../../cross/lib/format';
import { EMPTY_NETSKOPE_DEVICE_QUERY } from '../lib/netskope-device-filters';
import { NETSKOPE_SUGGESTION_ORDER, STALE_EXPLANATION_LABELS } from '../lib/netskope-device-review';
import { fetchNetskopeDuplicates } from '../lib/netskope-api';
import { netskopeEventLabel } from '../lib/netskope-event-labels';
import { netskopeSyncStatement } from '../lib/netskope-sync-evidence';
import { useNetskopePanel, type NetskopePanelState } from '../hooks/use-netskope-panel';
import type { NetskopeClientEvents, NetskopeDeviceReviewSummary, NetskopeReviewSuggestion, NetskopeDeviceChanges, NetskopeDeviceChangeKind, NetskopeDeviceFilterKey, NetskopeDeviceQuery } from '../types/netskope';
import './netskope-operations.css';

type PanelProps = {
  enabled: boolean;
  refreshKey?: number;
  onUnauthorized: () => void;
  onDrill: (query: NetskopeDeviceQuery) => void;
};

function percent(value: number, total: number): number {
  return total ? (value / total) * 100 : 0;
}

function drillFilter(key: NetskopeDeviceFilterKey, value: string): NetskopeDeviceQuery {
  return { ...EMPTY_NETSKOPE_DEVICE_QUERY, filters: { ...EMPTY_NETSKOPE_DEVICE_QUERY.filters, [key]: value } };
}

function PanelState({ loading, error, errorInfo, onRetry, title }: { loading: boolean; error: string; errorInfo: ErrorDetails | null; onRetry: () => void; title: string }) {
  if (loading) return <StateBlock variant="loading" title={`Cargando ${title.toLowerCase()}…`} />;
  return <StateBlock variant="error" title={`No se pudo cargar ${title.toLowerCase()}`} hint={error} action={<><button type="button" className="button subtle" onClick={onRetry}>Reintentar</button>{errorInfo ? <ErrorDetailsButton details={errorInfo} /> : null}</>} />;
}

/** NSK-INV-002: why the devices without a signal for 30 days stopped reporting, as far as Netskope's own data says.
 * Read-only: each reason opens exactly its devices; nobody is asked to classify them one by one. */

export function NetskopeDiagnosisPanel({ panel, onDrill }: { panel: NetskopePanelState<NetskopeDeviceReviewSummary>; onDrill: (query: NetskopeDeviceQuery) => void }) {
  const data = panel.data;
  const title = 'Equipos sin señal: por qué';
  const sync = netskopeSyncStatement(data?.source_evidence);
  const base: NetskopeDeviceQuery = { ...EMPTY_NETSKOPE_DEVICE_QUERY, freshness: 'all', eventAge: 'gt_30d' };
  const suggestions = data?.suggestions ? NETSKOPE_SUGGESTION_ORDER.map((key) => ({ key, count: data.suggestions!.find((item) => item.key === key)?.count ?? 0 })) : null;
  const explained = suggestions?.reduce((total, item) => total + item.count, 0);
  const unexplained = data?.unclassified != null && explained !== undefined && data.unclassified >= explained ? data.unclassified - explained : null;
  // Devices a person decided on before the classification left the screens are neither suggested nor unexplained.
  const decided = data?.unclassified != null ? data.candidates - data.unclassified : 0;
  const rows: Array<{ key: NetskopeReviewSuggestion | 'none'; count: number }> = suggestions && unexplained !== null ? [...suggestions, { key: 'none', count: unexplained }] : [];
  return <article className="netskope-ops-panel" aria-labelledby="netskope-diagnosis-title">
    <header className="netskope-ops-heading">
      <div className="netskope-ops-title"><h3 id="netskope-diagnosis-title"><BadgeCheck size={15} aria-hidden="true" /> {title}</h3><HelpHint label="Equipos sin señal"><p>Equipos activos cuyo último evento tiene más de 30 días, agrupados por lo que explica Netskope. Saber si un equipo se sigue usando necesita una fuente corporativa (JumpCloud o Cortex), todavía no integrada.</p></HelpHint></div>
    </header>
    {!data ? <PanelState loading={panel.loading} error={panel.error} errorInfo={panel.errorInfo} onRetry={() => void panel.reload()} title={title} /> : <>
      <p className="database-caption" role="status">{formatNumber(data.candidates)} equipos sin señal hace más de 30 días · {sync.text}</p>
      {!rows.length
        ? <div className="netskope-review-callout is-unavailable" role="status"><strong>Agrupación no disponible: sin sync vigente</strong><span>Se calcula sólo con un sync completo de las últimas 24 h.</span></div>
        : <ul className="netskope-event-list">
          {rows.map((item) => <li key={item.key}>
            <button type="button" className="netskope-event-row is-pair" disabled={!item.count} onClick={() => onDrill({ ...base, reviewSuggestion: item.key })} aria-label={`${STALE_EXPLANATION_LABELS[item.key]}: ${formatNumber(item.count)} equipos. Ver en la tabla`}>
              <span>{STALE_EXPLANATION_LABELS[item.key]}</span><strong>{formatNumber(item.count)}</strong>
            </button>
          </li>)}
        </ul>}
      {decided > 0 ? <p className="database-caption">{formatNumber(decided)} {decided === 1 ? 'equipo tiene' : 'equipos tienen'} una decisión guardada antes y no se agrupan.</p> : null}
      <MetricReading title={title} meaning="Por qué dejaron de reportar los equipos con más de 30 días sin señal, según los datos de Netskope" population={`${formatNumber(data.candidates)} dispositivos activos con último evento de más de 30 días`} capture={sync.text} formula="Cada equipo cae en un solo grupo: desinstalación informada, reemplazo (mismo hostname y usuario en un registro de los últimos 7 días), registro histórico (más de 180 días) o sin explicación." source="Inventario de dispositivos Netskope sincronizado en DS Hub." limits="Ningún grupo prueba que el equipo se siga usando ni que se haya dado de baja; eso necesita una fuente corporativa." unknowns="Sin fecha de evento válida: el equipo no entra en esta población." />
    </>}
  </article>;
}

const VISIBLE_EVENTS = 8;

function NetskopeEventName({ literal }: { literal: string }) {
  const event = netskopeEventLabel(literal);
  return <span className="netskope-event-copy">
    <span>{event.label}</span>
    {event.known ? <small>{event.literal}</small> : null}
  </span>;
}

/* NSK-EVT-001. Every row represents the literal last event reported by the
   client, not a live session or current device state. */
export function NetskopeClientEventsPanel({ panel, onDrill }: { panel: NetskopePanelState<NetskopeClientEvents>; onDrill: (query: NetskopeDeviceQuery) => void }) {
  const data = panel.data;
  const title = 'Último evento del cliente';
  const drill = (event: string) => onDrill({ ...EMPTY_NETSKOPE_DEVICE_QUERY, filters: { ...EMPTY_NETSKOPE_DEVICE_QUERY.filters, last_seen_event: event } });
  const riskEvents = data?.events.filter((event) => event.coverage_risk) || [];
  const otherEvents = data?.events.filter((event) => !event.coverage_risk) || [];
  const visibleEvents = otherEvents.slice(0, VISIBLE_EVENTS);
  return <article className="netskope-ops-panel" aria-labelledby="netskope-events-title">
    <header className="netskope-ops-heading">
      <div className="netskope-ops-title"><h3 id="netskope-events-title"><Activity size={15} aria-hidden="true" /> {title}</h3><HelpHint label="Último evento del cliente"><p>Es el último evento reportado por el cliente: evidencia histórica, no una sesión en vivo ni el estado actual del equipo.</p></HelpHint></div>
    </header>
    {!data ? <PanelState loading={panel.loading} error={panel.error} errorInfo={panel.errorInfo} onRetry={() => void panel.reload()} title={title} /> : <>
      <section className="netskope-event-signal-block" aria-labelledby="netskope-risk-title">
        <div className="section-title"><h4 id="netskope-risk-title">Último evento: desinstalación o deshabilitación · {formatNumber(data.coverage_risk_total)}</h4><HelpHint label="Último evento"><p>Señal histórica del último evento informado por Netskope; no confirma pérdida actual de cobertura.</p></HelpHint></div>
        {riskEvents.length
          ? <ul className="netskope-event-list">{riskEvents.map((event) => <li key={event.key}><button type="button" className="netskope-event-row is-pair" onClick={() => drill(event.key)}><NetskopeEventName literal={event.key} /><strong>{formatNumber(event.count)}</strong></button></li>)}</ul>
          : <p className="database-caption">No hay valores de desinstalación o deshabilitación entre los eventos informados.</p>}
      </section>
      <ul className="netskope-event-list">
        {visibleEvents.map((event) => <li key={event.key}>
          <button type="button" className="netskope-event-row" onClick={() => drill(event.key)}>
            <NetskopeEventName literal={event.key} />
            <span className="netskope-freshness-bar" aria-hidden="true"><span className="is-active" style={{ width: `${percent(event.count, data.total)}%` }} /></span>
            <strong>{formatNumber(event.count)}</strong>
          </button>
        </li>)}
      </ul>
      <p className="database-caption">Mostrando {visibleEvents.length} de {otherEvents.length} valores informados. {formatNumber(data.total)} dispositivos con evento entre los valores informados · {data.events.length} valores distintos informados.</p>
    </>}
  </article>;
}

const CHANGE_ROWS: Array<{ kind: NetskopeDeviceChangeKind; label: string }> = [
  { kind: 'added', label: 'Dispositivos nuevos' },
  { kind: 'removed', label: 'Dejaron de reportarse (retirados)' },
  { kind: 'upgraded', label: 'Actualizaron el cliente' },
  { kind: 'downgraded', label: 'Bajaron de versión del cliente' },
  { kind: 'version_changed', label: 'Versión cambiada no comparable' },
  { kind: 'os_changed', label: 'Cambiaron de sistema operativo' },
  { kind: 'classification_changed', label: 'Cambiaron de clasificación' },
];

/* NSK-CHG-001. Diff between the two latest *completed* Netskope runs; the
   backend never compares a failed or partial run. Retired devices are no
   longer in the active table, so they are listed inline instead. */
export function NetskopeChangesPanel({ panel, onDrill }: { panel: NetskopePanelState<NetskopeDeviceChanges>; onDrill: (query: NetskopeDeviceQuery) => void }) {
  const data = panel.data;
  const title = 'Qué cambió desde la última sync';
  return <article className="netskope-ops-panel" aria-labelledby="netskope-changes-title">
    <header className="netskope-ops-heading">
      <div><h3 id="netskope-changes-title"><GitCompareArrows size={15} aria-hidden="true" /> {title}</h3><p>{data?.available && data.previous_run && data.latest_run ? <>Corrida anterior: <DateTime value={data.previous_run.captured_at} /> · última: <DateTime value={data.latest_run.captured_at} /></> : 'Compara las dos últimas corridas Netskope completas.'}</p></div>
    </header>
    {!data ? <PanelState loading={panel.loading} error={panel.error} errorInfo={panel.errorInfo} onRetry={() => void panel.reload()} title={title} />
      : !data.available ? <StateBlock variant="empty" title="Todavía no hay dos corridas para comparar" hint={`El historial por corrida empezó con la migración 058; hay ${data.completed_runs} ${data.completed_runs === 1 ? 'corrida completa' : 'corridas completas'} con historial. La comparación aparece después de la próxima sincronización completa.`} />
      : <ul className="netskope-event-list">{CHANGE_ROWS.map(({ kind, label }) => {
        const count = data.counts[kind];
        if (kind === 'removed') return <li key={kind}>
          <details className="netskope-change-details">
            <summary className="netskope-event-row is-pair"><span>{label}</span><strong>{formatNumber(count)}</strong></summary>
            {data.samples.removed.length ? <ul className="netskope-change-samples">{data.samples.removed.map((sample) => <li key={sample.device_id}>{sample.hostname || sample.device_id}{sample.before_value ? ` · ${sample.before_value}` : ''}</li>)}</ul> : <p className="database-caption">Ninguno.</p>}
            {count > data.samples.removed.length ? <p className="database-caption">Mostrando {data.samples.removed.length} de {formatNumber(count)}.</p> : null}
          </details>
        </li>;
        return <li key={kind}><button type="button" className="netskope-event-row is-pair" disabled={!count} onClick={() => onDrill({ ...EMPTY_NETSKOPE_DEVICE_QUERY, change: kind })}><span>{label}</span><strong>{formatNumber(count)}</strong></button></li>;
      })}</ul>}
  </article>;
}


/* NSK-DUP-001. Exact-match groups inside the Netskope source only. A group
   is a prompt to review (reimage, reassignment, shared account), never an
   automatic merge or retirement. */
export function NetskopeDuplicatesPanel({ enabled, refreshKey, onUnauthorized, onDrill }: PanelProps) {
  const panel = useNetskopePanel({ cacheKey: ['duplicates'], enabled, refreshKey, onUnauthorized, load: fetchNetskopeDuplicates });
  const data = panel.data;
  const title = 'Posibles duplicados — revisar';
  const section = (kind: 'hostname' | 'username', heading: string, otherLabel: string) => {
    const group = data![kind];
    const visibleGroups = group.top.slice(0, 5);
    const omittedDevices = Math.max(0, group.devices - visibleGroups.reduce((total, item) => total + item.devices, 0));
    return <section aria-labelledby={`netskope-dup-${kind}`}>
      <h4 id={`netskope-dup-${kind}`}>{heading}</h4>
      <button type="button" className="netskope-event-row is-pair" disabled={!group.groups} onClick={() => onDrill({ ...EMPTY_NETSKOPE_DEVICE_QUERY, duplicate: kind })}>
        <span>{formatNumber(group.groups)} {kind === 'hostname' ? 'hostnames' : 'usuarios'} · {formatNumber(group.devices)} dispositivos</span><strong>Ver</strong>
      </button>
      <ul className="netskope-event-list">{visibleGroups.map((item) => <li key={item.key}>
        <button type="button" className="netskope-event-row is-pair" onClick={() => onDrill(drillFilter(kind, item.key))} title={`${item.distinct_other} ${otherLabel} distintos`}>
          <span>{item.key}</span><strong>{formatNumber(item.devices)}</strong>
        </button>
      </li>)}</ul>
      <p className="database-caption">Mostrando {visibleGroups.length} de {group.groups} grupos{group.groups > visibleGroups.length ? ` · ${formatNumber(omittedDevices)} dispositivos en los grupos no mostrados` : ''}.</p>
    </section>;
  };
  return <article className="netskope-ops-panel" aria-labelledby="netskope-duplicates-title">
    <header className="netskope-ops-heading">
      <div className="netskope-ops-title"><h3 id="netskope-duplicates-title"><Copy size={15} aria-hidden="true" /> {title}</h3><HelpHint label="Posibles duplicados — revisar"><p>Hipótesis de revisión: una coincidencia exacta suele corresponder a reimagen, reasignación o cuenta compartida. No se fusiona ni se retira nada desde acá.</p></HelpHint></div>
    </header>
    {!data ? <PanelState loading={panel.loading} error={panel.error} errorInfo={panel.errorInfo} onRetry={() => void panel.reload()} title={title} /> : <div className="netskope-duplicates-grid">
      {section('hostname', 'Mismo hostname, varios device_id', 'usuarios')}
      {section('username', 'Mismo usuario en varios dispositivos', 'hostnames')}
    </div>}
  </article>;
}
