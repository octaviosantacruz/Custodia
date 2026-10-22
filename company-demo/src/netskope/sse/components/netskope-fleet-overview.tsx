import { BarCell } from '../../../cross/components/bar-cell';
import { CompactSelect } from '../../../cross/components/compact-select';
import { DateTime } from '../../../cross/components/date-time';
import { HelpHint } from '../../../cross/components/help-hint';
import { StateBlock } from '../../../cross/components/state-block';
import { formatNumber } from '../../../cross/lib/format';
import type { NetskopePanelState } from '../hooks/use-netskope-panel';
import { EMPTY_NETSKOPE_DEVICE_QUERY } from '../lib/netskope-device-filters';
import { FLEET_GROUP_OPTIONS, OFFICE_LOW_UCI_DRILL, STALE_DRILL, fleetColumn, fleetDrillQuery, fleetGroupKeyLabel, fleetGroupLabel, fleetPercent, fleetShare, type FleetColumn } from '../lib/netskope-fleet-groups';
import type { NetskopeClientEvents, NetskopeDeviceChanges, NetskopeDeviceQuery, NetskopeDeviceReviewSummary, NetskopeFleetCounts, NetskopeFleetGroupBy, NetskopeFleetGroups } from '../types/netskope';
import './netskope-fleet-overview.css';

const COLUMNS: ReadonlyArray<{ id: FleetColumn; label: string; empty: string }> = [
  { id: 'signal', label: 'Señal en 24 h', empty: 'Sin dato' },
  { id: 'client', label: 'Cliente al día', empty: 'Sin línea base' },
  { id: 'client_one', label: '1 golden atrás', empty: 'Sin línea base' },
  { id: 'client_two', label: '2+ golden atrás', empty: 'Sin línea base' },
  { id: 'os', label: 'SO en el mínimo', empty: 'Sin mínimo' },
  { id: 'office', label: 'En oficina', empty: 'Sin dato' },
  { id: 'uci', label: 'Con UCI bajo', empty: 'Sin dato' },
];

// Severity of the golden-release gap and of a low UCI; the other columns keep the accent.
const TONES: Partial<Record<FleetColumn, 'warning' | 'danger'>> = { client_one: 'warning', client_two: 'danger', uci: 'warning' };

type BandProps = {
  fleet: NetskopeFleetGroups | null | undefined;
  changes: NetskopeDeviceChanges | null | undefined;
  clientEvents: NetskopeClientEvents | null | undefined;
  diagnosis: NetskopeDeviceReviewSummary | null | undefined;
  onDrill: (query: NetskopeDeviceQuery) => void;
  /** Risk numbers open their row in Postura, where the action is; without it they open the inventory. */
  onOpenPosture?: (checks: string[]) => void;
  onOpenChanges: () => void;
};

/** NSK-FLEET-001: the horizontal band with the most critical numbers, visible above both tabs. */
export function NetskopeFleetBand({ fleet, changes, clientEvents, diagnosis, onDrill, onOpenPosture, onOpenChanges }: BandProps) {
  const summary = fleet?.summary;
  const changeCounts = changes?.available ? changes.counts : null;
  const stale = diagnosis ? diagnosis.candidates : undefined;
  const loading = 'Cargando…';
  return <div className="nsk-fleet-kpis" role="group" aria-label="Resumen de la flota">
    <button type="button" className="nsk-fleet-kpi" disabled={!summary} onClick={() => onDrill(EMPTY_NETSKOPE_DEVICE_QUERY)}>
      <span>Equipos activos</span><strong>{summary ? formatNumber(summary.devices) : loading}</strong><small>con evento en 7 días</small>
    </button>
    <button type="button" className="nsk-fleet-kpi" disabled={!summary?.devices} onClick={() => onDrill({ ...EMPTY_NETSKOPE_DEVICE_QUERY, eventAge: 'lt_24h' })}>
      <span>Señal en 24 h</span><strong>{summary ? fleetPercent(fleetShare(summary.signal_24h, summary.devices)) : loading}</strong><small>{summary ? `${formatNumber(summary.signal_24h)} equipos` : ''}</small>
    </button>
    <button type="button" className="nsk-fleet-kpi" disabled={!fleet?.client_baseline || !summary?.client_evaluated} onClick={() => onDrill({ ...EMPTY_NETSKOPE_DEVICE_QUERY, clientCompliance: 'current' })}>
      <span>Cliente al día</span>
      <strong>{!fleet ? loading : fleet.client_baseline ? fleetPercent(fleetShare(fleet.summary.client_current, fleet.summary.client_evaluated)) : 'Sin línea base'}</strong>
      <small>{fleet?.client_baseline ? `${formatNumber(fleet.summary.client_current)} de ${formatNumber(fleet.summary.client_evaluated)} reconocidos` : fleet ? 'Configurala para evaluar' : ''}</small>
    </button>
    <button type="button" className={`nsk-fleet-kpi${clientEvents?.coverage_risk_total ? ' is-attention' : ''}`} disabled={!clientEvents?.coverage_risk_total} onClick={() => onOpenPosture ? onOpenPosture(['client_protection_off']) : onDrill({ ...EMPTY_NETSKOPE_DEVICE_QUERY, coverageRisk: '1' })}>
      <span>Desinstalación o deshabilitación</span><strong>{clientEvents ? formatNumber(clientEvents.coverage_risk_total) : loading}</strong><small>último evento informado</small>
    </button>
    <button type="button" className={`nsk-fleet-kpi${stale ? ' is-attention' : ''}`} disabled={!stale} onClick={() => onOpenPosture ? onOpenPosture(['stale_undiagnosed']) : onDrill(STALE_DRILL)}>
      <span>Sin señal hace +30 días</span>
      <strong>{stale === undefined ? loading : formatNumber(stale)}</strong>
      <small>ver por qué</small>
    </button>
    <button type="button" className="nsk-fleet-kpi" disabled={!changeCounts} onClick={onOpenChanges}>
      <span>Desde la última sync</span>
      <strong>{changeCounts ? <>+{formatNumber(changeCounts.added)} <em>−{formatNumber(changeCounts.removed)}</em></> : changes ? 'Sin dato' : loading}</strong>
      <small>{changes?.latest_run ? <DateTime value={changes.latest_run.captured_at} /> : changes ? 'Hacen falta dos corridas completas' : ''}</small>
    </button>
  </div>;
}

type TableProps = {
  panel: NetskopePanelState<NetskopeFleetGroups>;
  groupBy: NetskopeFleetGroupBy;
  onGroupBy: (groupBy: NetskopeFleetGroupBy) => void;
  canAdmin: boolean;
  onDrill: (query: NetskopeDeviceQuery) => void;
  onEditBaseline: (kind: 'client' | 'os') => void;
};

/** NSK-FLEET-001: "¿Cómo está la flota?" — one grouped table; every cell opens its list. */
export function NetskopeFleetTable({ panel, groupBy, onGroupBy, canAdmin, onDrill, onEditBaseline }: TableProps) {
  const data = panel.data;
  const notEvaluated = (column: FleetColumn) => ((column === 'client' || column === 'client_one' || column === 'client_two') && !data?.client_baseline) || (column === 'os' && !data?.os_baseline);

  const cell = (counts: NetskopeFleetCounts, group: string, column: FleetColumn, label: string) => {
    const { count, total } = fleetColumn(counts, column);
    const share = fleetShare(count, total);
    const empty = COLUMNS.find((item) => item.id === column)!.empty;
    if (notEvaluated(column) || share === null) return <span className="nsk-fleet-empty">{notEvaluated(column) ? empty : 'Sin dato'}</span>;
    return <button type="button" className="nsk-fleet-cell" data-tone={TONES[column]} onClick={() => onDrill(fleetDrillQuery(groupBy, group, column))} aria-label={`${label}: ${formatNumber(count)} de ${formatNumber(total)}. Ver en Inventario`}>
      <BarCell label={fleetPercent(share)} share={share} />
    </button>;
  };

  return <section className="list-panel database-surface nsk-fleet" aria-labelledby="nsk-fleet-title">
    <header className="nsk-fleet-head">
      <div className="section-title"><h2 id="nsk-fleet-title">Cómo está la flota</h2><HelpHint label="Cómo está la flota"><p>Equipos activos con evento en los últimos 7 días, la misma población que abre Inventario. Cada porcentaje usa su propio denominador: cliente sobre versiones reconocidas, SO sobre los sistemas con mínimo configurado y oficina sobre los equipos que Netskope pudo clasificar. UCI bajo cruza al usuario del equipo con la última captura de UCI (solo se informan usuarios Bajo o Moderado); sin captura se lee Sin dato, nunca 0 %.</p></HelpHint></div>
      <div className="nsk-fleet-toolbar">
        <span className="nsk-fleet-label">Agrupar por</span>
        <CompactSelect ariaLabel="Agrupar la flota por" value={groupBy} options={[...FLEET_GROUP_OPTIONS]} onChange={(value) => onGroupBy(value as NetskopeFleetGroupBy)} />
        <button type="button" className="button subtle" disabled={!data?.summary.uci_evaluated} onClick={() => onDrill(OFFICE_LOW_UCI_DRILL)} title={data && !data.summary.uci_evaluated ? 'Sin captura de UCI' : undefined}>En oficina con UCI bajo{data?.summary.uci_evaluated ? ` (${formatNumber(data.summary.on_prem_uci_low)})` : ''}</button>
        {canAdmin ? <>
          <button type="button" className="button subtle" onClick={() => onEditBaseline('client')}>Línea base del cliente</button>
          <button type="button" className="button subtle" onClick={() => onEditBaseline('os')}>SO mínimo</button>
        </> : null}
      </div>
    </header>
    {!data
      ? panel.error
        ? <StateBlock compact variant="error" title="No se pudo leer la flota" action={<button type="button" className="button subtle" onClick={() => void panel.reload()}>Reintentar</button>} />
        : <StateBlock compact variant="loading" title="Leyendo la flota…" />
      : !data.groups.length
        ? <StateBlock compact variant="empty" title="Sin equipos activos con evento en 7 días" />
        : <>
          <div className="compact-table-wrap"><table className="compact-table nsk-fleet-table">
            <caption className="sr-only">Flota agrupada por {fleetGroupLabel(groupBy)}</caption>
            <thead><tr>
              <th scope="col">{fleetGroupLabel(groupBy)}</th>
              <th scope="col">Equipos</th>
              {COLUMNS.map((column) => <th scope="col" key={column.id}>{column.label}</th>)}
            </tr></thead>
            <tbody>{data.groups.map((group) => <tr key={group.key}>
              <th scope="row"><span className="cell-lead">{fleetGroupKeyLabel(groupBy, group.key)}</span></th>
              <td><button type="button" className="nsk-fleet-count" onClick={() => onDrill(fleetDrillQuery(groupBy, group.key))} aria-label={`${group.key}: ${formatNumber(group.devices)} equipos. Ver en Inventario`}>{formatNumber(group.devices)}</button></td>
              {COLUMNS.map((column) => <td key={column.id}>{cell(group, group.key, column.id, `${group.key}, ${column.label}`)}</td>)}
            </tr>)}</tbody>
          </table></div>
          {data.omitted_groups > 0 ? <p className="nsk-fleet-note">Otros {formatNumber(data.omitted_groups)} grupos: {formatNumber(data.omitted_devices)} equipos.</p> : null}
        </>}
  </section>;
}
