import assert from 'node:assert/strict';
import test from 'node:test';

import { createDashboardShortcut, toDashboardPreferencePayload } from '../../../src/cyberark/pam/lib/dashboard-metrics.ts';

test('a saved KR widget sends configuration without evaluated totals or status', () => {
  const widget = { ...createDashboardShortcut('kr2-connection-coverage', 0), value: 98.04,
    data_status: 'available' as const, covered_count: 50, total_count: 51 };
  const [payload] = toDashboardPreferencePayload([widget]);
  assert.equal(payload.measure, 'kr2_connection_coverage');
  assert.equal(payload.value_format, 'percentage');
  assert.equal('covered_count' in payload, false);
  assert.equal('total_count' in payload, false);
  assert.equal('data_status' in payload, false);
  assert.equal('value' in payload, false);
});
