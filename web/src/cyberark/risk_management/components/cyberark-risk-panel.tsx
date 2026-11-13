import { DateTime } from '../../../cross/components/date-time';
import { useRef, useState } from 'react';
import { Search, ShieldAlert, X } from 'lucide-react';
import type { useCyberarkRisk } from '../hooks/use-cyberark-risk';
import type { CyberarkRiskFinding, CyberarkRiskOverview } from '../lib/cyberark-risk-api';
import { dateTimeHint, formatDate, formatNumber } from '../../../cross/lib/format';
import { useDialogFocusTrap } from '../../../cross/hooks/use-dialog-focus-trap';
import { StateBlock } from '../../../cross/components/state-block';
import { StatusBadge } from '../../../cross/components/semantic';
import { BarCell } from '../../../cross/components/bar-cell';
import { HelpHint } from '../../../cross/components/help-hint';
import { SummaryStats } from '../../../cross/components/summary-stats';
import { CompactSelect } from '../../../cross/components/compact-select';
import { TablePagination } from '../../../cross/components/table-pagination';
import { severityRank } from '../lib/cyberark-risk-overview';

import { cyberarkEntityLabel, cyberarkRiskName, cyberarkRiskDescription, cyberarkSeverityLabel, cyberarkStatusLabel, cyberarkStatusTone } from '../lib/cyberark-risk-labels';
import { t } from '../../../cross/i18n/index.ts';

export const cyberarkSeverityTone = (severity: string | null): 'danger' | 'warning' | 'info' | 'neutral' => {
  const normalized = (severity || '').toLowerCase();
  if (normalized === 'critical' || normalized === 'high') return 'danger';
  if (normalized === 'medium') return 'warning';
  if (normalized === 'low') return 'info';
  return 'neutral';
};

const displayCount = (value: number | null) => value === null ? t('Sin dato') : formatNumber(value);

function OriginalRiskText({ name, description }: { name: string; description: string | null }) {
  if (cyberarkRiskName(name) === name && cyberarkRiskDescription(description) === description) return null;
  return <details className="posture-catalog-detail"><summary>{t('Texto original de CyberArk')}</summary><strong>{name}</strong>{description ? <p>{description}</p> : null}</details>;
}

function CyberarkFindingDrawer({ finding, entityNamesVisible, name, description, recommendations, catalogStatus, onClose }: {
  finding: CyberarkRiskFinding;
  entityNamesVisible: boolean;
  name: string;
  description: string | null;
  recommendations: Array<{ id: string; name: string | null; text: string | null }>;
  catalogStatus: 'ready' | 'pending' | 'unavailable';
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onClose, initialFocusRef: closeRef });
  const entityLabel = entityNamesVisible
    ? finding.entity_name || t('Sin nombre informado')
    : cyberarkEntityLabel(finding.entity_type);
  const entityContext = entityNamesVisible
    ? `${cyberarkEntityLabel(finding.entity_type)} · ${finding.entity_id}`
    : finding.entity_id;
  return <div ref={dialogRef} className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="cyberark-risk-drawer-title" tabIndex={-1}>
    <button className="drawer-backdrop" type="button" aria-label={t('Cerrar detalle de riesgo CyberArk')} onClick={onClose} />
    <aside className="detail-drawer posture-finding-drawer">
      <div className="detail-title"><div className="detail-icon"><ShieldAlert size={18} /></div><div className="detail-heading"><p className="eyebrow">CYBERARK RISK MANAGEMENT</p><h2 id="cyberark-risk-drawer-title">{cyberarkRiskName(name)}</h2><p>{finding.risk_type_id}</p></div><button ref={closeRef} className="icon-button drawer-close" type="button" aria-label="Cerrar" onClick={onClose}><X size={16} /></button></div>
      <section className="detail-section"><div className="posture-badge-row"><StatusBadge tone={cyberarkSeverityTone(finding.severity)}>{cyberarkSeverityLabel(finding.severity).label}</StatusBadge><StatusBadge tone={cyberarkStatusTone(finding.status)}>{cyberarkStatusLabel(finding.status).label}</StatusBadge></div>{description ? <p className="posture-explanation">{cyberarkRiskDescription(description)}</p> : null}<OriginalRiskText name={name} description={description} /><dl className="posture-facts"><div><dt>Entidad</dt><dd>{entityLabel}<small>{entityContext}</small>{entityNamesVisible ? null : <small className="posture-role-note">{t('Tu rol no incluye el nombre de la entidad')}</small>}</dd></div><div><dt>{t('Primera detección')}</dt><dd><DateTime value={finding.first_detected_at} /></dd></div><div><dt>{t('Última detección')}</dt><dd><DateTime value={finding.last_detected_at} /></dd></div></dl></section>
      <section className="detail-section"><h3>{t('Recomendaciones y remediaciones sugeridas')}</h3><p className="posture-explanation">{t('Información de sólo lectura calculada por CyberArk. Custodia no ejecuta ni pospone acciones remotas.')}</p>{catalogStatus !== 'ready' ? <p className="posture-explanation">{catalogStatus === 'pending' ? t('Consultando catálogo de recomendaciones…') : t('Catálogo de recomendaciones no disponible; no se pudo confirmar si hay opciones vinculables.')}</p> : recommendations.length ? <ul className="cyberark-risk-remediations">{recommendations.map((item) => <li key={item.id}><strong>{item.name || t('Remediación sugerida')}</strong>{item.text ? <p>{item.text}</p> : null}</li>)}</ul> : <p className="posture-explanation">{t('CyberArk no devolvió una remediación de catálogo vinculable para este tipo.')}</p>}</section>
    </aside>
  </div>;
}

export function CyberarkRiskDetail({ finding, entityNamesVisible, overview, catalogStatus, onClose }: { finding: CyberarkRiskFinding; entityNamesVisible: boolean; overview?: CyberarkRiskOverview; catalogStatus: 'ready' | 'pending' | 'unavailable'; onClose: () => void }) {
  const riskType = overview?.risk_types.find((item) => item.risk_type_id === finding.risk_type_id);
  const recommendations = riskType
    ? (overview?.remediations || []).filter((item) => item.remediation_type && riskType.recommendation_types.includes(item.remediation_type)).map((item) => ({ id: item.remediation_id, name: item.name, text: item.text }))
    : [];
  return <CyberarkFindingDrawer finding={finding} entityNamesVisible={entityNamesVisible} name={riskType?.name || finding.risk_type_id} description={riskType?.description || null} recommendations={recommendations} catalogStatus={catalogStatus} onClose={onClose} />;
}

const TYPE_PAGE_SIZE = 25;
type TypeSort = 'severity' | 'findings' | 'name';
const TYPE_SORT_OPTIONS = [{ value: 'severity', label: 'Severidad' }, { value: 'findings', label: t('Más hallazgos') }, { value: 'name', label: 'Nombre' }];

/* Risk-type catalog laid out like the Netskope observed-policies view: one
   header with source and freshness, the few numbers that frame the table,
   search/filter/sort, and a dense table with in-cell bars. */
export function CyberarkRiskPanel({ controller }: { controller: ReturnType<typeof useCyberarkRisk> }) {
  const [query, setQuery] = useState('');
  const [entity, setEntity] = useState('');
  const [sort, setSort] = useState<TypeSort>('severity');
  const [page, setPage] = useState(0);
  const overview = controller.overview.data;
  if (controller.overview.isLoading) return <StateBlock variant="loading" title={t('Consultando catálogo y progreso de CyberArk…')} />;
  if (controller.overview.error) return <StateBlock variant="error" title={t('No se pudo cargar el catálogo y progreso de CyberArk')} hint={controller.overview.error instanceof Error ? controller.overview.error.message : 'La consulta no pudo completarse.'} action={<button type="button" className="button subtle" onClick={() => void controller.overview.refetch()}>{t('Reintentar catálogo CyberArk')}</button>} />;
  if (!overview) return <StateBlock compact variant="empty" title={t('CyberArk no devolvió catálogo y progreso')} />;
  const types = overview.risk_types;
  const maxOpenByType = Math.max(0, ...types.map((item) => item.open_findings ?? 0));
  const withFindings = types.filter((item) => (item.open_findings ?? 0) > 0);
  const unknownCounts = types.filter((item) => item.open_findings === null).length;
  const top = [...withFindings].sort((left, right) => (right.open_findings ?? 0) - (left.open_findings ?? 0))[0];
  const entityOptions = [{ value: '', label: t('Todas las entidades') }, ...[...new Set(types.map((item) => item.entity_type).filter((value): value is string => Boolean(value)))].map((value) => ({ value, label: cyberarkEntityLabel(value) }))];
  const normalizedQuery = query.trim().toLocaleLowerCase('es');
  const visible = types
    .filter((item) => !entity || item.entity_type === entity)
    .filter((item) => !normalizedQuery || `${cyberarkRiskName(item.name || item.risk_type_id)} ${item.name ?? ''}`.toLocaleLowerCase('es').includes(normalizedQuery))
    .sort((left, right) => sort === 'name'
      ? cyberarkRiskName(left.name || left.risk_type_id).localeCompare(cyberarkRiskName(right.name || right.risk_type_id), 'es')
      : sort === 'findings'
        ? (right.open_findings ?? -1) - (left.open_findings ?? -1)
        : severityRank(left.severity) - severityRank(right.severity) || (right.open_findings ?? -1) - (left.open_findings ?? -1));
  const lastPage = Math.max(Math.ceil(visible.length / TYPE_PAGE_SIZE) - 1, 0);
  const currentPage = Math.min(page, lastPage);
  const pageRows = visible.slice(currentPage * TYPE_PAGE_SIZE, (currentPage + 1) * TYPE_PAGE_SIZE);
  const reset = (apply: () => void) => { apply(); setPage(0); };
  return <section className="list-panel database-surface cyberark-risk-section" aria-labelledby="cyberark-types-title">
    <header className="cyberark-risk-types-heading">
      <div className="section-title"><ShieldAlert size={17} aria-hidden="true" /><h2 id="cyberark-types-title">{t('Tipos de riesgo evaluados')}</h2><HelpHint label={t('Tipos de riesgo de CyberArk')}><p>Catálogo de Risk Management. Las opciones sugeridas son informativas; Custodia no ejecuta ni pospone remediaciones.</p></HelpHint></div>
      <section className="cyberark-risk-source-note" aria-label={t('Fuente y frescura del catálogo y progreso CyberArk')}><strong>{t('Fuente: CyberArk · Risk Management')}</strong><span>{t('Lectura en vivo · última consulta correcta:')} <time dateTime={overview.fetched_at} title={dateTimeHint(overview.fetched_at)}>{formatDate(overview.fetched_at)}</time></span></section>
    </header>
    {types.length ? <>
      <SummaryStats ariaLabel={t('Resumen del catálogo de riesgos')} stats={[
        { key: 'types', label: 'Tipos evaluados', value: formatNumber(types.length), detail: t('Catálogo de CyberArk') },
        { key: 'with', label: 'Con hallazgos abiertos', value: formatNumber(withFindings.length), detail: unknownCounts ? t('{unknownCounts} sin conteo informado', { unknownCounts: formatNumber(unknownCounts) }) : t('Todos con conteo informado') },
        { key: 'top', label: t('Tipo principal'), value: top ? cyberarkRiskName(top.name || top.risk_type_id) : '—', detail: top ? `${formatNumber(top.open_findings ?? 0)} hallazgos abiertos` : t('Sin hallazgos abiertos informados'), title: top ? cyberarkRiskName(top.name || top.risk_type_id) : undefined },
      ]} />
      <div className="cyberark-risk-types-toolbar">
        <label className="search-box cyberark-risk-types-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label={t('Buscar tipo de riesgo por nombre')} placeholder={t('Nombre del tipo de riesgo')} value={query} onChange={(event) => reset(() => setQuery(event.target.value))} /></label>
        <CompactSelect className="inline-select" ariaLabel={t('Filtrar tipos de riesgo por entidad')} value={entity} options={entityOptions} onChange={(value) => reset(() => setEntity(value))} />
        <span className="cyberark-risk-types-sort"><span className="cyberark-risk-types-label">Orden</span><CompactSelect className="inline-select" ariaLabel={t('Orden de los tipos de riesgo')} value={sort} options={TYPE_SORT_OPTIONS} onChange={(value) => reset(() => setSort(value as TypeSort))} /></span>
      </div>
      {pageRows.length ? <div className="compact-table-wrap"><table className="compact-table posture-table cyberark-risk-types-table"><thead><tr><th>{t('Tipo de riesgo')}</th><th>{t('Severidad')}</th><th>Entidad</th><th>{t('Hallazgos abiertos')}</th><th>{t('Recomendaciones de catálogo')}</th><th>{t('Última actualización')}</th></tr></thead><tbody>{pageRows.map((item) => {
        const recommendations = overview.remediations.filter((remediation) => remediation.remediation_type && item.recommendation_types.includes(remediation.remediation_type));
        return <tr key={item.risk_type_id}><td><span className="cyberark-risk-type-name"><strong>{cyberarkRiskName(item.name || item.risk_type_id)}</strong><HelpHint label={t('Descripción y referencia')}><p>{cyberarkRiskDescription(item.description) || t('Sin descripción de catálogo.')}</p><small>{item.risk_type_id}</small><OriginalRiskText name={item.name || item.risk_type_id} description={item.description} /></HelpHint></span></td><td><StatusBadge tone={cyberarkSeverityTone(item.severity)}>{cyberarkSeverityLabel(item.severity).label}</StatusBadge></td><td>{cyberarkEntityLabel(item.entity_type)}</td><td><BarCell label={displayCount(item.open_findings)} share={item.open_findings !== null && maxOpenByType > 0 ? item.open_findings / maxOpenByType : 0} muted={item.open_findings === null} /></td><td>{recommendations.length ? <><span>{formatNumber(recommendations.length)} opciones</span><HelpHint label={t('Opciones de remediación sugeridas')}><p>Alternativas informativas del catálogo de CyberArk; Custodia no ejecuta ni pospone acciones remotas.</p><ul>{recommendations.map((recommendation) => <li key={recommendation.remediation_id}><strong>{recommendation.name || t('Remediación sugerida')}</strong> — {recommendation.text || t('Sin descripción de catálogo.')}</li>)}</ul></HelpHint></> : <span className="muted">{t('Sin opciones')} <HelpHint label="Recomendaciones"><p>{t('CyberArk no informó opciones vinculables para este tipo. No implica que exista una remediación ejecutada o pendiente en Custodia.')}</p></HelpHint></span>}</td><td>{item.updated_at ? <DateTime value={item.updated_at} /> : <span className="muted">{t('Sin dato')}</span>}</td></tr>;
      })}</tbody></table></div> : <StateBlock compact variant="no-results" title={t('Sin tipos de riesgo para estos filtros')} action={<button type="button" className="button subtle" onClick={() => reset(() => { setQuery(''); setEntity(''); })}>Limpiar filtros</button>} />}
      {visible.length > TYPE_PAGE_SIZE ? <TablePagination page={currentPage} pageSize={TYPE_PAGE_SIZE} total={visible.length} onPageChange={setPage} /> : null}
    </> : <StateBlock compact variant="empty" title={t('Sin tipos de riesgo informados')} />}
  </section>;
}
