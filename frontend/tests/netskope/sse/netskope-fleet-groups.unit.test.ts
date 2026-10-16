import assert from 'node:assert/strict';
import test from 'node:test';
import { fleetColumn, fleetPercent, fleetShare } from '../../../src/netskope/sse/lib/netskope-fleet-groups.ts';

const counts = { devices: 10, signal_24h: 9, client_current: 6, client_evaluated: 8, os_supported: 0, os_evaluated: 0, on_prem: 2, location_reported: 4 };

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
