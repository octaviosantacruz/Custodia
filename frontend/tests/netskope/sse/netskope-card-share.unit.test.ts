import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { netskopeCardShare, netskopeShareLabel, netskopeUsersReference, netskopeUsersSplit } from '../../../src/netskope/sse/lib/netskope-dashboard.ts';

describe('NSK-BOARD-001 a card says what share of its population it is', () => {
  it('never rounds a partial figure to the extremes', () => {
    assert.equal(netskopeShareLabel(0, 10), '0 %');
    assert.equal(netskopeShareLabel(10, 10), '100 %');
    assert.equal(netskopeShareLabel(9990, 10000), '>99 %');
    assert.equal(netskopeShareLabel(4, 10000), '<1 %');
    assert.equal(netskopeShareLabel(1, 3), '33 %');
  });

  it('separates resolved and unresolved, which otherwise repeat the same number', () => {
    const metrics = { devices_total: 4577, users_total: 8919, devices_stale_30d: 4038, devices_observed_user_matched: 4577, devices_observed_user_unmatched: 0, users_without_observed_devices: 2681 };
    assert.equal(netskopeCardShare('devices_observed_user_matched', metrics)?.share, '100 %');
    assert.equal(netskopeCardShare('devices_observed_user_unmatched', metrics)?.share, '0 %');
    assert.equal(netskopeCardShare('users_without_observed_devices', metrics)?.share, '30 %');
  });

  it('shows nothing when the denominator is missing, zero or inconsistent', () => {
    assert.equal(netskopeCardShare('devices_observed_user_matched', null), null);
    assert.equal(netskopeCardShare('devices_observed_user_matched', { devices_total: 0, devices_observed_user_matched: 0 }), null);
    assert.equal(netskopeCardShare('devices_observed_user_matched', { devices_total: 5, devices_observed_user_matched: 9 }), null);
    assert.equal(netskopeCardShare('devices_stale_unclassified', { devices_stale_30d: 10, devices_stale_unclassified: null }), null);
    assert.equal(netskopeCardShare('devices_stale_unclassified', { devices_stale_30d: 10, devices_stale_unclassified: 11 }), null);
    assert.equal(netskopeCardShare('devices_total', { devices_total: 5 }), null);
  });
});

describe('NSK-REF-001 the users reference never adjusts either count', () => {
  it('states both numbers and the sign of the difference', () => {
    assert.equal(netskopeUsersReference({ users_total: 8919, users_reported_total: 8859 })?.label, 'Diferencia frente a Netskope: +60');
    assert.equal(netskopeUsersReference({ users_total: 8800, users_reported_total: 8859 })?.label, 'Diferencia frente a Netskope: −59');
    assert.equal(netskopeUsersReference({ users_total: 8859, users_reported_total: 8859 })?.label, 'Diferencia frente a Netskope: sin diferencia');
    assert.equal(netskopeUsersReference({ users_total: 8919, users_reported_total: 8859 })?.difference, 60);
  });

  it('shows nothing when Netskope has not reported a usable total', () => {
    assert.equal(netskopeUsersReference(null), null);
    assert.equal(netskopeUsersReference({ users_total: 5 }), null);
    assert.equal(netskopeUsersReference({ users_total: 5, users_reported_total: null }), null);
    assert.equal(netskopeUsersReference({ users_total: 5, users_reported_total: -1 }), null);
    assert.equal(netskopeUsersReference({ users_total: 5, users_reported_total: 1.5 }), null);
  });
});

describe('NSK-USR-001 the enabled/disabled split is only stated when every user has a status', () => {
  it('adds up to the users listed and names the rest as unknown', () => {
    assert.equal(netskopeUsersSplit({ users_total: 8855, users_enabled: 7618, users_disabled: 1237 }), '7.618 habilitados · 1.237 deshabilitados');
    assert.equal(netskopeUsersSplit({ users_total: 10, users_enabled: 6, users_disabled: 3 }), '6 habilitados · 3 deshabilitados · 1 sin dato de cuentas');
  });

  it('says the status is pending, not zero, before any sync has read the accounts', () => {
    assert.equal(netskopeUsersSplit({ users_total: 8919, users_enabled: 0, users_disabled: 0 }), 'Estado de cuentas: se lee en el próximo sync');
    assert.equal(netskopeUsersSplit({ users_total: 0, users_enabled: 0, users_disabled: 0 }), null);
  });

  it('shows nothing when a count is missing or inconsistent', () => {
    assert.equal(netskopeUsersSplit(null), null);
    assert.equal(netskopeUsersSplit({ users_total: 10 }), null);
    assert.equal(netskopeUsersSplit({ users_total: 10, users_enabled: null, users_disabled: 3 }), null);
    assert.equal(netskopeUsersSplit({ users_total: 5, users_enabled: 4, users_disabled: 3 }), null);
  });
});
