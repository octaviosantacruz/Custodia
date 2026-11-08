import test from 'node:test';
import assert from 'node:assert/strict';
import { ageLabel, daysSince, engineLabel, osLabel, policyTargetSummary } from '../../../src/cyberark/sia/lib/sia-format.ts';

test('policy destinations are counted exactly as SIA declares them', () => {
  const summary = policyTargetSummary({
    ip_rules: [{ ipAddresses: ['10.0.0.1', '10.0.0.2'], operator: 'EXACTLY' }, '10.0.0.2', { ipAddresses: 'not-a-list' }],
    fqdn_rules: [{ computernamePattern: 'db-*', domain: 'corp.example' }],
    logical_names: [{ logicalName: 'finance' }, 'ops'],
  });
  // Duplicated IPs across rules are counted once; malformed rules add nothing.
  assert.deepEqual(summary.ips, ['10.0.0.1', '10.0.0.2']);
  assert.equal(summary.fqdnCount, 1);
  assert.equal(summary.firstFqdn, 'db-*.corp.example');
  assert.equal(summary.logicalCount, 2);
  assert.equal(summary.firstLogical, 'finance');
});

test('a policy without rules reports no destination instead of inventing one', () => {
  const summary = policyTargetSummary({ ip_rules: [], fqdn_rules: [], logical_names: [] });
  assert.deepEqual(summary, { ips: [], fqdnCount: 0, firstFqdn: '', logicalCount: 0, firstLogical: '' });
  assert.deepEqual(policyTargetSummary({}).ips, []);
});

test('scan age is whole days and unparseable dates stay unknown', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  assert.equal(daysSince('2026-10-10T01:00:00Z', now), 0);
  assert.equal(daysSince('2026-10-01T12:00:00Z', now), 9);
  assert.equal(daysSince('', now), null);
  assert.equal(daysSince('not-a-date', now), null);
  // A clock skew into the future never shows a negative age.
  assert.equal(daysSince('2026-10-11T12:00:00Z', now), 0);
  assert.equal(ageLabel(0), 'hoy');
  assert.equal(ageLabel(1), 'hace 1 día');
  assert.equal(ageLabel(45), 'hace 45 días');
  assert.equal(ageLabel(90), 'hace 3 meses');
  assert.equal(ageLabel(800), 'hace 2 años');
});

test('OS and discovery labels only relabel known values and keep the rest verbatim', () => {
  assert.equal(osLabel('linux'), 'Linux');
  assert.equal(osLabel('Windows'), 'Windows');
  assert.equal(osLabel('solaris'), 'solaris');
  assert.equal(engineLabel('aws'), 'AWS');
  assert.equal(engineLabel('Discovery'), 'Discovery');
  assert.equal(engineLabel(undefined), '');
});
