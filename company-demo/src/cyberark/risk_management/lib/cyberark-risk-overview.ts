/* Derived views over the CyberArk Risk Management overview. Every number
   comes from a count CyberArk reported; when a count is missing the result is
   null so the UI shows "Sin dato" instead of a fabricated zero. */
import type { CyberarkRiskFinding, CyberarkRiskOverview, CyberarkRiskType } from './cyberark-risk-api';

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function severityRank(severity: string | null): number {
  return SEVERITY_RANK[(severity || '').trim().toLowerCase()] ?? 4;
}

function validCounts(counts: Record<string, number> | undefined): Array<[string, number]> {
  return Object.entries(counts || {}).filter(([, count]) => Number.isFinite(count) && count >= 0);
}

export type SeverityCount = { severity: string; count: number };

/** Severity totals ordered critical → low; unknown severities keep their literal at the end. */
export function severityTotals(overview: CyberarkRiskOverview): SeverityCount[] {
  return validCounts(overview.summary.total_findings_by_severity)
    .map(([severity, count]) => ({ severity, count }))
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
}

export type EntityRiskSummary = { entityType: string; total: number; critical: number; criticalShare: number | null };

/** Findings per entity type, summed from the per-category severity counts. */
export function entitySummaries(overview: CyberarkRiskOverview): EntityRiskSummary[] {
  return overview.summary.entity_types.map((entity) => {
    let total = 0;
    let critical = 0;
    for (const category of entity.categories) {
      for (const [severity, count] of validCounts(category.severity_counts)) {
        total += count;
        if (severity.trim().toLowerCase() === 'critical') critical += count;
      }
    }
    return { entityType: entity.entity_type, total, critical, criticalShare: total > 0 ? critical / total : null };
  }).sort((left, right) => right.total - left.total);
}

/** Risk types worth looking at first: most severe, then most open findings. */
export function topRiskTypes(riskTypes: CyberarkRiskType[], limit = 5): CyberarkRiskType[] {
  return [...riskTypes]
    .filter((item) => item.open_findings === null || item.open_findings > 0)
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity)
      || (right.open_findings ?? -1) - (left.open_findings ?? -1))
    .slice(0, limit);
}

export type ProgressSnapshot = { discovered: number | null; onboarded: number | null; share: number | null; dateAt: string | null };

/** Last reported progress point and the onboarded share of what was discovered. */
export function latestProgress(overview: CyberarkRiskOverview): ProgressSnapshot {
  const point = overview.progress.points.at(-1);
  if (!point) return { discovered: null, onboarded: null, share: null, dateAt: null };
  const share = point.total_discovered && point.total_onboarded !== null ? point.total_onboarded / point.total_discovered : null;
  return { discovered: point.total_discovered, onboarded: point.total_onboarded, share, dateAt: point.date_at };
}

export type RiskFindingGroup = {
  riskTypeId: string;
  riskType: CyberarkRiskType | undefined;
  severity: string | null;
  entityType: string | null;
  findings: CyberarkRiskFinding[];
  openCount: number;
  lastDetectedAt: string | null;
};

/** Groups findings by risk type: most severe first, then the largest groups.
 *  Counts are the findings actually returned, never the catalog estimate. */
export function groupFindingsByRiskType(findings: CyberarkRiskFinding[], riskTypes: CyberarkRiskType[]): RiskFindingGroup[] {
  const catalog = new Map(riskTypes.map((item) => [item.risk_type_id, item]));
  const groups = new Map<string, RiskFindingGroup>();
  for (const finding of findings) {
    let group = groups.get(finding.risk_type_id);
    if (!group) {
      const riskType = catalog.get(finding.risk_type_id);
      group = { riskTypeId: finding.risk_type_id, riskType, severity: riskType?.severity ?? finding.severity, entityType: riskType?.entity_type ?? finding.entity_type, findings: [], openCount: 0, lastDetectedAt: null };
      groups.set(finding.risk_type_id, group);
    }
    group.findings.push(finding);
    if ((finding.status || '').trim().toLowerCase() === 'open') group.openCount += 1;
    if (finding.last_detected_at && (!group.lastDetectedAt || finding.last_detected_at > group.lastDetectedAt)) group.lastDetectedAt = finding.last_detected_at;
  }
  for (const group of groups.values()) {
    group.findings.sort((left, right) => (right.last_detected_at ?? '').localeCompare(left.last_detected_at ?? ''));
  }
  return [...groups.values()].sort((left, right) => severityRank(left.severity) - severityRank(right.severity)
    || right.findings.length - left.findings.length);
}
