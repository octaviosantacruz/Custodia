import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { DateTime } from '../../../cross/components/date-time';
import { HelpHint } from '../../../cross/components/help-hint';
import { StateBlock } from '../../../cross/components/state-block';
import { StatusBadge } from '../../../cross/components/semantic';
import { ApiError } from '../../../cross/lib/api';
import { epochSecondsToIso } from '../../../cross/lib/format';
import { fetchNetskopeExperienceDetail, fetchNetskopeUserDevices, fetchNetskopeExperienceScore } from '../lib/netskope-api';
import { presenceStatusLabel } from '../lib/netskope-presence';
import { mergeUserDevices, sortUserDeviceRows, type UserDeviceRow } from '../lib/netskope-user-devices';
import { USER_PRESENCE_LABELS, userDevicePresence, userPresenceTone, userPresenceVerdict } from '../lib/netskope-user-presence';
import { formatScore, weakestLabel, PERFORMANCE_EXPLANATION, PERFORMANCE_SCALE } from '../lib/netskope-user-score';
import type { NetskopeExperienceScore } from '../types/netskope';
import './netskope-user-devices.css';

type Props = { userId: number; refreshKey?: number; onUnauthorized?: () => void };

const empty = <span className="nsk-user-devices-empty">Sin dato</span>;

/** The selected user's devices in one table: location and client config (inventory) next to the ADEM scores. */
export function NetskopeUserDevices({ userId, refreshKey = 0, onUnauthorized }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const inventory = useQuery({
    queryKey: ['netskope', 'experience', 'user-presence', userId, refreshKey],
    queryFn: ({ signal }) => fetchNetskopeUserDevices(userId, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const score = useQuery({
    queryKey: ['netskope', 'experience', 'user-score', userId, refreshKey],
    queryFn: ({ signal }) => fetchNetskopeExperienceScore(userId, 24, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if ([inventory.error, score.error].some((error) => error instanceof ApiError && error.status === 401)) onUnauthorized?.();
  }, [inventory.error, score.error, onUnauthorized]);

  if (inventory.isPending) return <StateBlock compact variant="loading" title="Leyendo equipos del usuario…" />;
  if (inventory.isError) return <StateBlock compact variant="error" title="No se pudieron leer los equipos del usuario" action={<button type="button" className="button subtle" onClick={() => void inventory.refetch()}>Reintentar</button>} />;
  const presence = inventory.data.rows.map(userDevicePresence);
  const verdict = userPresenceVerdict(presence);
  const adem = score.data;
  const rows = sortUserDeviceRows(mergeUserDevices(presence, adem?.devices ?? []));
  const weak = weakestLabel(adem?.weakest ?? null);
  return <section className="nsk-user-devices" aria-label="Equipos del usuario">
    <div className="nsk-user-devices-head">
      <h3>Equipos</h3>
      <StatusBadge tone={userPresenceTone(verdict)}>{USER_PRESENCE_LABELS[verdict]}</StatusBadge>
      {adem ? <span className="nsk-user-devices-score" aria-label={`Rendimiento digital ${formatScore(adem.score)} de 100`}>Rendimiento digital <strong>{formatScore(adem.score)} / 100</strong></span> : null}
      {weak ? <StatusBadge tone="warning">Componente con menor puntaje: {weak}</StatusBadge> : null}
      {score.isError ? <StatusBadge tone="neutral">Rendimiento no disponible</StatusBadge> : null}
      <HelpHint label="Equipos"><p>Ubicación y client config salen del inventario; los puntajes y el POP, de ADEM (últimas 24 h). Se unen solo cuando el nombre del equipo es exactamente el mismo y único. Si no, cada dato queda en su fila como Sin dato.</p></HelpHint>
    </div>
    <p className="nsk-user-devices-note">{PERFORMANCE_EXPLANATION} {PERFORMANCE_SCALE} El componente con menor puntaje orienta la revisión; no confirma una causa.</p>
    {adem ? <p className="nsk-user-devices-note">Período: <DateTime value={epochSecondsToIso(adem.window_start)} /> — <DateTime value={epochSecondsToIso(adem.window_end)} /> · Consulta: <DateTime value={new Date(score.dataUpdatedAt).toISOString()} />.</p> : null}
    {rows.length ? <div className="compact-table-wrap"><table className="compact-table">
      <thead><tr>
        <th scope="col"><span className="sr-only">Detalle</span></th><th scope="col">Equipo</th><th scope="col">Sistema</th><th scope="col">Ubicación</th><th scope="col">Client config</th>
        <th scope="col">Rendimiento general</th><th scope="col">Equipo</th><th scope="col">Red</th><th scope="col">Aplicaciones</th><th scope="col">Última señal</th>
      </tr></thead>
      <tbody>{rows.map((row) => <DeviceRow key={row.key} row={row} userId={userId} score={adem} expanded={open === row.key} onToggle={() => setOpen(open === row.key ? null : row.key)} />)}</tbody>
    </table></div> : <p className="nsk-user-devices-empty">Sin equipos para este usuario.</p>}
    {inventory.data.total > inventory.data.rows.length ? <p className="nsk-user-devices-note">Inventario: {inventory.data.rows.length} de {inventory.data.total} equipos.</p> : null}
    {adem && adem.devices_total > adem.devices.length ? <p className="nsk-user-devices-note">ADEM: {adem.devices.length} de {adem.devices_total} equipos.</p> : null}
  </section>;
}

function DeviceRow({ row, userId, score, expanded, onToggle }: { row: UserDeviceRow; userId: number; score: NetskopeExperienceScore | undefined; expanded: boolean; onToggle: () => void }) {
  const { presence, adem } = row;
  const status = presence?.status ?? '';
  return <Fragment>
    <tr className={presence && !presence.recent ? 'is-stale' : undefined}>
      <td>{adem ? <button type="button" className="nsk-user-devices-toggle" aria-expanded={expanded} aria-label={`Detalle de ${row.name}`} onClick={onToggle}><ChevronRight size={14} aria-hidden /></button> : null}</td>
      <td><span className="cell-lead">{row.name}</span>{row.linked ? <small className="nsk-user-devices-link" title="Inventario y ADEM unidos por nombre exacto">nombre exacto</small> : null}</td>
      <td>{row.os || empty}</td>
      <td>{status ? <StatusBadge tone={status === 'on-prem' ? 'success' : status === 'off-prem' ? 'info' : 'neutral'}>{presenceStatusLabel(status)}</StatusBadge> : empty}</td>
      <td>{presence?.config || empty}</td>
      {[adem?.exp_score, adem?.device_score, adem?.network_score, adem?.app_score].map((value, index) => <td key={index} className="nsk-user-devices-number">{adem ? formatScore(value) : empty}</td>)}
      <td>{presence?.lastSignalAt ? <DateTime value={presence.lastSignalAt} /> : empty}</td>
    </tr>
    {expanded && adem && score ? <tr className="nsk-user-devices-detail"><td colSpan={10}><DevicePop userId={userId} deviceId={adem.device_id} score={score} /></td></tr> : null}
  </Fragment>;
}

function DevicePop({ userId, deviceId, score }: { userId: number; deviceId: string; score: NetskopeExperienceScore }) {
  const detail = useQuery({
    queryKey: ['netskope', 'experience', 'device-pop', userId, deviceId, score.window_start, score.window_end],
    queryFn: ({ signal }) => fetchNetskopeExperienceDetail(userId, deviceId, score, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  if (detail.isPending) return <span className="nsk-user-devices-empty">Leyendo POP…</span>;
  if (detail.isError) return <span className="nsk-user-devices-empty">No se pudo leer el POP</span>;
  const activity = epochSecondsToIso(detail.data.last_activity);
  return <span className="nsk-user-devices-pop">POP informado por ADEM: <strong>{detail.data.pop || 'Sin dato'}</strong>
    {activity ? <> · última actividad <DateTime value={activity} /></> : null}</span>;
}
