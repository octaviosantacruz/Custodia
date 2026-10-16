import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_NETSKOPE_DEVICE_QUERY } from '../../../src/netskope/sse/lib/netskope-device-filters.ts';
import { netskopeFilterChips, netskopeFilterGroupCounts } from '../../../src/netskope/sse/lib/netskope-filter-chips.ts';
import type { NetskopeDeviceQuery } from '../../../src/netskope/sse/types/netskope.ts';

const labels = {
  evidenceState: { recent: 'Señal reciente', not_recent: 'Sin señal reciente', review: 'Candidato a revisión', unknown: 'Sin evidencia vigente' },
  change: {},
  clientCompliance: {},
  osCompliance: {},
};

function deviceQuery(overrides: Omit<Partial<NetskopeDeviceQuery>, 'filters'> & { filters?: Partial<NetskopeDeviceQuery['filters']> } = {}): NetskopeDeviceQuery {
  return { ...EMPTY_NETSKOPE_DEVICE_QUERY, ...overrides, filters: { ...EMPTY_NETSKOPE_DEVICE_QUERY.filters, ...overrides.filters } };
}

test('event age has its own removable chip with the reported label and heartbeat has none', () => {
  const chips = netskopeFilterChips(deviceQuery({ eventAge: 'gt_30d' }), labels);
  assert.deepEqual(chips.map(({ id, label }) => ({ id, label })), [
    { id: 'event-age', label: 'Antigüedad del evento: Sin eventos hace más de 30 días' },
  ]);
  assert.deepEqual(chips.map(({ clear }) => clear), [{ eventAge: '' }]);
  // NSK-HB-001: even a stale leftover value in the query object produces no heartbeat chip.
  const stale = netskopeFilterChips({ ...deviceQuery({ eventAge: 'gt_30d' }), heartbeat: 'inactive' } as unknown as NetskopeDeviceQuery, labels);
  assert.equal(stale.some(({ id }) => id === 'heartbeat'), false);
});

test('no selected device criteria yields no active chips', () => {
  assert.deepEqual(netskopeFilterChips(EMPTY_NETSKOPE_DEVICE_QUERY, labels), []);
});

test('review remains one chip and all selected criteria stay unique', () => {
  const chips = netskopeFilterChips(deviceQuery({
    evidenceState: 'review', eventAge: 'gt_30d',
    filters: { os: 'Windows', device_make: 'Dell', hostname: 'LAPTOP-1' },
  }), labels);
  const ids = chips.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter((id) => id === 'evidence').length, 1);
  assert.deepEqual(ids, ['evidence', 'event-age', 'make', 'hostname', 'filter-os']);
});

test('coverage-risk chip describes the reported last event without claiming current coverage loss', () => {
  const chip = netskopeFilterChips(deviceQuery({ coverageRisk: '1' }), labels).find(({ id }) => id === 'coverage-risk');
  assert.deepEqual(chip, {
    id: 'coverage-risk',
    label: 'Último evento: desinstalación o deshabilitación',
    clear: { coverageRisk: '' },
  });
});

test('group counters count only criteria belonging to each disclosure', () => {
  const counts = netskopeFilterGroupCounts(deviceQuery({
    eventAge: 'unknown',
    filters: { user_status: 'enabled', company: 'EXAMPLE', last_seen_event: 'connect' },
  }));
  assert.deepEqual(counts, { identity: 2, activity: 2, diagnosis: 0 });
});
