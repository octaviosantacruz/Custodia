import test from 'node:test';
import assert from 'node:assert/strict';
import { pageVolumeByUtcDay } from '../../src/cross/lib/page-volume.ts';

test('page volume groups loaded rows by UTC day in calendar order and ignores invalid timestamps', () => {
  assert.deepEqual(pageVolumeByUtcDay([
    '2026-10-02T23:30:00-02:00', // UTC day is October 3
    '2026-10-01T22:00:00Z',
    '2026-10-03T04:00:00Z',
    'not-a-date',
  ]), [
    { day: '2026-10-01', count: 1 },
    { day: '2026-10-03', count: 2 },
  ]);
});
