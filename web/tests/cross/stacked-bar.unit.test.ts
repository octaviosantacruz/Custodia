import assert from 'node:assert/strict';
import test from 'node:test';
import { segmentWidths, stackedSummary } from '../../src/cross/lib/stacked-bar.ts';

const seg = (key: string, count: number) => ({ key, label: key, count, tone: 'good' as const });

test('segmentWidths fills proportionally and never exceeds the bar', () => {
  assert.deepEqual(segmentWidths([seg('a', 50), seg('b', 25)], 100), [50, 25]);
  const over = segmentWidths([seg('a', 80), seg('b', 80)], 100);
  assert.equal(over.reduce((sum, width) => sum + width, 0), 100);
});

test('segmentWidths treats invalid counts and an empty whole as empty, never NaN', () => {
  assert.deepEqual(segmentWidths([seg('a', 0), seg('b', Number.NaN), seg('c', -3)], 10), [0, 0, 0]);
  assert.deepEqual(segmentWidths([seg('a', 5)], 0), [100]);
  assert.deepEqual(segmentWidths([], 0), []);
  assert.deepEqual(segmentWidths([seg('a', 0)], 0), [0]);
});

test('stackedSummary gives the text equivalent and says when there is no data', () => {
  const format = (value: number) => String(value);
  assert.equal(stackedSummary([seg('Al día', 3), seg('1 atrás', 1), seg('vacío', 0)], 4, format), 'Al día: 3 (75%), 1 atrás: 1 (25%)');
  assert.equal(stackedSummary([seg('a', 0)], 0, format), 'Sin datos');
  assert.equal(stackedSummary([seg('a', 2)], 0, format), 'a: 2');
});
