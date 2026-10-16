import assert from 'node:assert/strict';
import test from 'node:test';
import { netskopeInventoryLocation } from '../../../src/netskope/sse/lib/netskope-device-filters.ts';
import { postureDrill, postureRows, postureStatusLabel, postureSummary } from '../../../src/netskope/sse/lib/netskope-posture-checks.ts';
import type { NetskopePostureCheck } from '../../../src/netskope/sse/types/netskope.ts';

const check = (over: Partial<NetskopePostureCheck>): NetskopePostureCheck => ({
  id: 'client_protection_off', entity: 'device', severity: 'high', title: 'Cliente desinstalado', description: '',
  status: 'evaluated', count: 0, query: { coverage_risk: '1' }, findings: [], ...over,
});

test('NSK-POSTURE-001: the summary adds only evaluated checks and lists the pending ones apart', () => {
  const summary = postureSummary([
    check({ count: 3 }),
    check({ id: 'stale_undiagnosed', severity: 'medium', count: 5, query: { event_age: 'gt_30d', review_diagnosis: 'undetermined' } }),
    check({ id: 'client_one_behind', severity: 'low', status: 'not_configured', count: 0 }),
    check({ id: 'uci_poor', entity: 'user', status: 'not_permitted', count: 0 }),
    check({ id: 'uci_moderate', entity: 'user', severity: 'medium', count: 2, query: { rating: 'Moderate' } }),
    check({ id: 'duplicate_hostname', severity: 'low', count: 0 }),
  ]);
  assert.equal(summary.total, 10);
  assert.deepEqual(summary.bySeverity, { high: 3, medium: 7, low: 0 });
  assert.equal(summary.devices, 8);
  assert.equal(summary.users, 2);
  assert.equal(summary.evaluated, 4);
  assert.equal(summary.withFindings, 3);
  assert.deepEqual(summary.pending.map((item) => item.id), ['client_one_behind', 'uci_poor']);
});

test('NSK-POSTURE-001: one list — findings first (most severe, then largest), then checked with none, then not evaluated', () => {
  const groups = postureRows([
    check({ id: 'a', severity: 'low', count: 50 }),
    check({ id: 'b', severity: 'high', count: 1 }),
    check({ id: 'c', severity: 'medium', count: 9 }),
    check({ id: 'd', severity: 'medium', count: 12 }),
    check({ id: 'e', severity: 'high', count: 0 }),
    check({ id: 'f', severity: 'high', status: 'not_configured', count: 4 }),
  ]);
  assert.deepEqual(groups.map((item) => item.id), ['b', 'd', 'c', 'a', 'e', 'f']);
  assert.deepEqual(postureRows([check({ id: 'a', severity: 'low', count: 2 }), check({ id: 'b', count: 1 })], 'low').map((item) => item.id), ['a']);
});

test('NSK-POSTURE-001: a device drill opens the inventory with the check filters over the whole inventory', () => {
  const stale = postureDrill(check({ query: { event_age: 'gt_30d', review_diagnosis: 'undetermined' } }));
  assert.equal(stale.view, 'netskopeInventory');
  const url = new URL(stale.path, 'http://dshub.test');
  assert.equal(url.pathname, '/netskope/inventory');
  const location = netskopeInventoryLocation(url.search, url.pathname);
  assert.equal(location.query.freshness, 'all');
  assert.equal(location.query.eventAge, 'gt_30d');
  assert.equal(location.query.reviewDiagnosis, 'undetermined');
  const coverage = netskopeInventoryLocation(new URL(postureDrill(check({})).path, 'http://dshub.test').search, '/netskope/inventory');
  assert.equal(coverage.query.coverageRisk, '1');
  const compliance = netskopeInventoryLocation(new URL(postureDrill(check({ query: { client_compliance: 'two_plus_behind' } })).path, 'http://dshub.test').search, '/netskope/inventory');
  assert.equal(compliance.query.clientCompliance, 'two_plus_behind');
  assert.deepEqual(postureDrill(check({ entity: 'user', query: { rating: 'Poor' } })), { view: 'netskopeUci', path: '/netskope/uci' });
});

test('NSK-POSTURE-001: a pending check says what it is missing', () => {
  assert.equal(postureStatusLabel(check({ id: 'os_below_minimum', status: 'not_configured' })), 'Sin versiones mínimas de SO configuradas');
  assert.equal(postureStatusLabel(check({ id: 'client_one_behind', status: 'not_configured' })), 'Sin releases golden configuradas');
  assert.equal(postureStatusLabel(check({ entity: 'user', status: 'not_permitted' })), 'Requiere el permiso para confianza de usuarios');
  assert.equal(postureStatusLabel(check({ entity: 'user', status: 'not_configured' })), 'Captura de confianza de usuarios no habilitada');
});

test('UX-QA-002: an entity whose checks were all pending reports none evaluated, not zero findings', () => {
  const pending = postureSummary([
    check({ count: 3 }),
    check({ id: 'uci_poor', entity: 'user', status: 'not_permitted' }),
    check({ id: 'uci_moderate', entity: 'user', status: 'not_configured' }),
  ]);
  assert.equal(pending.evaluatedDevices, 1);
  assert.equal(pending.evaluatedUsers, 0);
  assert.equal(pending.users, 0);
  const evaluated = postureSummary([check({ id: 'uci_poor', entity: 'user', count: 0 })]);
  assert.equal(evaluated.evaluatedUsers, 1);
  assert.equal(evaluated.evaluatedDevices, 0);
});
