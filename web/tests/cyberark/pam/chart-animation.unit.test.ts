import assert from 'node:assert/strict';
import test from 'node:test';

import { CHART_ENTRY_MS, chartAnimationMs } from '../../../src/cyberark/pam/lib/chart-animation.ts';

/* FE-MOTION-001: ECharts only animates the first data render; every update
   (data, filters, resize wiring, drill-down, re-render) resolves to zero, and
   reduced motion disables even the entry animation. */
test('only the first data render animates, and reduced motion always resolves to zero', () => {
  assert.equal(chartAnimationMs('initial', false), CHART_ENTRY_MS);
  assert.equal(chartAnimationMs('update', false), 0);
  assert.equal(chartAnimationMs('initial', true), 0);
  assert.equal(chartAnimationMs('update', true), 0);
});

test('the entry duration stays in the chart-specific 450ms band', () => {
  assert.equal(CHART_ENTRY_MS, 450);
});
