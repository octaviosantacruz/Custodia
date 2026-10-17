import assert from 'node:assert/strict';
import test from 'node:test';
import { netskopeInventoryLocation } from '../../../src/netskope/sse/lib/netskope-device-filters.ts';
import { netskopeFilterChips } from '../../../src/netskope/sse/lib/netskope-filter-chips.ts';
import { presenceStatusLabel } from '../../../src/netskope/sse/lib/netskope-presence.ts';

test('NSK-EXP-ONPREM-001: a record without the field is "Sin dato", and no data yet is not "remote"', () => {
  assert.equal(presenceStatusLabel('Sin dato'), 'Sin dato');
  assert.equal(presenceStatusLabel('off-prem'), 'Fuera de oficina');
  assert.equal(presenceStatusLabel('something-new'), 'something-new');
});

test('NSK-EXP-ONPREM-001: an office drill reaches the inventory with exactly its filters and a removable chip', () => {
  const url = new URL('/netskope/inventory?onprem_status=off-prem&client_config=Default+tenant+config', 'http://custodia.test');
  assert.equal(url.pathname, '/netskope/inventory');
  const location = netskopeInventoryLocation(url.search, url.pathname);
  assert.equal(location.query.filters.onprem_status, 'off-prem');
  assert.equal(location.query.filters.client_config, 'Default tenant config');
  assert.equal(location.query.freshness, 'recent');
  const chips = netskopeFilterChips(location.query, { evidenceState: {}, change: {}, clientCompliance: {}, osCompliance: {} }).map((chip) => chip.label);
  assert.ok(chips.includes('Ubicación: Fuera de oficina'));
  assert.ok(chips.includes('Client config: Default tenant config'));
});
