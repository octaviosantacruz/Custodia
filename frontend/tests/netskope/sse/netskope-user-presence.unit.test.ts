import assert from 'node:assert/strict';
import test from 'node:test';
import { sortUserDevices, userDevicePresence, userPresenceVerdict } from '../../../src/netskope/sse/lib/netskope-user-presence.ts';
import type { NetskopeRow } from '../../../src/netskope/sse/types/netskope.ts';

const row = (id: number, status: string | null, state: 'recent' | 'not_recent' | 'review' | 'unknown' = 'recent', name = `PC-${id}`): NetskopeRow => ({
  object_id: id, display_name: name, source_id: `dev-${id}`, first_seen_at: '', last_seen_at: '',
  attributes: { os: 'Windows', os_version: '11', ...(status === null ? {} : { onprem_status: status, client_config: 'Default tenant config' }) },
  device_evidence: { state, last_signal_at: '2026-10-10T10:00:00Z' } as NetskopeRow['device_evidence'],
});
const verdict = (...rows: NetskopeRow[]) => userPresenceVerdict(rows.map(userDevicePresence));

test('a user is in office when any device with a recent signal is on-prem', () => {
  assert.equal(verdict(row(1, 'off-prem'), row(2, 'on-prem')), 'office');
  assert.equal(verdict(row(1, 'on-prem', 'not_recent'), row(2, 'off-prem')), 'remote');
});

test('outside the office only when Netskope classified a recent device as off-prem', () => {
  assert.equal(verdict(row(1, 'off-prem')), 'remote');
  assert.equal(verdict(row(1, 'off-prem'), row(2, 'Unknown')), 'remote');
  assert.equal(verdict(row(1, 'Unknown')), 'unknown');
  assert.equal(verdict(row(1, 'unconfig')), 'unknown');
});

test('a device whose location was not stored yet is "unknown", never remote', () => {
  assert.equal(verdict(row(1, null)), 'unknown');
  assert.equal(userDevicePresence(row(1, null)).status, '');
});

test('without recent signal or devices the verdict says so', () => {
  assert.equal(verdict(row(1, 'off-prem', 'not_recent'), row(2, 'on-prem', 'review')), 'no_recent');
  assert.equal(verdict(), 'no_devices');
});

test('recent devices are listed first', () => {
  const devices = [row(1, 'off-prem', 'not_recent', 'AAA'), row(2, 'on-prem', 'recent', 'ZZZ'), row(3, 'off-prem', 'recent', 'MMM')].map(userDevicePresence);
  assert.deepEqual(sortUserDevices(devices).map((device) => device.name), ['MMM', 'ZZZ', 'AAA']);
});
