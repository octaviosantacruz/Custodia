import { DateTime } from '../../../cross/components/date-time';
import { useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { StateBlock } from '../../../cross/components/state-block';
import { StatusBadge } from '../../../cross/components/semantic';
import { TablePagination } from '../../../cross/components/table-pagination';
import { CompactSelect } from '../../../cross/components/compact-select';
import { useFindings } from '../hooks/use-findings';
import { useDialogFocusTrap } from '../../../cross/hooks/use-dialog-focus-trap';
import { FINDING_PAGE_SIZE } from '../lib/findings-api';
import { findingGuidance } from '../lib/finding-guidance';
import { formatNumber, relativeTime } from '../../../cross/lib/format';
import type { Finding, FindingSeverity, FindingStatus } from '../types/findings';
import type { WorkspaceView } from '../../../cross/lib/workspaces';
import './posture-workspace.css';
import { categoryLabel } from './posture-labels';
import { CyberarkRiskDetail, CyberarkRiskPanel, cyberarkSeverityTone } from '../../risk_management/components/cyberark-risk-panel';
import { cyberarkEntityLabel, cyberarkRiskName, cyberarkSeverityLabel, cyberarkStatusLabel, cyberarkStatusTone } from '../../risk_management/lib/cyberark-risk-labels';
import { useCyberarkRisk } from '../../risk_management/hooks/use-cyberark-risk';
import { CyberarkRiskOverviewPanel, CyberarkRiskSummaryStrip } from '../../risk_management/components/cyberark-risk-overview';
import { CyberarkRiskFindingGroups } from '../../risk_management/components/cyberark-risk-finding-groups';
import { CYBERARK_RISK_PAGE_SIZE, type CyberarkRiskFinding } from '../../risk_management/lib/cyberark-risk-api';
import { t } from '../../../cross/i18n/index.ts';

type Props = { authChecked: boolean; authenticated: boolean; includeInternal: boolean; canManage: boolean; canReadCyberarkRisk: boolean; onUnauthorized: () => void; onError: (message: string) => void; onNotice: (message: string) => void; onNavigate: (view: WorkspaceView, query?: string) => void };

const STATUS_LABELS: Record<FindingStatus, string> = { open: t('Abierto'), acknowledged: t('Reconocido'), resolved: t('Resuelto'), excepted: 'Exceptuado' };
const SEVERITY_LABELS: Record<FindingSeverity, string> = { low: t('Baja'), medium: t('Media'), high: t('Alta'), critical: t('Crítica') };
const RULE_LABELS: Record<string, string> = {
  SAFE_NO_ACTIVE_ACCOUNTS: t('Safe sin cuentas activas'),
  ACCOUNT_PLATFORM_MISSING: t('Cuenta sin plataforma informada'),
  ACCOUNT_PLATFORM_PARTIAL: t('Relación cuenta-plataforma parcial'),
};

const STATUS_FILTER_OPTIONS = [{ value: '', label: t('Todos los estados') }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))];
const SEVERITY_FILTER_OPTIONS = [{ value: '', label: t('Todas las severidades') }, ...Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label }))];
const RULE_FILTER_OPTIONS = [{ value: '', label: t('Todas las reglas') }, ...Object.entries(RULE_LABELS).map(([value, label]) => ({ value, label }))];
const DRAWER_STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

function statusTone(status: FindingStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' { return status === 'resolved' ? 'success' : status === 'acknowledged' ? 'info' : status === 'excepted' ? 'neutral' : 'danger'; }
function severityTone(severity: FindingSeverity): 'warning' | 'danger' | 'info' { return severity === 'low' ? 'info' : severity === 'medium' ? 'warning' : 'danger'; }
function subjectLabel(finding: Finding): string {
  const name = finding.subject_type === 'account' ? finding.evidence.account_name : finding.subject_type === 'safe' ? finding.evidence.safe_name : null;
  return String(name || finding.subject_id);
}
function evidenceEntries(finding: Finding): Array<[string, string]> { return Object.entries(finding.evidence).filter(([key]) => !['condition'].includes(key)).map(([key, value]) => [key.replaceAll('_', ' '), value === null || value === '' ? t('Sin dato') : String(value)]); }

function FindingDrawer({ finding, canManage, busy, onClose, onStatus, onNavigate }: { finding: Finding; canManage: boolean; busy: boolean; onClose: () => void; onStatus: (status: FindingStatus, reason?: string, until?: string) => Promise<void>; onNavigate: (view: WorkspaceView, query?: string) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<FindingStatus>(finding.status);
  const [reason, setReason] = useState(finding.exception_reason || '');
  const [until, setUntil] = useState(finding.exception_until ? finding.exception_until.slice(0, 16) : '');
  const evidence = finding.evidence;
  const guidance = findingGuidance(finding);
  const save = async () => { await onStatus(status, reason, until ? new Date(until).toISOString() : undefined); onClose(); };
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onClose, initialFocusRef: closeRef });
  return <div ref={dialogRef} className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="finding-drawer-title" tabIndex={-1}>
    <button className="drawer-backdrop" type="button" aria-label={t('Cerrar detalle del hallazgo')} onClick={onClose} />
    <aside className="detail-drawer posture-finding-drawer">
      <div className="detail-title"><div className="detail-icon"><ShieldAlert size={18} /></div><div className="detail-heading"><p className="eyebrow">{categoryLabel(finding.category).toUpperCase()}</p><h2 id="finding-drawer-title">{finding.title}</h2><p>{finding.rule_id} · v{finding.rule_version}</p></div><button ref={closeRef} className="icon-button drawer-close" type="button" title={t('Cerrar')} aria-label={t('Cerrar')} onClick={onClose}><X size={16} /></button></div>
      <section className="detail-section posture-finding-summary"><div className="posture-badge-row"><StatusBadge tone={severityTone(finding.severity)}>{SEVERITY_LABELS[finding.severity]}</StatusBadge><StatusBadge tone={statusTone(finding.status)}>{STATUS_LABELS[finding.status]}</StatusBadge></div><div className="posture-guidance"><div><span>{t('Qué observamos')}</span><p>{guidance.observation}</p></div><div><span>{t('Por qué importa')}</span><p>{guidance.impact}</p></div><div className="posture-guidance-action"><span>{t('Qué podés hacer')}</span><p>{guidance.action}</p></div></div><dl className="posture-facts"><div><dt>{t('Objeto')}</dt><dd>{finding.subject_type} · {subjectLabel(finding)}</dd></div><div><dt>{t('Primera detección')}</dt><dd><DateTime value={finding.first_detected_at} /></dd></div><div><dt>{t('Última detección')}</dt><dd><DateTime value={finding.last_detected_at} /></dd></div></dl>{evidence.safe_name ? <button type="button" className="button secondary posture-context-button" onClick={() => onNavigate('safes', String(evidence.safe_name))}><ExternalLink size={14} /> {t('Abrir Safe relacionado')}</button> : null}</section>
      <details className="detail-section posture-evidence"><summary>{t('Evidencia técnica')}</summary><p className="posture-explanation">{t('Campos observados en {source_system}. No contienen credenciales ni datos secretos.', { source_system: finding.source_system })}</p><dl className="posture-evidence-list">{evidenceEntries(finding).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details>
      {canManage && <section className="detail-section posture-action-section"><h3>{t('Registrar revisión')}</h3><p className="posture-explanation">{t('Este estado documenta tu decisión en Custodia. No modifica el objeto en CyberArk y una regla vigente puede volver a abrirlo.')}</p><label className="posture-field">{t('Estado')}<CompactSelect ariaLabel={t('Estado del hallazgo')} value={status} onChange={(value) => setStatus(value as FindingStatus)} options={DRAWER_STATUS_OPTIONS} /></label>{status === 'excepted' && <><label className="posture-field">{t('Motivo de excepción')}<textarea aria-label={t('Motivo de excepción')} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('Documentá por qué esta señal no aplica…')} /></label><label className="posture-field">{t('Vigencia de la excepción')}<input aria-label={t('Vigencia de la excepción')} type="datetime-local" value={until} onChange={(event) => setUntil(event.target.value)} /></label></>}<button type="button" className="button primary" disabled={busy || (status === 'excepted' && !reason.trim())} onClick={() => void save()}><CheckCircle2 size={14} /> {t('Guardar revisión')}</button></section>}
    </aside>
  </div>;
}

export function PostureWorkspace({ authChecked, authenticated, includeInternal, canManage, canReadCyberarkRisk, onUnauthorized, onError, onNotice, onNavigate }: Props) {
  const controller = useFindings({ authChecked, authenticated, includeInternal, onUnauthorized, onError, onNotice });
  const riskEnabled = authChecked && authenticated && canReadCyberarkRisk;
  const [section, setSection] = useState<'overview' | 'findings' | 'types'>('overview');
  // CyberArk findings: grouped by risk type (default) or the flat paged list.
  const [riskView, setRiskView] = useState<'grouped' | 'items'>('grouped');
  const risk = useCyberarkRisk({ enabled: riskEnabled, groupedEnabled: section === 'findings' && riskView === 'grouped', onUnauthorized });
  const [selected, setSelected] = useState<Finding | null>(null);
  const [selectedRisk, setSelectedRisk] = useState<CyberarkRiskFinding | null>(null);
  const overview = risk.overview.data;
  // Grouped reading when every finding fit in one bounded read; otherwise the paged list.
  const grouped = riskView === 'grouped' ? risk.allFindings.data : undefined;
  const groupedMode = Boolean(grouped);
  const groupedPending = riskView === 'grouped' && risk.allFindings.isLoading;
  const groupedUnavailable = Boolean(risk.allFindings.error);
  const findings = risk.findings.data;
  const entityNamesVisible = (grouped ?? findings)?.entity_names_visible === true;
  const refreshRisk = () => Promise.all([risk.overview.refetch(), risk.findings.refetch(), ...(section === 'findings' && riskView === 'grouped' ? [risk.allFindings.refetch()] : [])]);
  const riskLoading = risk.findings.isLoading || risk.findings.isPlaceholderData;
  const effectiveSection = riskEnabled ? section : 'findings';
  return <>
    {canManage || riskEnabled ? <div className="posture-toolbar">
      {riskEnabled ? <nav className="posture-section-switch" aria-label={t('Vistas de postura')}>
        <button type="button" className="button subtle" aria-pressed={effectiveSection === 'overview'} onClick={() => setSection('overview')}>{t('Resumen')}</button>
        <button type="button" className="button subtle" aria-pressed={effectiveSection === 'findings'} onClick={() => setSection('findings')}>{t('Hallazgos')}</button>
        <button type="button" className="button subtle" aria-pressed={effectiveSection === 'types'} onClick={() => setSection('types')}>Tipos de riesgo{overview ? ` (${formatNumber(overview.risk_types.length)})` : ''}</button>
      </nav> : null}
      <div className="database-toolbar-actions">{canManage && <button className="button subtle" type="button" title={t('Volver a evaluar las reglas locales con el inventario actual')} disabled={controller.busy} onClick={() => void controller.refresh()}><RefreshCw size={14} aria-hidden /> {t('Actualizar reglas Custodia')}</button>}{riskEnabled ? <button className="button subtle" type="button" disabled={risk.overview.isFetching || risk.findings.isFetching} onClick={() => void refreshRisk()}><RefreshCw size={14} aria-hidden /> {t('Actualizar lectura')}</button> : null}</div>
    </div> : null}
    {effectiveSection === 'findings' ? <section className="list-panel database-surface posture-surface" aria-label={t('Hallazgos por fuente')}>
      {riskEnabled && overview ? <CyberarkRiskSummaryStrip overview={overview} /> : null}
      <div className="posture-filter-row">{riskEnabled ? <div className="posture-risk-view" role="group" aria-label={t('Presentación de hallazgos CyberArk')}><button type="button" className="button subtle" aria-pressed={riskView === 'grouped'} disabled={groupedUnavailable && riskView !== 'grouped'} title={groupedUnavailable ? t('CyberArk informó más hallazgos de los que la vista agrupada puede leer') : undefined} onClick={() => setRiskView('grouped')}>{t('Por tipo de riesgo')}</button><button type="button" className="button subtle" aria-pressed={riskView === 'items'} onClick={() => setRiskView('items')}>{t('Todos los hallazgos')}</button></div> : null}<strong className="posture-filter-scope">{t('Filtros Custodia')}</strong><label>{t('Estado')}<CompactSelect ariaLabel={t('Filtrar hallazgos por estado')} value={controller.status} onChange={(value) => controller.setStatus(value as FindingStatus | '')} options={STATUS_FILTER_OPTIONS} /></label><label>{t('Severidad')}<CompactSelect ariaLabel={t('Filtrar hallazgos por severidad')} value={controller.severity} onChange={(value) => controller.setSeverity(value as FindingSeverity | '')} options={SEVERITY_FILTER_OPTIONS} /></label><label>{t('Regla')}<CompactSelect ariaLabel={t('Filtrar hallazgos por regla')} value={controller.ruleId} onChange={(value) => controller.setRuleId(value)} options={RULE_FILTER_OPTIONS} /></label></div>
       <div className="posture-source-context" aria-label={t('Cobertura y frescura por fuente')}><span><strong>{t('Custodia')}</strong> {t('· Inventario local · {total}', { total: controller.loading || controller.loadError ? 'Conteo pendiente' : t('{total} hallazgos con estos filtros', { total: formatNumber(controller.total) }) })}</span>{riskEnabled ? grouped ? <span><strong>{t('CyberArk')}</strong> {t('· Lectura en vivo · consultado {fetched_at} · {rows} hallazgos agrupados por tipo de riesgo', { fetched_at: relativeTime(grouped.fetched_at), rows: formatNumber(grouped.rows.length) })}</span> : <span><strong>{t('CyberArk')}</strong> · Lectura en vivo · {!riskLoading && findings ? `consultado ${relativeTime(findings.fetched_at)}` : 'Consulta pendiente'} · Páginas de hasta {CYBERARK_RISK_PAGE_SIZE} filas; total no informado.{riskView === 'grouped' && groupedUnavailable ? t(' La vista agrupada no está disponible para este volumen.') : ''}</span> : null}{riskEnabled && (grouped || (!riskLoading && findings)) && !entityNamesVisible ? <span className="posture-role-note">{t('Tu rol no incluye el nombre de la entidad')}</span> : null}</div>
      <div className="compact-table-wrap"><table className="compact-table posture-table posture-unified-table" aria-label={t('Hallazgos PAM')}><thead><tr><th>{t('Hallazgo')}</th><th>{t('Objeto relacionado')}</th><th>{t('Qué revisar')}</th><th>{t('Severidad')}</th><th>{t('Estado')}</th><th>{t('Última detección')}</th></tr></thead><tbody>
        {controller.loading ? <tr><td colSpan={6}><StateBlock variant="loading" title={t('Cargando hallazgos Custodia…')} /></td></tr> : controller.loadError ? <tr><td colSpan={6}><StateBlock variant="error" title={t('No se pudieron cargar los hallazgos Custodia')} hint={controller.loadError} action={<button type="button" className="button subtle" onClick={() => void controller.reload()}>{t('Reintentar Custodia')}</button>} /></td></tr> : controller.rows.length ? controller.rows.map((finding) => <tr key={`local:${finding.finding_id}`} className={`posture-row${selected?.finding_id === finding.finding_id ? ' selected' : ''}`} onClick={() => setSelected(finding)}><td><button type="button" className="posture-row-link" onClick={(event) => { event.stopPropagation(); setSelected(finding); }}>{finding.title}</button><small className="posture-source-label">Custodia · {categoryLabel(finding.category)}</small></td><td>{subjectLabel(finding)}<small>{finding.subject_type} · {finding.source_system}</small></td><td><span className="posture-review-action">{findingGuidance(finding).actionShort}</span></td><td><StatusBadge tone={severityTone(finding.severity)}>{SEVERITY_LABELS[finding.severity]}</StatusBadge></td><td><StatusBadge tone={statusTone(finding.status)}>{STATUS_LABELS[finding.status]}</StatusBadge></td><td><DateTime value={finding.last_detected_at} /></td></tr>) : <tr><td colSpan={6}><StateBlock variant="empty" title={t('Custodia: no hay hallazgos para estos filtros')} compact action={(controller.status || controller.ruleId || controller.severity) ? <button type="button" className="button subtle" onClick={() => { controller.setStatus(''); controller.setRuleId(''); controller.setSeverity(''); }}>{t('Limpiar filtros Custodia')}</button> : undefined} /></td></tr>}
        {riskEnabled && groupedPending ? <tr><td colSpan={6}><StateBlock variant="loading" title={t('Agrupando hallazgos de CyberArk por tipo de riesgo…')} /></td></tr> : riskEnabled && grouped ? grouped.rows.length ? <CyberarkRiskFindingGroups findings={grouped.rows} riskTypes={overview?.risk_types ?? []} entityNamesVisible={entityNamesVisible} onSelect={setSelectedRisk} /> : <tr><td colSpan={6}><StateBlock variant="empty" title={t('CyberArk no reportó hallazgos')} /></td></tr> : riskEnabled ? riskLoading ? <tr><td colSpan={6}><StateBlock variant="loading" title={t('Consultando hallazgos de CyberArk…')} /></td></tr> : risk.findings.error ? <tr><td colSpan={6}><StateBlock variant="error" title={t('No se pudieron cargar los hallazgos de CyberArk')} hint={risk.findings.error instanceof Error ? risk.findings.error.message : 'La consulta no pudo completarse.'} action={<button type="button" className="button subtle" onClick={() => void risk.findings.refetch()}>{t('Reintentar hallazgos CyberArk')}</button>} /></td></tr> : findings?.rows.length ? findings.rows.map((finding) => {
           const riskType = overview?.risk_types.find((item) => item.risk_type_id === finding.risk_type_id);
            const entityLabel = entityNamesVisible
              ? finding.entity_name || t('Sin nombre informado')
              : cyberarkEntityLabel(finding.entity_type);
            const entityContext = entityNamesVisible
              ? `${cyberarkEntityLabel(finding.entity_type)} · ${finding.entity_id}`
              : finding.entity_id;
            return <tr key={`risk:${finding.finding_id}`} className="posture-row" onClick={() => setSelectedRisk(finding)}><td><button type="button" className="posture-row-link" onClick={(event) => { event.stopPropagation(); setSelectedRisk(finding); }}>{cyberarkRiskName(riskType?.name || finding.risk_type_id)}<small>{finding.finding_id}</small></button><small className="posture-source-label">CyberArk Risk Management · {finding.risk_type_id}</small></td><td>{entityLabel}<small>{entityContext}</small></td><td><span className="posture-review-action">{t('Ver recomendaciones de CyberArk')}</span></td><td><StatusBadge tone={cyberarkSeverityTone(finding.severity)}>{cyberarkSeverityLabel(finding.severity).label}</StatusBadge></td><td><StatusBadge tone={cyberarkStatusTone(finding.status)}>{cyberarkStatusLabel(finding.status).label}</StatusBadge></td><td><DateTime value={finding.last_detected_at} /></td></tr>;
        }) : <tr><td colSpan={6}><StateBlock variant="empty" title={t('CyberArk no reportó hallazgos en esta página')} /></td></tr> : null}
      </tbody></table></div>
      {riskEnabled && risk.overview.error ? <div className="posture-catalog-status" role="status">{t('Catálogo y recomendaciones CyberArk no disponibles. Los hallazgos conservan sus referencias de origen.')} <button className="button subtle" type="button" onClick={() => void risk.overview.refetch()}>{t('Reintentar catálogo CyberArk')}</button></div> : null}
      <div className="posture-source-pagination" aria-label={t('Paginación Custodia')}><strong>{t('Custodia')}</strong><TablePagination page={controller.page} pageSize={FINDING_PAGE_SIZE} total={controller.total} onPageChange={controller.setPage} /></div>
      {riskEnabled && !groupedMode && !groupedPending ? <div className="cyberark-risk-pagination" aria-label={t('Paginación CyberArk')}><span><strong>{t('CyberArk')}</strong> {t('· Página {page} · hasta {CYBERARK_RISK_PAGE_SIZE} filas', { page: formatNumber(risk.page + 1), CYBERARK_RISK_PAGE_SIZE: formatNumber(CYBERARK_RISK_PAGE_SIZE) })}</span><div><button className="icon-button" type="button" aria-label={t('Página anterior de riesgos CyberArk')} disabled={risk.page === 0 || risk.findings.isFetching} onClick={() => risk.setPage((page) => page - 1)}><ChevronLeft size={16} /></button><button className="icon-button" type="button" aria-label={t('Página siguiente de riesgos CyberArk')} disabled={!findings || Boolean(risk.findings.error) || findings.is_last_page || risk.findings.isFetching} onClick={() => risk.setPage((page) => page + 1)}><ChevronRight size={16} /></button></div></div> : null}
    </section> : effectiveSection === 'overview' ? <CyberarkRiskOverviewPanel controller={risk} onShowAllTypes={() => setSection('types')} /> : <CyberarkRiskPanel controller={risk} />}
    {selected ? <FindingDrawer finding={selected} canManage={canManage} busy={controller.busy} onClose={() => setSelected(null)} onStatus={(status, reason, until) => controller.changeStatus(selected, status, reason, until)} onNavigate={onNavigate} /> : null}
    {riskEnabled && selectedRisk ? <CyberarkRiskDetail finding={selectedRisk} entityNamesVisible={entityNamesVisible} overview={overview} catalogStatus={risk.overview.isLoading ? 'pending' : risk.overview.error || !overview ? 'unavailable' : 'ready'} onClose={() => setSelectedRisk(null)} /> : null}
  </>;
}
