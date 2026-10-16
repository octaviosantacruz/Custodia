import assert from 'node:assert/strict';
import test from 'node:test';

import { actionLabel, businessUnitLabel, dateTimeHint, epochSecondsToIso, formatChartTickLabels, formatDate, nextActionOptions, relativeTime, resultCountLabel, versionListLabel } from '../../src/cross/lib/format.ts';
import { statusLabel, WORKFLOW_STATUSES, workflowLabel, workflowStatusesFor, workflowStatusesFromCounts } from '../../src/cyberark/pam/lib/safe-labels.ts';

test('business unit labels do not repeat identical code and name', () => {
  assert.equal(businessUnitLabel({ unit_code: 'UENO', unit_name: 'UENO' }), 'UENO');
  assert.equal(businessUnitLabel({ unit_code: 'N/A', unit_name: 'No Aplica' }), 'N/A - No Aplica');
  assert.equal(businessUnitLabel({ unit_code: 'FIN', unit_name: 'Finanzas' }), 'FIN - Finanzas');
});

test('daily Safe workflow offers the decision states, including a decommission held by CyberArk retention', () => {
  assert.deepEqual(WORKFLOW_STATUSES, ['pending', 'in_progress', 'retention_hold', 'resolved']);
  assert.equal(workflowLabel('retention_hold'), 'Baja retenida');
  assert.deepEqual(workflowStatusesFor('pending'), WORKFLOW_STATUSES);
  assert.equal(workflowLabel('in_progress'), 'En curso');
  assert.equal(statusLabel('assigned'), 'Asignada');
});

test('legacy workflow values remain visible without becoming new choices', () => {
  assert.deepEqual(workflowStatusesFor('blocked'), ['pending', 'in_progress', 'retention_hold', 'resolved', 'blocked']);
  assert.deepEqual(workflowStatusesFor('retired'), ['pending', 'in_progress', 'retention_hold', 'resolved', 'retired']);
});

test('Safe review and decommission actions remain distinct', () => {
  assert.deepEqual(nextActionOptions, ['Migrar a SIA', 'Consultar', 'Revisar', 'Dar de baja', 'Rotar credencial']);
  assert.equal(actionLabel('revisar'), 'Revisar');
  assert.equal(actionLabel('dar de baja'), 'Dar de baja');
  assert.equal(actionLabel('Revisar / Dar de baja'), 'Revisar');
});

test('filter states follow observed counts and expose retired Safes when present', () => {
  assert.deepEqual(workflowStatusesFromCounts([
    { key: 'pending', count: 3 },
    { key: 'retired', count: 1 },
    { key: 'blocked', count: 0 },
  ]), ['pending', 'retired']);
  assert.deepEqual(workflowStatusesFromCounts([], 'retired'), ['retired']);
  assert.deepEqual(workflowStatusesFromCounts([{ key: 'retention_hold', count: 2 }]), ['retention_hold']);
});

test('resultCountLabel pluralizes and locale-formats the count consistently across workspaces', () => {
  assert.equal(resultCountLabel(0), '0 resultados');
  assert.equal(resultCountLabel(1), '1 resultado');
  assert.equal(resultCountLabel(2), '2 resultados');
  assert.equal(resultCountLabel(12345), '12.345 resultados');
});

test('relative-time fragments use lowercase after sentence text', () => {
  assert.equal(relativeTime(new Date(Date.now() - 20_000).toISOString()), 'hace instantes');
  assert.equal(relativeTime(new Date(Date.now() - 185_000).toISOString()), 'hace 3 min');
});

test('date-only values keep their calendar day in a western timezone and invalid dates stay explicit', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Asuncion';
  try {
    assert.equal(formatDate('2026-10-07'), '7 oct 2026');
    assert.equal(formatDate('invalid'), 'Sin dato');
    assert.equal(formatDate(null), 'Sin dato');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('component versions hide the 0.0.0.0 placeholder', () => {
  assert.equal(versionListLabel(['0.0.0.0', '14.9.2.69']), '14.9.2.69');
  assert.equal(versionListLabel(['0.0.0.0']), 'Sin versión observada');
  assert.equal(versionListLabel([]), 'Sin versión observada');
  assert.equal(versionListLabel(null), 'Sin versión observada');
  assert.equal(versionListLabel(['14.4.0.27', '14.9.0.55']), '14.4.0.27, 14.9.0.55');
});

/* UX-AUD-012: the inventory-trend axis repeated the same date when several
   runs happened on one day. The formatter is timezone-agnostic in the test:
   it asserts the shape (HH:MM vs dd/mm) and that intraday ticks differ. */
test('chart ticks show time for an intraday window and date across days', () => {
  const intraday = formatChartTickLabels(['2026-09-26 04:00:00+00:00', '2026-09-26 05:30:00+00:00', '2026-09-26 07:15:00+00:00']);
  assert.ok(intraday.every((label) => /^\d{2}:\d{2}$/.test(label)), intraday.join(', '));
  assert.equal(new Set(intraday).size, 3, 'intraday ticks must not repeat');

  const acrossDays = formatChartTickLabels(['2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z']);
  assert.ok(acrossDays.every((label) => /^\d{2}\/\d{2}$/.test(label)), acrossDays.join(', '));

  const multiRunDays = formatChartTickLabels([
    '2026-10-06T02:00:00Z', '2026-10-06T05:00:00Z', '2026-10-06T08:00:00Z',
    '2026-10-06T11:00:00Z', '2026-10-07T02:00:00Z', '2026-10-07T05:00:00Z',
  ]);
  assert.ok(multiRunDays.every((label) => /^\d{2}\/\d{2} \d{2}:\d{2}$/.test(label)), multiRunDays.join(', '));
  assert.equal(new Set(multiRunDays).size, 6, 'multiple runs across days keep their time');

  const withinMinute = formatChartTickLabels(['2026-10-06T02:00:01Z', '2026-10-06T02:00:30Z']);
  assert.ok(withinMinute.every((label) => /^\d{2}:\d{2}:\d{2}$/.test(label)), withinMinute.join(', '));
  assert.equal(new Set(withinMinute).size, 2, 'runs within a minute keep their seconds');

  // A date-only label cannot invent a time; it stays a day label.
  assert.ok(formatChartTickLabels(['2026-09-26', '2026-09-26']).every((label) => /^\d{2}\/\d{2}$/.test(label)));

  // Non-timestamp labels pass through untouched.
  assert.deepEqual(formatChartTickLabels(['Ueno', 'ITTI']), ['Ueno', 'ITTI']);
  assert.deepEqual(formatChartTickLabels([]), []);
});


test('UX-AUD2-009 date hints distinguish future, past and unknown values', () => {
  assert.equal(dateTimeHint(new Date(Date.now() + 5 * 60000).toISOString()), 'en 5 min');
  assert.equal(dateTimeHint(new Date(Date.now() - 5 * 60000).toISOString()), 'hace 5 min');
  for (const value of [null, undefined, '', 'invalid']) assert.equal(dateTimeHint(value), 'Sin fecha');
});

test('UX-AUD2-009 declared epoch seconds retain zero and reject absent or invalid observations', () => {
  assert.equal(epochSecondsToIso(0), '1970-01-01T00:00:00.000Z');
  assert.equal(epochSecondsToIso(1789045249), '2026-09-10T13:00:49.000Z');
  for (const value of [null, undefined, NaN, Infinity, 1e20]) assert.equal(epochSecondsToIso(value), null);
});
