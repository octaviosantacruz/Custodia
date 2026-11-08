import test from 'node:test';
import assert from 'node:assert/strict';
import { entitySummaries, groupFindingsByRiskType, latestProgress, severityTotals, topRiskTypes } from '../../../src/cyberark/risk_management/lib/cyberark-risk-overview.ts';
import type { CyberarkRiskFinding, CyberarkRiskOverview, CyberarkRiskType } from '../../../src/cyberark/risk_management/lib/cyberark-risk-api.ts';

const type = (id: string, severity: string | null, open: number | null): CyberarkRiskType => ({ risk_type_id: id, name: id, description: null, severity, entity_type: 'user', open_findings: open, status_counts: {}, updated_at: null, recommendation_types: [] });
const overview = (patch: Partial<CyberarkRiskOverview>): CyberarkRiskOverview => ({
  source: 'cyberark_risk_management', fetched_at: '2026-10-10T00:00:00Z',
  summary: { total_findings_by_severity: {}, entity_types: [] }, risk_types: [], remediations: [],
  progress: { total_onboarded_current: null, total_onboarded_through_discovery_current: null, points: [] },
  recommendations_status: 'catalog_options_only', ...patch,
});
const finding = (id: string, risk: string, status: string | null = 'open', last: string | null = null): CyberarkRiskFinding => ({ finding_id: id, risk_type_id: risk, entity_id: `e-${id}`, entity_name: null, entity_type: 'user', severity: 'high', status, first_detected_at: null, last_detected_at: last });

test('severity totals are ordered critical first and drop invalid counts', () => {
  const totals = severityTotals(overview({ summary: { total_findings_by_severity: { low: 1, CRITICAL: 2, high: 3, bogus: -1 }, entity_types: [] } }));
  assert.deepEqual(totals, [{ severity: 'CRITICAL', count: 2 }, { severity: 'high', count: 3 }, { severity: 'low', count: 1 }]);
});

test('entity summaries add every category and leave the critical share unknown without findings', () => {
  const summaries = entitySummaries(overview({ summary: { total_findings_by_severity: {}, entity_types: [
    { entity_type: 'webapp', categories: [] },
    { entity_type: 'user', categories: [{ category: 'a', severity_counts: { critical: 2, high: 3 } }, { category: 'b', severity_counts: { critical: 1, medium: 4 } }] },
  ] } }));
  assert.deepEqual(summaries[0], { entityType: 'user', total: 10, critical: 3, criticalShare: 0.3 });
  assert.deepEqual(summaries[1], { entityType: 'webapp', total: 0, critical: 0, criticalShare: null });
});

test('top risk types put severity before volume and keep unknown counts but not empty types', () => {
  const top = topRiskTypes([type('a', 'medium', 90), type('b', 'critical', 1), type('c', 'high', 0), type('d', 'high', null), type('e', 'high', 5)], 3);
  assert.deepEqual(top.map((item) => item.risk_type_id), ['b', 'e', 'd']);
});

test('latest progress only divides known values of the last point', () => {
  assert.equal(latestProgress(overview({})).share, null);
  const points = [{ date_at: '2026-10-01', total_discovered: 10, total_onboarded: 1 }, { date_at: '2026-10-02', total_discovered: 20, total_onboarded: 5 }];
  assert.equal(latestProgress(overview({ progress: { total_onboarded_current: 5, total_onboarded_through_discovery_current: null, points } })).share, 0.25);
  const unknown = [{ date_at: '2026-10-02', total_discovered: 0, total_onboarded: 5 }];
  assert.equal(latestProgress(overview({ progress: { total_onboarded_current: 5, total_onboarded_through_discovery_current: null, points: unknown } })).share, null);
});

test('findings group by risk type with returned counts, open counts and the latest detection', () => {
  const groups = groupFindingsByRiskType([
    finding('1', 'aged', 'open', '2026-10-01T00:00:00Z'),
    finding('2', 'aged', 'closed', '2026-10-05T00:00:00Z'),
    finding('3', 'aged', 'OPEN', null),
    finding('4', 'compromised'),
    finding('5', 'not-in-catalog'),
  ], [type('aged', 'high', 99), type('compromised', 'critical', 1)]);
  assert.deepEqual(groups.map((group) => group.riskTypeId), ['compromised', 'aged', 'not-in-catalog']);
  const aged = groups[1];
  assert.equal(aged.findings.length, 3);
  assert.equal(aged.openCount, 2);
  assert.equal(aged.lastDetectedAt, '2026-10-05T00:00:00Z');
  assert.deepEqual(aged.findings.map((item) => item.finding_id), ['2', '1', '3']);
  // A risk type missing from the catalog still groups, using the finding's own severity.
  assert.equal(groups[2].riskType, undefined);
  assert.equal(groups[2].severity, 'high');
});
