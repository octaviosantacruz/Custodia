import { useQuery } from '@tanstack/react-query';
import { DateTime } from '../../../cross/components/date-time';
import { StatusBadge } from '../../../cross/components/semantic';
import { ApiError } from '../../../cross/lib/api';
import { epochSecondsToIso, formatNumber, relativeTime } from '../../../cross/lib/format';
import { fetchNetskopeExperienceDetail, fetchNetskopeExperienceScore, fetchNetskopeUserAnomalies } from '../lib/netskope-api';
import { ANOMALY_SEVERITIES, ANOMALY_SEVERITY_LABELS, ANOMALY_SEVERITY_TONES, scenarioLabel } from '../lib/netskope-anomalies';
import { formatScore } from '../lib/netskope-user-score';
import type { NetskopeUserSelection } from './netskope-user-drawer';
import { companyFromIdentity } from '../lib/netskope-company';
import { DEVICE_EVIDENCE_LABELS, deviceMakeModelLabel } from '../lib/netskope-device-labels';
import type { NetskopeRow } from '../types/netskope';

function value(row: NetskopeRow, key: string): string {
  const current = row.attributes[key];
  return current === null || current === undefined || current === '' ? '' : String(current);
}

/** NSK-INV-002: the inline card under an inventory row. Three short groups -- the device, who uses it and when it
 * last reported -- with only what answers "whose is it and is it alive"; identifiers and snapshots stay out. */
const QUERY = { retry: false, staleTime: 60_000, refetchOnWindowFocus: false } as const;

/** Experience of this device and anomalies of its user, read live from Netskope when the card opens: the ADEM POP and score of
 * this device (linked by exact, unique name within the user's lists, ADR 006) and the user's UEBA anomalies. */
function RecentActivity({ userId, deviceObjectId, onOpenUser }: { userId: number; deviceObjectId: number; onOpenUser?: () => void }) {
  const score = useQuery({ queryKey: ['netskope', 'experience', 'user-score', userId, 0], queryFn: ({ signal }) => fetchNetskopeExperienceScore(userId, 24, signal), ...QUERY });
  const adem = score.data?.devices.find((device) => device.inventory_device_id === deviceObjectId) ?? null;
  const window = score.data ? { window_start: score.data.window_start, window_end: score.data.window_end, source: score.data.source } : null;
  const detail = useQuery({
    queryKey: ['netskope', 'experience', 'device-detail', userId, adem?.device_id, window?.window_start],
    enabled: Boolean(adem && window),
    queryFn: ({ signal }) => fetchNetskopeExperienceDetail(userId, adem!.device_id, window!, signal),
    ...QUERY,
  });
  const anomalies = useQuery({ queryKey: ['netskope', 'experience', 'user-anomalies', userId, 0], queryFn: ({ signal }) => fetchNetskopeUserAnomalies(userId, signal), ...QUERY });
  const anomaliesHidden = anomalies.error instanceof ApiError && anomalies.error.status === 403;
  const anomalyData = anomalies.data;
  const topScenario = anomalyData?.by_scenario[0];
  return <>
    <section aria-label="Rendimiento digital">
      <span className="netskope-device-detail-label">Rendimiento digital · 24 h</span>
      {score.isPending ? <p className="muted">Consultando ADEM…</p>
        : score.isError ? <p className="muted">ADEM no disponible</p>
        : !adem ? <p className="muted">ADEM no midió este equipo en 24 h</p>
        : <>
          <p><strong>{formatScore(adem.exp_score)} / 100</strong> <span className="muted">· equipo, red y apps (más es mejor)</span></p>
          <p title="Punto de presencia de Netskope que informa ADEM; no es la ubicación de la persona.">POP {detail.data?.pop || (detail.isPending ? '…' : 'sin dato')}</p>
          {detail.data?.last_activity ? <p className="muted">Medido <DateTime value={epochSecondsToIso(detail.data.last_activity)} /></p> : null}
        </>}
      {onOpenUser ? <button type="button" className="netskope-device-detail-link" onClick={onOpenUser}>Ver detalle en la ficha del usuario</button> : null}
    </section>
    {anomaliesHidden ? null : <section aria-label="Anomalías del usuario">
      <span className="netskope-device-detail-label">Anomalías del usuario · 30 días</span>
      {anomalies.isPending ? <p className="muted">Consultando anomalías…</p>
        : anomalies.isError || !anomalyData ? <p className="muted">Anomalías no disponibles</p>
        : anomalyData.total === 0 ? <p>Sin comportamientos inusuales</p>
        : <>
          <p className="netskope-device-detail-anomalies">{ANOMALY_SEVERITIES.filter((key) => anomalyData.by_severity[key] > 0).map((key) => <StatusBadge key={key} tone={ANOMALY_SEVERITY_TONES[key]}>{ANOMALY_SEVERITY_LABELS[key]} {formatNumber(anomalyData.by_severity[key])}</StatusBadge>)}</p>
          {topScenario ? <p>Más frecuente: {scenarioLabel(topScenario.scenario, topScenario.sub_scenario)}</p> : null}
          {anomalyData.recent[0]?.time ? <p className="muted">Última <DateTime value={anomalyData.recent[0].time} /> · en cualquiera de sus equipos</p> : null}
        </>}
      {onOpenUser ? <button type="button" className="netskope-device-detail-link" onClick={onOpenUser}>Ver anomalías en la ficha del usuario</button> : null}
    </section>}
  </>;
}

export function NetskopeDeviceDetail({ row, onOpenUser }: { row: NetskopeRow; onOpenUser?: (user: NetskopeUserSelection) => void }) {
  const evidence = row.device_evidence;
  const user = row.observed_user;
  const email = user?.email || value(row, 'username');
  const model = deviceMakeModelLabel(value(row, 'device_make'), value(row, 'device_model'));
  const os = `${value(row, 'os')} ${value(row, 'os_version')}`.trim();
  const classification = value(row, 'classification_status');
  return <div className="netskope-device-detail">
    <section aria-label="Equipo">
      <span className="netskope-device-detail-label">Equipo</span>
      <p><strong>{model || 'Modelo sin dato'}</strong></p>
      <p>{os || 'SO sin dato'} · cliente {value(row, 'client_version') || 'sin dato'}</p>
      {classification ? <p className="muted" title="Clasificación de postura informada por Netskope; no dice si el cliente está conectado.">Netskope: {classification}</p> : null}
    </section>
    <section aria-label="Usuario">
      <span className="netskope-device-detail-label">Usuario</span>
      <p><strong>{user?.display_name || value(row, 'username') || 'Sin usuario informado'}</strong></p>
      <p>{[companyFromIdentity(email, row.attributes.company), email].filter((item) => item && item !== 'Sin dato').join(' · ')}</p>
      {row.observed_user_status === 'ambiguous' ? <StatusBadge tone="warning">Coincidencia ambigua</StatusBadge>
        : row.observed_user_status !== 'matched' ? <p className="muted">No correlacionado con el inventario de usuarios</p> : null}
    </section>
    <section aria-label="Señal">
      <span className="netskope-device-detail-label">Señal</span>
      <p><strong>{evidence?.last_signal_at ? `Reportó ${relativeTime(evidence.last_signal_at)}` : 'Sin señal registrada'}</strong>{evidence?.last_seen_event ? ` · ${evidence.last_seen_event}` : ''}</p>
      <p>{DEVICE_EVIDENCE_LABELS[evidence?.state ?? 'unknown']}{evidence?.last_signal_at ? <> · <DateTime value={evidence.last_signal_at} /></> : null}</p>
      <p className="muted">En Custodia desde <DateTime value={row.first_seen_at} /></p>
    </section>
    {user?.object_id ? <RecentActivity userId={user.object_id} deviceObjectId={row.object_id} onOpenUser={onOpenUser ? () => onOpenUser({ userId: user.object_id!, email: user.email || email, name: user.display_name || email }) : undefined} />
      : <section aria-label="Rendimiento y anomalías"><span className="netskope-device-detail-label">Rendimiento y anomalías</span><p className="muted">Sin usuario correlacionado: no se consulta ADEM ni UEBA.</p></section>}
  </div>;
}
