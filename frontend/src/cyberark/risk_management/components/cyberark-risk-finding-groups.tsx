import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { DateTime } from '../../../cross/components/date-time';
import { StatusBadge } from '../../../cross/components/semantic';
import { formatNumber } from '../../../cross/lib/format';
import type { CyberarkRiskFinding, CyberarkRiskType } from '../lib/cyberark-risk-api';
import { cyberarkEntityLabel, cyberarkRiskDescription, cyberarkRiskName, cyberarkSeverityLabel, cyberarkStatusLabel, cyberarkStatusTone } from '../lib/cyberark-risk-labels';
import { groupFindingsByRiskType } from '../lib/cyberark-risk-overview';
import { cyberarkSeverityTone } from './cyberark-risk-panel';
import './cyberark-risk-finding-groups.css';

/** Large groups show their first findings and reveal the rest on demand, so
 *  one noisy risk type never pushes every other group off the screen. */
const VISIBLE_PER_GROUP = 10;

function entityCell(finding: CyberarkRiskFinding, entityNamesVisible: boolean) {
  const label = entityNamesVisible ? finding.entity_name || 'Sin nombre informado' : cyberarkEntityLabel(finding.entity_type);
  const context = entityNamesVisible ? `${cyberarkEntityLabel(finding.entity_type)} · ${finding.entity_id}` : finding.entity_id;
  return { label, context };
}

/* Table rows (inside the shared findings <tbody>): one summary row per risk
   type, expandable to the findings CyberArk returned for it. */
export function CyberarkRiskFindingGroups({ findings, riskTypes, entityNamesVisible, onSelect }: {
  findings: CyberarkRiskFinding[];
  riskTypes: CyberarkRiskType[];
  entityNamesVisible: boolean;
  onSelect: (finding: CyberarkRiskFinding) => void;
}) {
  const groups = useMemo(() => groupFindingsByRiskType(findings, riskTypes), [findings, riskTypes]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  return <>{groups.map((group) => {
    const isOpen = expanded[group.riskTypeId] === true;
    const name = cyberarkRiskName(group.riskType?.name || group.riskTypeId);
    const description = cyberarkRiskDescription(group.riskType?.description ?? null);
    const rowsId = `risk-group-${group.riskTypeId}`;
    const visible = showAll[group.riskTypeId] ? group.findings : group.findings.slice(0, VISIBLE_PER_GROUP);
    const toggle = () => setExpanded((current) => ({ ...current, [group.riskTypeId]: !isOpen }));
    return [
      <tr key={`group:${group.riskTypeId}`} className={`posture-row risk-group-row${isOpen ? ' is-open' : ''}`} onClick={toggle}>
        <td><button type="button" className="risk-group-toggle" aria-expanded={isOpen} aria-controls={rowsId} onClick={(event) => { event.stopPropagation(); toggle(); }}>
          <ChevronRight size={14} aria-hidden="true" className="risk-group-chevron" />
          <span><strong>{name}</strong>{description ? <span className="risk-group-description">{description}</span> : null}<small className="posture-source-label">CyberArk Risk Management · {group.riskTypeId}</small></span>
        </button></td>
        <td><span className="risk-group-count"><strong>{formatNumber(group.findings.length)}</strong> {group.findings.length === 1 ? 'hallazgo' : 'hallazgos'}</span><small>{cyberarkEntityLabel(group.entityType)}</small></td>
        <td><span className="posture-review-action">Ver recomendaciones de CyberArk</span></td>
        <td><StatusBadge tone={cyberarkSeverityTone(group.severity)}>{cyberarkSeverityLabel(group.severity).label}</StatusBadge></td>
        <td>{group.openCount === group.findings.length
          ? <StatusBadge tone="danger">{group.openCount === 1 ? 'Abierto' : `${formatNumber(group.openCount)} abiertos`}</StatusBadge>
          : <span className="risk-group-status">{formatNumber(group.openCount)} de {formatNumber(group.findings.length)} abiertos</span>}</td>
        <td>{group.lastDetectedAt ? <DateTime value={group.lastDetectedAt} /> : <span className="muted">Sin dato</span>}</td>
      </tr>,
      ...(isOpen ? visible.map((finding) => {
        const entity = entityCell(finding, entityNamesVisible);
        return <tr key={`risk:${finding.finding_id}`} id={finding === visible[0] ? rowsId : undefined} className="posture-row risk-group-child" onClick={() => onSelect(finding)}>
          <td><button type="button" className="posture-row-link risk-group-child-link" aria-label={`Ver hallazgo ${finding.finding_id} de ${name}`} onClick={(event) => { event.stopPropagation(); onSelect(finding); }}>{entity.label}<small>{finding.finding_id}</small></button></td>
          <td><span className="muted">{entity.context}</span></td>
          <td><span className="posture-review-action">Ver detalle</span></td>
          <td><StatusBadge tone={cyberarkSeverityTone(finding.severity)}>{cyberarkSeverityLabel(finding.severity).label}</StatusBadge></td>
          <td><StatusBadge tone={cyberarkStatusTone(finding.status)}>{cyberarkStatusLabel(finding.status).label}</StatusBadge></td>
          <td><DateTime value={finding.last_detected_at} /></td>
        </tr>;
      }) : []),
      ...(isOpen && group.findings.length > visible.length ? [<tr key={`more:${group.riskTypeId}`} className="risk-group-more"><td colSpan={6}>
        <button type="button" className="button subtle" onClick={() => setShowAll((current) => ({ ...current, [group.riskTypeId]: true }))}>Mostrar los {formatNumber(group.findings.length - visible.length)} restantes de {name}</button>
      </td></tr>] : []),
    ];
  })}</>;
}
