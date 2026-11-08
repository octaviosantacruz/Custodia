import { AlertOctagon, AlertTriangle, ChevronRight, CircleAlert, Info } from 'lucide-react';
import { DateTime } from '../../../cross/components/date-time';
import { StateBlock } from '../../../cross/components/state-block';
import { StatusBadge } from '../../../cross/components/semantic';
import { BarCell } from '../../../cross/components/bar-cell';
import { HelpHint } from '../../../cross/components/help-hint';
import { formatNumber, relativeTime } from '../../../cross/lib/format';
import type { useCyberarkRisk } from '../hooks/use-cyberark-risk';
import type { CyberarkRiskOverview } from '../lib/cyberark-risk-api';
import { cyberarkEntityLabel, cyberarkRiskName, cyberarkSeverityLabel } from '../lib/cyberark-risk-labels';
import { cyberarkSeverityCountsLabel } from '../lib/cyberark-risk-presentation';
import { entitySummaries, latestProgress, severityTotals, topRiskTypes } from '../lib/cyberark-risk-overview';
import { CyberarkRiskTrend } from './cyberark-risk-trend';
import { cyberarkSeverityTone } from './cyberark-risk-panel';
import './cyberark-risk-overview.css';

const SEVERITY_ICONS = { critical: AlertOctagon, high: AlertTriangle, medium: CircleAlert, low: Info } as const;
const displayCount = (value: number | null) => value === null ? 'Sin dato' : formatNumber(value);
const percent = (value: number) => `${Math.round(value * 100)}%`;

function entityPlural(entityType: string): string {
  const normalized = entityType.trim().toLowerCase();
  if (normalized === 'user') return 'Usuarios';
  if (normalized === 'webapp') return 'Aplicaciones web';
  return cyberarkEntityLabel(entityType);
}

/** Summary-first reading of CyberArk Risk Management: totals, trend and the
 *  risk types to review first. Read-only; every value is CyberArk's own. */
export function CyberarkRiskOverviewPanel({ controller, onShowAllTypes }: { controller: ReturnType<typeof useCyberarkRisk>; onShowAllTypes: () => void }) {
  const overview = controller.overview.data;
  if (controller.overview.isLoading) return <StateBlock variant="loading" title="Consultando resumen de CyberArk…" />;
  if (controller.overview.error) return <StateBlock variant="error" title="No se pudo cargar el resumen de CyberArk" hint={controller.overview.error instanceof Error ? controller.overview.error.message : 'La consulta no pudo completarse.'} action={<button type="button" className="button subtle" onClick={() => void controller.overview.refetch()}>Reintentar catálogo CyberArk</button>} />;
  if (!overview) return <StateBlock compact variant="empty" title="CyberArk no devolvió catálogo y progreso" />;

  const severities = severityTotals(overview);
  const entities = entitySummaries(overview);
  const top = topRiskTypes(overview.risk_types);
  const maxTop = Math.max(0, ...top.map((item) => item.open_findings ?? 0));
  const points = overview.progress.points;
  const snapshot = latestProgress(overview);

  return <div className="risk-overview">
    <section className="risk-hero" aria-label="Resumen de riesgo CyberArk">
      <div className="risk-hero-totals">
        <h3 className="risk-hero-title"><span>Hallazgos informados</span><strong>{cyberarkSeverityCountsLabel(overview.summary.total_findings_by_severity)}</strong></h3>
        {severities.length
          ? <ul className="risk-severity-chips" aria-label="Hallazgos por severidad">{severities.map(({ severity, count }) => {
              const Icon = SEVERITY_ICONS[severity.toLowerCase() as keyof typeof SEVERITY_ICONS] ?? Info;
              return <li key={severity} className={`tone-${cyberarkSeverityTone(severity)}`}><Icon size={15} aria-hidden="true" /><strong>{formatNumber(count)}</strong> {cyberarkSeverityLabel(severity).label}</li>;
            })}</ul>
          : <p className="risk-muted">CyberArk no informó conteos por severidad.</p>}
        <div className="risk-entity-cards">
          {entities.length ? entities.map((entity) => <div key={entity.entityType} className="risk-entity-card">
            <span className="risk-entity-name">{entityPlural(entity.entityType)}</span>
            <span className="risk-entity-total"><strong>{formatNumber(entity.total)}</strong> hallazgos</span>
            <span className="risk-entity-bar" role="img" aria-label={`Críticos: ${entity.criticalShare === null ? 'sin dato' : percent(entity.criticalShare)}`}><i style={{ width: `${entity.criticalShare === null ? 0 : Math.max(entity.critical ? 2 : 0, entity.criticalShare * 100)}%` }} /></span>
            <small>Crítica · {entity.criticalShare === null ? 'Sin dato' : `${percent(entity.criticalShare)} (${formatNumber(entity.critical)})`}</small>
          </div>) : <p className="risk-muted">Sin tipos de entidad informados.</p>}
        </div>
      </div>

      <div className="risk-hero-trend">
        <div className="risk-hero-heading">
          <h3 className="heading-with-help">Evolución de la incorporación <HelpHint label="Evolución de la incorporación"><p>Serie Secure Standing Privilege de CyberArk: cuentas descubiertas e incorporadas por fecha. No es la evolución de los hallazgos; CyberArk no expone esa serie. Un punto sin dato se muestra como hueco, no como cero.</p></HelpHint></h3>
          <span className="risk-muted">{points.length ? `${formatNumber(points.length)} puntos informados` : ''}</span>
        </div>
        {points.length
          ? <CyberarkRiskTrend ariaLabel="Cuentas descubiertas e incorporadas por fecha" dates={points.map((point) => point.date_at)} series={[
              { key: 'discovered', label: 'Descubiertas', tone: 'secondary', values: points.map((point) => point.total_discovered) },
              { key: 'onboarded', label: 'Incorporadas', tone: 'primary', values: points.map((point) => point.total_onboarded) },
            ]} />
          : <StateBlock compact variant="empty" title="Sin evolución informada" />}
        {points.length ? <details className="risk-trend-values"><summary>Ver valores</summary><div className="compact-table-wrap"><table className="compact-table"><thead><tr><th>Fecha</th><th>Descubiertas</th><th>Incorporadas</th></tr></thead><tbody>{[...points].reverse().map((point) => <tr key={point.date_at}><td><DateTime value={point.date_at} /></td><td>{displayCount(point.total_discovered)}</td><td>{displayCount(point.total_onboarded)}</td></tr>)}</tbody></table></div></details> : null}
      </div>

      <dl className="risk-hero-kpis" aria-label="Progreso actual de CyberArk">
        <div><dt>Incorporadas</dt><dd>{displayCount(overview.progress.total_onboarded_current)}<small>Progreso actual</small></dd></div>
        <div><dt>Desde discovery</dt><dd>{displayCount(overview.progress.total_onboarded_through_discovery_current)}<small>Incorporadas por descubrimiento</small></dd></div>
        <div><dt>Incorporadas / descubiertas</dt><dd>{snapshot.share === null ? 'Sin dato' : percent(snapshot.share)}<small>{snapshot.dateAt ? <>Último punto · <DateTime value={snapshot.dateAt} /></> : 'Sin puntos informados'}</small></dd></div>
      </dl>
    </section>

    <section className="list-panel database-surface risk-top-types" aria-labelledby="risk-top-types-title">
      <div className="risk-top-types-head">
        <h3 id="risk-top-types-title">Top {formatNumber(top.length)} tipos de riesgo</h3>
        <span className="risk-muted">Fuente: CyberArk · Risk Management · consultado {relativeTime(overview.fetched_at)}</span>
        <button type="button" className="risk-show-all" onClick={onShowAllTypes}>Ver todos ({formatNumber(overview.risk_types.length)}) <ChevronRight size={14} aria-hidden="true" /></button>
      </div>
      {top.length ? <div className="compact-table-wrap"><table className="compact-table risk-top-table"><thead><tr><th>Tipo de riesgo</th><th>Severidad</th><th>Entidad</th><th>Hallazgos abiertos</th><th>Última actualización</th></tr></thead><tbody>
        {top.map((item) => <tr key={item.risk_type_id}>
          <td><span className="cell-lead">{cyberarkRiskName(item.name || item.risk_type_id)}</span></td>
          <td><StatusBadge tone={cyberarkSeverityTone(item.severity)}>{cyberarkSeverityLabel(item.severity).label}</StatusBadge></td>
          <td>{cyberarkEntityLabel(item.entity_type)}</td>
          <td><BarCell label={displayCount(item.open_findings)} share={item.open_findings !== null && maxTop > 0 ? item.open_findings / maxTop : 0} muted={item.open_findings === null} /></td>
          <td>{item.updated_at ? <DateTime value={item.updated_at} /> : <span className="muted">Sin dato</span>}</td>
        </tr>)}
      </tbody></table></div> : <StateBlock compact variant="empty" title="CyberArk no informó tipos de riesgo con hallazgos abiertos" />}
    </section>
  </div>;
}

/** One-line frame above the findings list: totals by entity and severity. */
export function CyberarkRiskSummaryStrip({ overview }: { overview: CyberarkRiskOverview }) {
  const severities = severityTotals(overview);
  const entities = entitySummaries(overview);
  const entityTotal = entities.reduce((sum, entity) => sum + entity.total, 0);
  return <section className="risk-strip" aria-label="Totales de hallazgos CyberArk">
    <div className="risk-strip-total"><span>Hallazgos informados</span><strong>{cyberarkSeverityCountsLabel(overview.summary.total_findings_by_severity)}</strong></div>
    {entities.length ? <div className="risk-strip-entities">{entities.map((entity) => <div key={entity.entityType}>
      <span>{entityPlural(entity.entityType)} <strong>{formatNumber(entity.total)}</strong></span>
      <i aria-hidden="true"><b style={{ width: `${entityTotal ? (entity.total / entityTotal) * 100 : 0}%` }} /></i>
    </div>)}</div> : null}
    {severities.length ? <ul className="risk-severity-chips" aria-label="Hallazgos por severidad">{severities.map(({ severity, count }) => {
      const Icon = SEVERITY_ICONS[severity.toLowerCase() as keyof typeof SEVERITY_ICONS] ?? Info;
      return <li key={severity} className={`tone-${cyberarkSeverityTone(severity)}`}><Icon size={15} aria-hidden="true" /><strong>{formatNumber(count)}</strong> {cyberarkSeverityLabel(severity).label}</li>;
    })}</ul> : <span className="risk-muted">Sin conteos por severidad</span>}
  </section>;
}
