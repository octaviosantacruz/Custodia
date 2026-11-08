import assert from 'node:assert/strict';
import test from 'node:test';
import { ageHours, ageTone } from '../../src/cross/lib/age.ts';
import { barShare } from '../../src/cross/lib/bar-share.ts';
import { buildSyncTimeline } from '../../src/cross/lib/sync-timeline.ts';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

test('ageTone: a missing or invalid date is unknown, never fresh', () => {
  assert.equal(ageTone(null, undefined, NOW), 'unknown');
  assert.equal(ageTone('', undefined, NOW), 'unknown');
  assert.equal(ageTone('nope', undefined, NOW), 'unknown');
  assert.equal(ageHours(undefined, NOW), null);
});

test('ageTone applies the thresholds and a future date counts as fresh', () => {
  assert.equal(ageTone(ago(2), undefined, NOW), 'fresh');
  assert.equal(ageTone(ago(30), undefined, NOW), 'aging');
  assert.equal(ageTone(ago(80), undefined, NOW), 'stale');
  assert.equal(ageTone(ago(30), { agingAfterHours: 36, staleAfterHours: 72 }, NOW), 'fresh');
  assert.equal(ageTone(ago(-5), undefined, NOW), 'fresh');
});

test('barShare clamps to 0..1 and treats invalid input as an empty bar', () => {
  assert.equal(barShare(50, 100), 0.5);
  assert.equal(barShare(200, 100), 1);
  for (const [value, max] of [[0, 100], [-1, 100], [5, 0], [Number.NaN, 10], [5, Number.NaN], [Infinity, 10]]) {
    assert.equal(barShare(value, max), 0, `${value}/${max}`);
  }
});

test('buildSyncTimeline keeps the newest cycles per tool, oldest to newest, and counts problems', () => {
  const groups = [
    { tool: 'cyberark', status: 'failed', latest_at: '2026-10-04T12:00:00Z' },
    { tool: 'netskope', status: 'completed', latest_at: '2026-10-04T11:30:00Z' },
    { tool: 'cyberark', status: 'partial', latest_at: '2026-10-04T11:00:00Z' },
    { tool: 'cyberark', status: 'completed', latest_at: '2026-10-04T10:00:00Z' },
    { tool: 'cyberark', status: 'completed', latest_at: '2026-10-04T09:00:00Z' },
  ] as const;
  const rows = buildSyncTimeline(groups as never, 3);
  const cyber = rows.find((row) => row.tool === 'cyberark')!;
  assert.deepEqual(cyber.cells.map((cell) => cell.status), ['completed', 'partial', 'failed']);
  assert.equal(cyber.problems, 2);
  assert.equal(rows.find((row) => row.tool === 'netskope')!.problems, 0);
  assert.deepEqual(buildSyncTimeline([]), []);
});
