import { DateTime } from './date-time';
import { formatNumber } from '../lib/format';
import {
  personCoverageDetailReason,
  personConnectionLink,
} from '../lib/person-coverage-presentation';
import type {
  PersonClientCoverageDetail,
  PersonCoverageSourceRun,
  PersonCoverageStatus,
  PersonToolSummary,
} from '../lib/chains-api';
import { StateBlock } from './state-block';
import { StatusBadge } from './semantic';

const STATUS_LABELS: Record<PersonCoverageStatus, string> = {
  covered: 'Cubierta',
  partial: 'Parcial',
  gap: 'Brecha',
  unknown: 'Desconocida',
  not_applicable: 'No aplica',
};

function freshnessLabel(freshness: string): string {
  return ({ fresh: 'Completa · vigente', stale: 'Desactualizada', incomplete: 'Última corrida incompleta', missing: 'Sin corrida completa vigente' } as Record<string, string>)[freshness]
    ?? 'Sin estado de frescura';
}

function CoverageSourceDetails({ sources, label }: {
  sources: Record<string, PersonCoverageSourceRun>;
  label: string;
}) {
  return <details className="person-client-coverage-disclosure">
    <summary>{label}</summary>
    <dl className="person-client-coverage-sources">
      {(['identity', 'netskope'] as const).map((source) => {
        const run = sources[source];
        const name = source === 'identity' ? 'Identity Administration' : 'Netskope';
        if (!run) return <div key={source}><dt>{name}</dt><dd>Metadata de corrida no disponible.</dd></div>;
        return <div key={source}>
          <dt>{name}</dt>
          <dd>{run.source_system} · {run.source_file}</dd>
          <dd>Estado: {run.status ?? 'no informado'} · {freshnessLabel(run.freshness)}</dd>
          {run.age_hours !== undefined && run.age_hours !== null ? <dd>Antigüedad informada: {formatNumber(run.age_hours)} h</dd> : null}
          <dd>Inicio: {run.started_at ? <DateTime value={run.started_at} /> : 'Sin fecha informada'}</dd>
          <dd>Corrida completa: {run.completed_at ? <DateTime value={run.completed_at} /> : 'Sin fecha informada'}</dd>
          <dd className="mono">ID de corrida: {run.run_id || 'No informado'}</dd>
        </div>;
      })}
    </dl>
  </details>;
}

export function PersonConnectionPanel({ identity, netskope, detail, selectedEmail, detailLoading, detailError, onRetryDetail }: {
  identity: PersonToolSummary | undefined;
  netskope: PersonToolSummary | undefined;
  detail: PersonClientCoverageDetail | null;
  selectedEmail: string;
  detailLoading: boolean;
  detailError: string | null;
  onRetryDetail: () => void;
}) {
  const link = personConnectionLink(identity, netskope);
  const currentDetail = detail?.email === selectedEmail ? detail : null;
  const individualReason = currentDetail ? personCoverageDetailReason(currentDetail) : null;
  return <div className="person-connection-evidence" role="group" aria-label="Relación Identity y Netskope de la persona">
    <StatusBadge tone={link.style === 'linked' ? 'success' : link.style === 'ambiguous' ? 'warning' : 'neutral'}>{link.label}</StatusBadge>
    <p>{link.explanation}</p>
    <div className="person-client-coverage-detail" role="group" aria-label="Detalle de cobertura de la persona seleccionada" aria-live="polite">
      {detailLoading ? <StateBlock variant="loading" title="Cargando detalle de cobertura…" /> : null}
      {detailError ? <StateBlock variant="error" title="No se pudo cargar el detalle" hint={detailError}
        action={<button type="button" className="button secondary" onClick={onRetryDetail}>Reintentar detalle</button>} /> : null}
      {!detailLoading && !detailError && currentDetail ? <>
        <h4>Cobertura del cliente Netskope</h4>
        <p><strong>{currentDetail.status === 'unknown' ? 'Por verificar' : STATUS_LABELS[currentDetail.status]}</strong></p>
        <p>{individualReason ?? currentDetail.explanation}</p>
        <p className="mono">{selectedEmail}</p>
        <p>Dispositivos recientes {formatNumber(currentDetail.devices_recent)} · no recientes / sin fecha {formatNumber(currentDetail.devices_not_recent)} · ambiguos {formatNumber(currentDetail.devices_ambiguous)} · total atribuible {formatNumber(currentDetail.devices_total)}.</p>
        <details className="person-client-coverage-disclosure">
          <summary>Evidencia técnica de la persona</summary>
          <p>{currentDetail.explanation}</p>
          <p>Registros Identity: {formatNumber(currentDetail.identity_records)} · usuarios Netskope: {formatNumber(currentDetail.netskope_users)}.</p>
          <CoverageSourceDetails sources={currentDetail.sources} label="Corridas usadas por el detalle" />
        </details>
      </> : null}
    </div>
  </div>;
}
