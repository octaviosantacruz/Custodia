import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeUserDevices } from '../../../src/netskope/sse/lib/netskope-user-devices.ts';

const presence = (objectId: number, name: string) => ({ objectId, name, os: 'Windows', status: 'on-prem', config: 'Default', recent: true, lastSignalAt: null });
const adem = (id: string, inventory: number | null, name: string) => ({ device_id: id, inventory_device_id: inventory, device_name: name, device_os: null, exp_score: 50, device_score: 60, network_score: 70, app_score: 80 });

test('a linked ADEM device merges into its inventory row', () => {
  const rows = mergeUserDevices([presence(1, 'PC-1')], [adem('a', 1, 'pc-1')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].linked, true);
});

test('an ADEM device linked to an inventory device that was not loaded keeps its own row instead of vanishing', () => {
  const rows = mergeUserDevices([presence(1, 'PC-1')], [adem('a', 51, 'pc-51')]);
  assert.deepEqual(rows.map((row) => row.name), ['PC-1', 'pc-51']);
  assert.equal(rows[1].presence, null);
  assert.equal(rows[1].linked, false);
});
