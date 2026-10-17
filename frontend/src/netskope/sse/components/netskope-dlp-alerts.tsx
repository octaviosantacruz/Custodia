import { useState } from 'react';
import { ChevronRight, FileLock2, TriangleAlert } from 'lucide-react';
import { HelpHint } from '../../../cross/components/help-hint';
import { DateTime } from '../../../cross/components/date-time';
import { ErrorDetailsButton } from '../../../cross/components/error-details';
import { StateBlock } from '../../../cross/components/state-block';
import { formatNumber, relativeTime } from '../../../cross/lib/format';
import { NETSKOPE_DLP_DRILL_SIZE, NETSKOPE_DLP_WINDOW_DAYS, netskopeDlpFreshness, netskopeDlpTrend } from '../lib/netskope-dlp';
import { useNetskopeDlp, useNetskopeDlpPolicyIncidents } from '../hooks/use-netskope-dlp';
import type { NetskopeDlpPolicyRow, NetskopeMetricBucket } from '../types/netskope';
import './netskope-dlp-alerts.css';

type Props = {
  refreshKey?: number;
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
};

function Mix({ buckets, label }: { buckets: NetskopeMetricBucket[]; label: string }) {
  if (!buckets.length) return <span className="netskope-dlp-muted">—</span>;
  return <span className="netskope-dlp-mix" aria-label={label}>
    {buckets.map((bucket) => <span key={bucket.key} className="netskope-dlp-mix-item" title={`${bucket.key}: ${formatNumber(bucket.count)}`}>
      {bucket.key} <strong>{formatNumber(bucket.count)}</strong>
    </span>)}
  </span>;
}

function PolicyIncidents({ policy, refreshKey }: { policy: string; refreshKey?: number }) {
  const incidents = useNetskopeDlpPolicyIncidents(policy, refreshKey);
  if (incidents.loading) return <StateBlock variant="loading" compact title="Cargando incidentes…" />;
  if (incidents.error) return <StateBlock variant="error" compact title="No se pudieron cargar los incidentes" hint={incidents.error}
    action={<button type="button" className="button subtle" onClick={incidents.retry}>Reintentar</button>} />;
  if (!incidents.rows.length) return <StateBlock variant="empty" compact title="Sin incidentes en la ventana" />;
  return <div className="netskope-dlp-incidents">
    <table className="compact-table" aria-label={`Incidentes recientes de ${policy}`}>
      <thead><tr><th>Incidente</th><th>Fecha</th><th>Estado</th><th>Severidad</th><th>Acción</th></tr></thead>
      <tbody>
        {incidents.rows.map((row) => <tr key={row.incident_id}>
          <td><code title={`Incidente ${row.incident_id}`}>{row.incident_id}</code></td>
          <td><DateTime value={row.event_timestamp} /></td>
          <td>{row.status || '—'}</td>
          <td>{row.severity || '—'}</td>
          <td>{row.action || '—'}</td>
        </tr>)}
      </tbody>
    </table>
    {incidents.total > incidents.rows.length ? <p className="database-caption">Los {NETSKOPE_DLP_DRILL_SIZE} más recientes de {formatNumber(incidents.total)}.</p> : null}
  </div>;
}

function PolicyRow({ row, open, onToggle, refreshKey }: { row: NetskopeDlpPolicyRow; open: boolean; onToggle: () => void; refreshKey?: number }) {
  const trend = netskopeDlpTrend(row.last_7d, row.previous_7d);
  return <>
    <tr className={open ? 'netskope-dlp-policy-open' : undefined}>
      <td>
        <button type="button" className="netskope-dlp-policy-toggle" aria-expanded={open} onClick={onToggle} title={row.policy}>
          <ChevronRight size={14} aria-hidden="true" className="netskope-dlp-chevron" />
          <span>{row.policy}</span>
        </button>
      </td>
      <td className="netskope-dlp-number">{formatNumber(row.alert_count)}</td>
      <td><span className={`netskope-dlp-trend ${trend.direction}`} title={`Últimos 7 días: ${formatNumber(row.last_7d)} · 7 días anteriores: ${formatNumber(row.previous_7d)}`}>
        <strong>{formatNumber(row.last_7d)}</strong> <small>{trend.label}</small>
      </span></td>
      <td><Mix buckets={row.by_severity} label="Severidad" /></td>
      <td><Mix buckets={row.by_action} label="Acción" /></td>
      <td><span title={row.latest_event_at}>{relativeTime(row.latest_event_at)}</span></td>
    </tr>
    {open ? <tr className="netskope-dlp-drill"><td colSpan={6}><PolicyIncidents policy={row.policy} refreshKey={refreshKey} /></td></tr> : null}
  </>;
}

/** Alertas DLP by policy: which policies fire, how often and how it moves. What each policy covers needs its rules (NSK-POLICY-003). */
export function NetskopeDlpWorkspace({ refreshKey, authChecked, authenticated, onUnauthorized, onError, onNotice }: Props) {
  const dlp = useNetskopeDlp({ authChecked, authenticated, refreshKey, onUnauthorized, onError });
  const [openPolicy, setOpenPolicy] = useState<string | null>(null);
  const data = dlp.policies;

  if (dlp.loading && !data) {
    return <section className="netskope-dlp"><StateBlock variant="loading" title="Cargando políticas DLP…" hint={`Alertas de los últimos ${NETSKOPE_DLP_WINDOW_DAYS} días agrupadas por política.`} /></section>;
  }
  if (!data) {
    return <section className="netskope-dlp"><StateBlock
      variant="error"
      title="No se pudieron cargar las políticas DLP"
      hint={dlp.error}
      action={<><button type="button" className="button subtle" onClick={() => void dlp.reload()}>Reintentar</button>{dlp.errorInfo ? <ErrorDetailsButton details={dlp.errorInfo} /> : null}</>}
    /></section>;
  }

  const freshness = netskopeDlpFreshness(data);
  const total = data.policies.reduce((sum, row) => sum + row.alert_count, 0);
  return <section className="netskope-dlp" aria-label="Alertas DLP por política">
    <header className="netskope-dlp-header">
      <div>
        <p className="eyebrow">ALERTAS DLP</p>
        <h2>Políticas que disparan alertas</h2>
        <span className="database-caption">Últimos {data.window_days} días · {formatNumber(data.total_policies)} {data.total_policies === 1 ? 'política' : 'políticas'} · {formatNumber(total)} alertas <HelpHint label="Qué muestra"><p>Cada fila es el nombre de política que Netskope registra en el incidente. Qué cubre cada política (a quién aplica, qué destino, qué acción) llegará cuando Netskope habilite la lectura de sus reglas.</p></HelpHint></span>
      </div>
      {onNotice ? <button type="button" className="button subtle" disabled={dlp.refreshing} onClick={() => void dlp.reload()}>{dlp.refreshing ? 'Actualizando…' : 'Actualizar'}</button> : null}
    </header>

    {!data.configured && !data.captured_at ? <StateBlock
      variant="empty"
      title="Captura de alertas DLP no configurada"
      hint="El contrato de incidentes DLP no está habilitado en este ambiente; la pantalla no presenta la ausencia como cero."
    /> : <>
      {freshness.tone !== 'ok' ? <p className="netskope-dlp-alert" role="status"><TriangleAlert size={14} aria-hidden="true" /> <strong>{freshness.label}.</strong> {freshness.detail}</p> : null}
      <section className="list-panel database-surface" aria-labelledby="netskope-dlp-policies-title">
        <div className="netskope-dlp-table-heading">
          <div className="section-title"><h3 id="netskope-dlp-policies-title">Políticas</h3></div>
          <span className="database-toolbar-count">{data.captured_at ? <>Capturado <DateTime value={data.captured_at} /></> : 'Sin captura'}</span>
        </div>
        <div className="compact-table-wrap"><table className="compact-table netskope-dlp-table">
          <thead><tr><th>Política</th><th>Alertas · {data.window_days} días</th><th>Últimos 7 días</th><th>Severidad</th><th>Acción</th><th>Última</th></tr></thead>
          <tbody>
            {!data.policies.length && <tr><td colSpan={6}><StateBlock variant="empty" title={`Sin alertas con política en los últimos ${NETSKOPE_DLP_WINDOW_DAYS} días`} hint="La captura está configurada y sin alertas en la ventana." /></td></tr>}
            {data.policies.map((row) => <PolicyRow
              key={row.policy}
              row={row}
              open={openPolicy === row.policy}
              onToggle={() => setOpenPolicy(openPolicy === row.policy ? null : row.policy)}
              refreshKey={refreshKey}
            />)}
          </tbody>
        </table></div>
        {data.unnamed_alerts ? <p className="database-caption netskope-dlp-unnamed">{formatNumber(data.unnamed_alerts)} {data.unnamed_alerts === 1 ? 'alerta sin nombre de política no aparece' : 'alertas sin nombre de política no aparecen'} en la tabla.</p> : null}
      </section>
      <p className="database-caption netskope-boundary-note"><FileLock2 size={14} aria-hidden="true" /> Custodia no guarda archivo, contenido, hash, URL, IP ni el usuario del evento.</p>
    </>}
  </section>;
}
