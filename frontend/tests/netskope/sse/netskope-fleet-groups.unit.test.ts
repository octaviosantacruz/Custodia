import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFICE_LOW_UCI_DRILL, fleetColumn, fleetDrillQuery, fleetGroupKeyLabel, fleetPercent, fleetShare } from '../../../src/netskope/sse/lib/netskope-fleet-groups.ts';

const counts = { devices: 10, signal_24h: 9, client_current: 6, client_evaluated: 8, client_one_behind: 0, client_two_plus_behind: 0, os_supported: 0, os_evaluated: 0, on_prem: 2, location_reported: 4, uci_low: 1, uci_moderate: 0, uci_evaluated: 5, on_prem_uci_low: 1 };

test('NSK-FLEET-001 a column without a denominator reads Sin dato, never 0 %', () => {
  assert.equal(fleetShare(0, 0), null);
  assert.equal(fleetPercent(fleetShare(0, 0)), 'Sin dato');
  assert.equal(fleetPercent(fleetShare(9, 10)), '90 %');
});

test('NSK-FLEET-001 each column uses its own denominator', () => {
  assert.deepEqual(fleetColumn(counts, 'signal'), { count: 9, total: 10 });
  assert.deepEqual(fleetColumn(counts, 'client'), { count: 6, total: 8 });
  assert.deepEqual(fleetColumn(counts, 'os'), { count: 0, total: 0 });
  assert.deepEqual(fleetColumn(counts, 'office'), { count: 2, total: 4 });
});

test('NSK-EXP-UCI-001 the UCI column uses the evaluated devices and drills to the exact Poor filter', () => {
  assert.deepEqual(fleetColumn(counts, 'uci'), { count: 1, total: 5 });
  assert.equal(fleetColumn({ ...counts, uci_low: 0, uci_evaluated: 0 }, 'uci').total, 0);
  assert.equal(fleetDrillQuery('company', 'ACME', 'uci').filters.uci_rating, 'Poor');
  assert.equal(fleetDrillQuery('uci_rating', 'Sin alerta').filters.uci_rating, 'Sin alerta');
  assert.deepEqual([OFFICE_LOW_UCI_DRILL.filters.onprem_status, OFFICE_LOW_UCI_DRILL.filters.uci_rating], ['on-prem', 'Poor']);
});

test('NSK-EXP-UCI-001 group keys read in plain language while the filter keeps the exact value', () => {
  assert.equal(fleetGroupKeyLabel('uci_rating', 'Poor'), 'Bajo');
  assert.equal(fleetGroupKeyLabel('onprem_status', 'on-prem'), 'En oficina');
  assert.equal(fleetGroupKeyLabel('company', 'ACME'), 'ACME');
});

test('NSK-FLEET-003 the golden severity columns share the evaluated denominator and drill to their bucket', () => {
  const withGap = { ...counts, client_evaluated: 8, client_one_behind: 1, client_two_plus_behind: 1 };
  assert.deepEqual(fleetColumn(withGap, 'client_one'), { count: 1, total: 8 });
  assert.deepEqual(fleetColumn(withGap, 'client_two'), { count: 1, total: 8 });
  assert.equal(fleetDrillQuery('company', 'ACME', 'client_one').clientCompliance, 'one_behind');
  assert.equal(fleetDrillQuery('company', 'ACME', 'client_two').clientCompliance, 'two_plus_behind');
});
