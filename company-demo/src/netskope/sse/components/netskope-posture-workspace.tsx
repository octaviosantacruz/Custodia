import { Fragment, useState, type ReactNode } from 'react';
import { ChevronRight, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { NetskopeClientEventsPanel, NetskopeDiagnosisPanel, NetskopeDuplicatesPanel } from './netskope-operations';
import { BarCell } from '../../../cross/components/bar-cell';
import { DateTime } from '../../../cross/components/date-time';
import { HelpHint } from '../../../cross/components/help-hint';
import { StateBlock } from '../../../cross/components/state-block';
import { StatusBadge } from '../../../cross/components/semantic';
import { SummaryStats } from '../../../cross/components/summary-stats';
import { formatNumber, relativeTime } from '../../../cross/lib/format';
import type { WorkspaceView } from '../../../cross/lib/workspaces';
import { useNetskopePanel } from '../hooks/use-netskope-panel';
import { fetchNetskopeClientEvents, fetchNetskopeDeviceReviewSummary, fetchNetskopePosture } from '../lib/netskope-api';
import { netskopeInventoryPath } from '../lib/netskope-device-filters';
import {
  POSTURE_SEVERITIES, POSTURE_SEVERITY_LABELS, postureDrill, postureEntityLabel, posturePendingHint,
  postureRows, postureSeverityTone, postureStatusLabel, postureSummary,
} from '../lib/netskope-posture-checks';
import type { NetskopeDeviceQuery, NetskopePostureCheck, NetskopePostureResponse, NetskopePostureSeverity } from '../types/netskope';
import './netskope-posture-workspace.css';

type Props = {
  refreshKey: number;
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onNavigate: (view: WorkspaceView) => void;
};

/** `?open=stale_undiagnosed,duplicate_hostname` opens those rows (Equipos links here). */
function initialOpen(): Record<string, boolean> {
  try {
    const ids = (new URLSearchParams(window.location.search).get('open') ?? '').split(',').filter(Boolean);
    return Object.fromEntries(ids.map((id) => [id, true]));
  } catch { return {}; }
}

function syncOpenUrl(open: Record<string, boolean>) {
  const url = new URL(window.location.href);
  const ids = Object.keys(open).filter((id) => open[id]);
  if (ids.length) url.searchParams.set('open', ids.join(',')); else url.searchParams.delete('open');
  url.searchParams.delete('section');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

const HELP = 'Cada chequeo se evalúa al abrir la vista sobre el inventario ya sincronizado; no se guarda un estado propio. El número de un chequeo es exactamente la lista que abre "Ver en inventario". Un chequeo sin línea base o sin permiso no se cuenta como cero: aparece aparte como pendiente.';

function SeverityBadge({ severity }: { severity: NetskopePostureSeverity }) {
  return <StatusBadge tone={postureSeverityTone(severity)}>{POSTURE_SEVERITY_LABELS[severity]}</StatusBadge>;
}

function SourceContext({ data }: { data: NetskopePostureResponse }) {
  const evidence = data.source_evidence;
  if (!evidence.source_completed_at) return <span className="nsk-posture-source is-warning">Sin sincronización completa del inventario Netskope</span>;
  return <span className={`nsk-posture-source${evidence.source_fresh ? '' : ' is-warning'}`}>
    Inventario sincronizado {relativeTime(evidence.source_completed_at)}{evidence.source_fresh ? '' : ' · no es una corrida completa de las últimas 24 h'}
  </span>;
}

function FindingSample({ check }: { check: NetskopePostureCheck }) {
  const signal = (value: string | null) => value ? <DateTime value={value} /> : <span className="muted">Sin dato</span>;
  if (check.entity === 'user') return <table className="compact-table nsk-posture-sample" aria-label={`Muestra de ${check.title}`}>
    <thead><tr><th>Usuario</th><th>Correo</th><th>Índice de confianza</th><th>Calculado</th></tr></thead>
    <tbody>{check.findings.map((finding, index) => <tr key={index}>
      <td><span className="cell-lead">{finding.name || 'Sin nombre informado'}</span></td>
      <td>{finding.user || <span className="muted">Sin dato</span>}</td>
      <td>{finding.score ?? <span className="muted">Sin dato</span>}</td>
      <td>{signal(finding.detected_at)}</td>
    </tr>)}</tbody>
  </table>;
  return <table className="compact-table nsk-posture-sample" aria-label={`Muestra de ${check.title}`}>
    <thead><tr><th>Equipo</th><th>Usuario informado</th><th>Sistema operativo</th><th>Cliente</th><th>Último evento</th><th>Última señal</th></tr></thead>
    <tbody>{check.findings.map((finding) => <tr key={finding.object_id ?? finding.name}>
      <td><span className="cell-lead">{finding.name || 'Sin nombre informado'}</span></td>
      <td>{finding.user || <span className="muted">Sin dato</span>}</td>
      <td>{finding.os || <span className="muted">Sin dato</span>}</td>
      <td>{finding.client_version || <span className="muted">Sin dato</span>}</td>
      <td>{finding.last_event || <span className="muted">Sin dato</span>}</td>
      <td>{signal(finding.detected_at)}</td>
    </tr>)}</tbody>
  </table>;
}

/** NSK-POSTURE-001: "¿Qué está mal y qué hago?" — the critical band and one prioritized table of every check. */
export function NetskopePostureWorkspace({ refreshKey, authChecked, authenticated, onUnauthorized, onNavigate }: Props) {
  const enabled = authChecked && authenticated;
  const [severity, setSeverity] = useState<NetskopePostureSeverity | ''>('');
  const [open, setOpen] = useState<Record<string, boolean>>(initialOpen);
  const panel = useNetskopePanel({ cacheKey: ['posture'], enabled, refreshKey, onUnauthorized, load: fetchNetskopePosture });
  const clientEvents = useNetskopePanel({ cacheKey: ['client-events'], enabled: enabled && open.client_protection_off === true, refreshKey, onUnauthorized, load: fetchNetskopeClientEvents });
  const diagnosis = useNetskopePanel({ cacheKey: ['device-review-summary'], enabled: enabled && open.stale_undiagnosed === true, refreshKey, onUnauthorized, load: fetchNetskopeDeviceReviewSummary });
  const data = panel.data;

  const go = (view: WorkspaceView, path: string) => {
    onNavigate(view);
    // The inventory restores its filters from the URL of the entry the navigation just created.
    const url = new URL(path, window.location.origin);
    if (window.location.pathname === url.pathname) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  };
  const drill = (check: NetskopePostureCheck) => { const target = postureDrill(check); go(target.view, target.path); };
  const drillQuery = (query: NetskopeDeviceQuery) => go('netskopeDevices', netskopeInventoryPath(query).replace('/netskope/inventory?', '/netskope/devices?'));
  const toggle = (id: string) => setOpen((current) => { const next = { ...current, [id]: !current[id] }; syncOpenUrl(next); return next; });

  /* The detail that used to live in Equipos > Para revisar, next to the check it explains. */
  const details: Record<string, ReactNode> = {
    client_protection_off: <NetskopeClientEventsPanel panel={clientEvents} onDrill={drillQuery} />,
    stale_undiagnosed: <NetskopeDiagnosisPanel panel={diagnosis} onDrill={drillQuery} />,
    duplicate_hostname: <NetskopeDuplicatesPanel enabled={enabled && open.duplicate_hostname === true} refreshKey={refreshKey} onUnauthorized={onUnauthorized} onDrill={drillQuery} />,
  };

  const summary = data ? postureSummary(data.checks) : null;
  const rows = data ? postureRows(data.checks, severity) : [];
  const maxCount = Math.max(0, ...rows.map((check) => check.status === 'evaluated' ? check.count : 0));

  return <section className="netskope-workspace nsk-posture" aria-label="Postura Netskope">
    <div className="nsk-posture-toolbar">
      <div className="section-title nsk-posture-heading"><ShieldCheck size={17} aria-hidden="true" /><h2 id="nsk-posture-title">Qué está mal y qué hago</h2><HelpHint label="Postura"><p>{HELP}</p></HelpHint></div>
      <div className="nsk-posture-toolbar-end">
        {data ? <SourceContext data={data} /> : null}
        <button type="button" className="button subtle" disabled={panel.loading} onClick={() => void panel.reload()}><RefreshCw size={14} aria-hidden="true" /> Volver a evaluar</button>
      </div>
    </div>
    {panel.loading && !data ? <section className="list-panel database-surface"><StateBlock variant="loading" title="Evaluando la postura Netskope…" /></section>
      : panel.error && !data ? <section className="list-panel database-surface"><StateBlock variant="error" title="No se pudo evaluar la postura Netskope" hint={panel.error} action={<button type="button" className="button subtle" onClick={() => void panel.reload()}>Reintentar</button>} /></section>
      : !data || !summary ? null
      : <>
        <SummaryStats ariaLabel="Totales de postura Netskope" stats={[
          { key: 'total', label: 'Hallazgos', value: formatNumber(summary.total), detail: `${formatNumber(summary.withFindings)} de ${formatNumber(summary.evaluated)} chequeos con hallazgos` },
          ...POSTURE_SEVERITIES.map((key) => ({ key, label: `Severidad ${POSTURE_SEVERITY_LABELS[key].toLowerCase()}`, value: formatNumber(summary.bySeverity[key]) })),
          { key: 'devices', label: 'En equipos', value: summary.evaluatedDevices ? formatNumber(summary.devices) : 'No evaluado', detail: 'Un equipo puede estar en más de un chequeo' },
          { key: 'users', label: 'En usuarios', value: summary.evaluatedUsers ? formatNumber(summary.users) : 'No evaluado', detail: summary.evaluatedUsers ? 'Índice de confianza (UCI)' : 'Sin permiso para confianza de usuarios o captura no habilitada' },
        ]} />
        <section className="list-panel database-surface nsk-posture-surface" aria-label="Hallazgos por chequeo">
          <div className="nsk-posture-filter" role="group" aria-label="Filtrar por severidad">
            <button type="button" className="button subtle" aria-pressed={severity === ''} onClick={() => setSeverity('')}>Todas · {formatNumber(summary.total)}</button>
            {POSTURE_SEVERITIES.map((key) => <button key={key} type="button" className="button subtle" aria-pressed={severity === key} onClick={() => setSeverity(key)}>{POSTURE_SEVERITY_LABELS[key]} · {formatNumber(summary.bySeverity[key])}</button>)}
          </div>
          {!rows.length ? <StateBlock compact variant="empty" title="Sin chequeos con esta severidad" />
            : <div className="compact-table-wrap"><table className="compact-table nsk-posture-table" aria-label="Hallazgos de postura Netskope por chequeo">
              <thead><tr><th>Chequeo</th><th>Hallazgos</th><th>Severidad</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>{rows.map((check) => {
                const evaluated = check.status === 'evaluated';
                const expandable = evaluated && (check.count > 0 || Boolean(details[check.id]));
                const isOpen = expandable && open[check.id] === true;
                const rowsId = `nsk-posture-group-${check.id}`;
                const entity = postureEntityLabel(check, check.count);
                const target = check.entity === 'user' ? 'Usuarios con señales de riesgo' : 'el inventario';
                return <Fragment key={check.id}>
                  <tr className={`nsk-posture-group${isOpen ? ' is-open' : ''}${evaluated ? '' : ' is-pending'}`}>
                    <td>{expandable
                      ? <button type="button" className="nsk-posture-toggle" aria-expanded={isOpen} aria-controls={rowsId} onClick={() => toggle(check.id)}>
                        <ChevronRight size={14} aria-hidden="true" className="nsk-posture-chevron" />
                        <span><strong>{check.title}</strong><span className="nsk-posture-description">{check.description}</span></span>
                      </button>
                      : <span className="nsk-posture-static"><strong>{check.title}</strong><span className="nsk-posture-description">{check.description}</span></span>}</td>
                    <td>{evaluated
                      ? <BarCell label={`${formatNumber(check.count)} ${entity}`} share={maxCount ? check.count / maxCount : 0} muted={!check.count} />
                      : <span className="nsk-posture-status"><StatusBadge tone="neutral">{postureStatusLabel(check)}</StatusBadge><small className="nsk-posture-hint">{posturePendingHint(check)}</small></span>}</td>
                    <td><SeverityBadge severity={check.severity} /></td>
                    <td>{evaluated && check.count ? <button type="button" className="button subtle nsk-posture-drill" onClick={() => drill(check)}><ExternalLink size={13} aria-hidden="true" /> {check.entity === 'user' ? 'Ver usuarios con señales de riesgo' : 'Ver en inventario'}</button> : null}</td>
                  </tr>
                  {isOpen ? <tr id={rowsId} className="nsk-posture-child"><td colSpan={4}>
                    {check.count > 0 ? <>
                      {check.findings.length ? <FindingSample check={check} /> : null}
                      <div className="nsk-posture-more">
                        <span className="muted">{check.count > check.findings.length ? `Se muestran ${formatNumber(check.findings.length)} de ${formatNumber(check.count)}.` : `${formatNumber(check.count)} en total.`}</span>
                        <button type="button" className="button subtle" onClick={() => drill(check)}>Ver {check.count === 1 ? `el ${entity}` : `los ${formatNumber(check.count)} ${entity}`} en {target}</button>
                      </div>
                    </> : null}
                    {details[check.id] ? <div className="nsk-posture-detail">{details[check.id]}</div> : null}
                  </td></tr> : null}
                </Fragment>;
              })}</tbody>
            </table></div>}
          {data.uci_captured_at ? <p className="nsk-posture-footnote">Índice de confianza capturado <DateTime value={data.uci_captured_at} />.</p> : null}
        </section>
      </>}
  </section>;
}
