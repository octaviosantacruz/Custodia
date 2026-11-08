import assert from 'node:assert/strict';
import test from 'node:test';

import { capabilitySegments, trendGeometry, workSegments, xOfN } from '../../src/cross/lib/coverage-progress.ts';
import type { CoveragePoint } from '../../src/cross/types/connection.ts';

const point = (date: string, n: number, platform: number, dba: number, onboarded: number): CoveragePoint => ({
  snapshot_date: date, captured_at: `${date}T12:00:00Z`, n,
  platform: { match: platform, missing: 0, undeclared: 0, unclassified: 0, unknown: n - platform },
  dba: { match: dba, missing: 0, undeclared: 0, unclassified: 0, unknown: n - dba },
  work: { pending: n - onboarded, in_progress: 0, onboarded, blocked: 0, not_applicable: 0 },
});

test('a count is always read with its denominator', () => {
  assert.equal(xOfN(45, 51), '45 de 51');
  assert.equal(xOfN(1200, 3000), '1.200 de 3.000');
});

test('the segments of a capability add up to the destinations and the best one comes first', () => {
  const segments = capabilitySegments({ match: 45, missing: 2, undeclared: 1, unclassified: 0, unknown: 3 });
  assert.equal(segments[0].key, 'match');
  assert.equal(segments.reduce((sum, segment) => sum + segment.count, 0), 51);
  assert.equal(workSegments({ pending: 30, in_progress: 10, onboarded: 8, blocked: 2, not_applicable: 1 })[0].key, 'onboarded');
});

test('the trend scales every line to the largest number of destinations and keeps them inside the box', () => {
  const { top, lines } = trendGeometry([point('2026-09-30', 50, 20, 10, 2), point('2026-10-07', 51, 45, 38, 8)], 640, 200);
  assert.equal(top, 51);
  assert.deepEqual(lines.map((line) => line.key), ['n', 'platform', 'dba', 'onboarded']);
  for (const line of lines) for (const pair of line.points.split(' ')) {
    const [x, y] = pair.split(',').map(Number);
    assert.ok(x >= 28 && x <= 612 && y >= 28 && y <= 172, `${line.key} ${pair}`);
  }
  // Platform rises between the two weeks, so its line goes up (smaller y).
  const platform = lines[1].points.split(' ').map((pair) => Number(pair.split(',')[1]));
  assert.ok(platform[1] < platform[0]);
});

test('a single point is centred and an empty inventory does not divide by zero', () => {
  const single = trendGeometry([point('2026-10-07', 0, 0, 0, 0)], 640, 200);
  assert.equal(single.top, 1);
  assert.ok(single.lines.every((line) => !line.points.includes('NaN')));
  assert.equal(single.x(0), 320);
});
