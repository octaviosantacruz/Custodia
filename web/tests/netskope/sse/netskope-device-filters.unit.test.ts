import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_NETSKOPE_DEVICE_FILTERS, netskopeDevicesQuery, netskopeInventoryLocation } from '../../../src/netskope/sse/lib/netskope-device-filters.ts';

test('inventory links restore exact filters, including historical device bookmarks', () => {
  const restored = netskopeInventoryLocation('?observed_user_id=3&evidence_state=review&q=NB&os=Windows', '/netskope/inventory');
  assert.equal(restored.query.freshness, 'all');
  const params = new URLSearchParams(netskopeDevicesQuery(restored.search, 0, restored.query.filters, restored.query.eventAge, restored.query.change, restored.query.clientCompliance, restored.query.osCompliance, restored.query.duplicate, restored.query.freshness, restored.query.coverageRisk, restored.query));
  assert.equal(params.get('observed_user_id'), '3');
  assert.equal(params.get('evidence_state'), 'review');
  assert.equal(params.get('q'), 'NB');
  assert.equal(params.get('os'), 'Windows');
  // NSK-HB-001: a bookmark with the retired heartbeat filter opens the inventory without it.
  const old = netskopeInventoryLocation('?heartbeat=inactive&event_age=gt_30d', '/netskope/inventory');
  assert.equal('heartbeat' in old.query, false);
  assert.equal(old.query.eventAge, 'gt_30d');
  const historical = netskopeInventoryLocation('?type=netskope_user&id=3&trail=netskope_user:3>netskope_device:59', '/netskope/chains');
  assert.equal(historical.query.deviceObjectId, 59);
  assert.equal(historical.query.observedUserId, undefined);
  assert.equal(historical.query.freshness, 'all');
  assert.equal(netskopeInventoryLocation('?type=netskope_user&id=3', '/netskope/chains').query.observedUserId, 3);
  for (const id of ['0', '-1', 'abc', '9007199254740993']) assert.equal(netskopeInventoryLocation(`?observed_user_id=${id}`, '/netskope/inventory').query.observedUserId, undefined);
});

test('device query only sends the filters that are set, URL-encoded', () => {
  const query = new URLSearchParams(netskopeDevicesQuery('laptop', 2, {
    ...EMPTY_NETSKOPE_DEVICE_FILTERS, os: 'Mac OS X', company: 'Acme', user_status: 'Sin dato',
  }));
  assert.equal(query.get('offset'), '100');
  assert.equal(query.get('q'), 'laptop');
  assert.equal(query.has('heartbeat'), false);
  assert.equal(query.get('os'), 'Mac OS X');
  assert.equal(query.get('company'), 'Acme');
  assert.equal(query.get('user_status'), 'Sin dato');
  assert.equal(query.has('client_version'), false);
  assert.equal(query.has('classification_status'), false);
});

test('device query without filters keeps the previous contract', () => {
  const query = new URLSearchParams(netskopeDevicesQuery('', 0));
  assert.deepEqual([...query.keys()], ['limit', 'offset', 'q']);
});

test('event age travels as its own parameter and counts as an active filter', async () => {
  const { EMPTY_NETSKOPE_DEVICE_QUERY, isNetskopeDeviceQueryActive } = await import('../../../src/netskope/sse/lib/netskope-device-filters.ts');
  const query = new URLSearchParams(netskopeDevicesQuery('', 0, EMPTY_NETSKOPE_DEVICE_FILTERS, 'gt_30d'));
  assert.equal(query.get('event_age'), 'gt_30d');
  assert.equal(isNetskopeDeviceQueryActive(EMPTY_NETSKOPE_DEVICE_QUERY), false);
  assert.equal(isNetskopeDeviceQueryActive({ ...EMPTY_NETSKOPE_DEVICE_QUERY, eventAge: 'unknown' }), true);
});

test('NSK-XMET-003: users query sends activity_days only when a window is selected', async () => {
  const { netskopeUsersQuery, isNetskopeUsersFiltersActive, EMPTY_NETSKOPE_USERS_FILTERS } = await import('../../../src/netskope/sse/lib/netskope-device-filters.ts');
  assert.equal(new URLSearchParams(netskopeUsersQuery('', 0)).has('activity_days'), false);
  assert.equal(isNetskopeUsersFiltersActive(EMPTY_NETSKOPE_USERS_FILTERS), false);
  for (const days of [7, 14, 30] as const) {
    const filters = { ...EMPTY_NETSKOPE_USERS_FILTERS, activityDays: days };
    assert.equal(new URLSearchParams(netskopeUsersQuery('', 0, filters)).get('activity_days'), String(days));
    assert.equal(isNetskopeUsersFiltersActive(filters), true);
  }
});
