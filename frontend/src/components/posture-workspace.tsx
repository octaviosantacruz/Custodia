import { useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { StateBlock } from './state-block';
import { StatusBadge } from './semantic';
import { TablePagination } from './table-pagination';
import { useFindings } from '../hooks/use-findings';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import { FINDING_PAGE_SIZE } from '../lib/findings-api';
import { findingGuidance } from '../lib/finding-guidance';
import { formatDate, formatNumber } from '../lib/format';
import type { Finding, FindingSeverity, FindingStatus } from '../types/findings';
import type { WorkspaceView } from '../lib/workspaces';
import './posture-workspace.css';
import { categoryLabel } from './posture-labels';

type Props = { authChecked: boolean; authenticated: boolean; includeInternal: boolean; canManage: boolean; onUnauthorized: () => void; onError: (message: string) => void; onNotice: (message: string) => void; onNavigate: (view: WorkspaceView, query?: string) => void };

const STATUS_LABELS: Record<FindingStatus, string> = { open: 'Abierto', acknowledged: 'Reconocido', resolved: 'Resuelto', excepted: 'Exceptuado' };
const SEVERITY_LABELS: Record<FindingSeverity, string> = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' };
const RULE_LABELS: Record<string, string> = {
  SAFE_NO_ACTIVE_ACCOUNTS: 'Safe sin cuentas activas',
  ACCOUNT_PLATFORM_MISSING: 'Cuenta sin plataforma informada',
  ACCOUNT_PLATFORM_PARTIAL: 'Relación cuenta-plataforma parcial',
};

function statusTone(status: FindingStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' { return status === 'resolved' ? 'success' : status === 'acknowledged' ? 'info' : status === 'excepted' ? 'neutral' : 'danger'; }
function severityTone(severity: FindingSeverity): 'warning' | 'danger' | 'info' { return severity === 'low' ? 'info' : severity === 'medium' ? 'warning' : 'danger'; }
function subjectLabel(finding: Finding): string { const evidence = finding.evidence; return String(evidence.safe_name || evidence.account_name || finding.subject_id); }
function evidenceEntries(finding: Finding): Array<[string, string]> { return Object.entries(finding.evidence).filter(([key]) => !['condition'].includes(key)).map(([key, value]) => [key.replaceAll('_', ' '), value === null || value === '' ? 'Sin dato' : String(value)]); }

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
    <button className="drawer-backdrop" type="button" aria-label="Cerrar detalle del hallazgo" onClick={onClose} />
    <aside className="detail-drawer posture-finding-drawer">
      <div className="detail-title"><div className="detail-icon"><ShieldAlert size={18} /></div><div className="detail-heading"><p className="eyebrow">{categoryLabel(finding.category).toUpperCase()}</p><h2 id="finding-drawer-title">{finding.title}</h2><p>{finding.rule_id} · v{finding.rule_version}</p></div><button ref={closeRef} className="icon-button drawer-close" type="button" title="Cerrar" aria-label="Cerrar" onClick={onClose}><X size={16} /></button></div>
      <section className="detail-section posture-finding-summary"><div className="posture-badge-row"><StatusBadge tone={severityTone(finding.severity)}>{SEVERITY_LABELS[finding.severity]}</StatusBadge><StatusBadge tone={statusTone(finding.status)}>{STATUS_LABELS[finding.status]}</StatusBadge></div><div className="posture-guidance"><div><span>Qué observamos</span><p>{guidance.observation}</p></div><div><span>Por qué importa</span><p>{guidance.impact}</p></div><div className="posture-guidance-action"><span>Qué podés hacer</span><p>{guidance.action}</p></div></div><dl className="posture-facts"><div><dt>Objeto</dt><dd>{finding.subject_type} · {subjectLabel(finding)}</dd></div><div><dt>Primera detección</dt><dd>{formatDate(finding.first_detected_at)}</dd></div><div><dt>Última detección</dt><dd>{formatDate(finding.last_detected_at)}</dd></div></dl>{evidence.safe_name ? <button type="button" className="button secondary posture-context-button" onClick={() => onNavigate('safes', String(evidence.safe_name))}><ExternalLink size={14} /> Abrir Safe relacionado</button> : null}</section>
      <details className="detail-section posture-evidence"><summary>Evidencia técnica</summary><p className="posture-explanation">Campos observados en {finding.source_system}. No contienen credenciales ni datos secretos.</p><dl className="posture-evidence-list">{evidenceEntries(finding).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details>
      {canManage && <section className="detail-section posture-action-section"><h3>Registrar revisión</h3><p className="posture-explanation">Este estado documenta tu decisión en DS Hub. No modifica el objeto en CyberArk y una regla vigente puede volver a abrirlo.</p><label className="posture-field">Estado<select aria-label="Estado del hallazgo" value={status} onChange={(event) => setStatus(event.target.value as FindingStatus)}><option value="open">Abierto</option><option value="acknowledged">Reconocido</option><option value="resolved">Resuelto</option><option value="excepted">Exceptuado</option></select></label>{status === 'excepted' && <><label className="posture-field">Motivo de excepción<textarea aria-label="Motivo de excepción" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Documentá por qué esta señal no aplica…" /></label><label className="posture-field">Vigencia de la excepción<input aria-label="Vigencia de la excepción" type="datetime-local" value={until} onChange={(event) => setUntil(event.target.value)} /></label></>}<button type="button" className="button primary" disabled={busy || (status === 'excepted' && !reason.trim())} onClick={() => void save()}><CheckCircle2 size={14} /> Guardar revisión</button></section>}
    </aside>
  </div>;
}

export function PostureWorkspace({ authChecked, authenticated, includeInternal, canManage, onUnauthorized, onError, onNotice, onNavigate }: Props) {
  const controller = useFindings({ authChecked, authenticated, includeInternal, onUnauthorized, onError, onNotice });
  const [selected, setSelected] = useState<Finding | null>(null);
  return <>
    <section className="database-toolbar"><div><h2>Postura</h2><span className="database-caption">Situaciones del inventario que tienen contexto y una revisión concreta posible.</span></div><div className="database-toolbar-actions"><span className="database-toolbar-count">{formatNumber(controller.total)} hallazgos</span>{canManage && <button className="button subtle" type="button" title="Volver a evaluar las reglas con el inventario actual" disabled={controller.busy} onClick={() => void controller.refresh()}><RefreshCw size={14} aria-hidden /> Actualizar reglas</button>}</div></section>
    <section className="list-panel database-surface posture-surface"><div className="posture-filter-row"><label>Estado<select aria-label="Filtrar hallazgos por estado" value={controller.status} onChange={(event) => controller.setStatus(event.target.value as FindingStatus | '')}><option value="">Todos los estados</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Severidad<select aria-label="Filtrar hallazgos por severidad" value={controller.severity} onChange={(event) => controller.setSeverity(event.target.value as FindingSeverity | '')}><option value="">Todas las severidades</option>{Object.entries(SEVERITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Regla<select aria-label="Filtrar hallazgos por regla" value={controller.ruleId} onChange={(event) => controller.setRuleId(event.target.value)}><option value="">Todas las reglas</option>{Object.entries(RULE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><span className="posture-filter-note"><ShieldAlert size={14} /> Solo señales con una revisión posible.</span></div>{controller.loading ? <StateBlock variant="loading" title="Cargando postura…" /> : controller.loadError ? <StateBlock variant="error" title="No se pudo cargar la postura" hint={controller.loadError} action={<button type="button" className="button subtle" onClick={() => void controller.reload()}>Reintentar</button>} /> : controller.rows.length ? <div className="compact-table-wrap"><table className="compact-table posture-table"><thead><tr><th>Hallazgo</th><th>Objeto</th><th>Qué revisar</th><th>Prioridad</th><th>Estado</th><th>Última detección</th></tr></thead><tbody>{controller.rows.map((finding) => <tr key={finding.finding_id} className={`posture-row${selected?.finding_id === finding.finding_id ? ' selected' : ''}`} tabIndex={0} aria-label={`${finding.title}: ver detalle del hallazgo`} onClick={() => setSelected(finding)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(finding); } }}><td><button type="button" className="posture-row-link" onClick={(event) => { event.stopPropagation(); setSelected(finding); }}>{finding.title}<small>{categoryLabel(finding.category)}</small></button></td><td>{subjectLabel(finding)}<small>{finding.source_system}</small></td><td><span className="posture-review-action">{findingGuidance(finding).actionShort}</span></td><td><StatusBadge tone={severityTone(finding.severity)}>{SEVERITY_LABELS[finding.severity]}</StatusBadge></td><td><StatusBadge tone={statusTone(finding.status)}>{STATUS_LABELS[finding.status]}</StatusBadge></td><td>{formatDate(finding.last_detected_at)}</td></tr>)}</tbody></table></div> : <StateBlock variant="empty" title="No hay hallazgos para estos filtros" hint="Podés cambiar los filtros o actualizar las reglas con el inventario vigente." action={(controller.status || controller.ruleId || controller.severity) ? <button type="button" className="button subtle" onClick={() => { controller.setStatus(''); controller.setRuleId(''); controller.setSeverity(''); }}>Limpiar filtros</button> : undefined} />}<TablePagination page={controller.page} pageSize={FINDING_PAGE_SIZE} total={controller.total} onPageChange={controller.setPage} /></section>
    {selected && <FindingDrawer finding={selected} canManage={canManage} busy={controller.busy} onClose={() => setSelected(null)} onStatus={(status, reason, until) => controller.changeStatus(selected, status, reason, until)} onNavigate={onNavigate} />}
  </>;
}
