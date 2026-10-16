import assert from 'node:assert/strict';
import test from 'node:test';
import { donutSlices, summarizeCategoryPopulation } from '../../src/cross/lib/category-population.ts';

test('Top-N population keeps visible share, unknowns and a valid omitted remainder distinct', () => {
  const summary = summarizeCategoryPopulation([
    { key: 'Windows', count: 60 },
    { key: 'Linux', count: 20 },
    { key: 'Sin dato', count: 10 },
  ], 200, 3);

  assert.equal(summary.population, 200);
  assert.equal(summary.visible, 90);
  assert.equal(summary.visiblePercentage, 45);
  assert.equal(summary.buckets[0].percentage, 30);
  assert.equal(summary.buckets[2].percentage, 5);
  assert.equal(summary.unknown, 10);
  assert.equal(summary.rest, 110);
  assert.ok(Math.abs((summary.restPercentage ?? NaN) - 55) < 1e-9);
  assert.equal(summary.restValid, true);
  assert.equal(summary.truncated, true);
  assert.equal(summary.inconsistent, false);
});

test('Population has no remainder when visible categories exhaust it', () => {
  const summary = summarizeCategoryPopulation([
    { key: 'Con dato', count: 2 },
    { key: 'Sin dato', count: 1 },
  ], 3, 2);

  assert.equal(summary.rest, 0);
  assert.equal(summary.restValid, true);
  assert.equal(summary.truncated, true, 'reaching the Top-N limit remains marked even with no remainder');
  assert.equal(summary.unknown, 1);
});

test('zero population has no percentages and does not invent a remainder', () => {
  const summary = summarizeCategoryPopulation([], 0, 8);

  assert.equal(summary.population, 0);
  assert.equal(summary.visible, 0);
  assert.equal(summary.visiblePercentage, null);
  assert.equal(summary.rest, 0);
  assert.equal(summary.restPercentage, null);
  assert.equal(summary.buckets.length, 0);
  assert.equal(summary.restValid, true);
  assert.equal(summary.truncated, false);
});

test('unknown population keeps bucket counts but withholds percentages and remainder', () => {
  const summary = summarizeCategoryPopulation([{ key: 'Windows', count: 4 }, { key: 'Sin dato', count: 2 }], null, 8);

  assert.equal(summary.visible, 6);
  assert.equal(summary.unknown, 2);
  assert.equal(summary.rest, null);
  assert.equal(summary.restValid, false);
  assert.equal(summary.visiblePercentage, null);
  assert.deepEqual(summary.buckets.map((bucket) => bucket.percentage), [null, null]);
});

test('population below visible counts is inconsistent and never yields a negative remainder', () => {
  const summary = summarizeCategoryPopulation([{ key: 'Windows', count: 8 }, { key: 'Sin dato', count: 2 }], 5, 2);

  assert.equal(summary.visible, 10);
  assert.equal(summary.inconsistent, true);
  assert.equal(summary.restValid, false);
  assert.equal(summary.rest, null);
  assert.equal(summary.visiblePercentage, null);
  assert.deepEqual(summary.buckets.map((bucket) => bucket.percentage), [null, null]);
});

test('the donut adds the omitted remainder as its own neutral slice and nothing when the population is unknown or exhausted', () => {
  const top = [{ key: 'Windows', count: 60 }, { key: 'Mac', count: 20 }];
  const slices = donutSlices(top, 100, 8);
  assert.deepEqual(slices.map((slice) => [slice.key, slice.count]), [['Windows', 60], ['Mac', 20], ['Otros', 20]]);
  assert.equal((slices[2] as { label?: string }).label, 'Otras categorías');
  assert.equal(donutSlices(top, 80, 8).length, 2);
  assert.equal(donutSlices(top, null, 8).length, 2);
  assert.equal(donutSlices(top, 50, 8).length, 2, 'an inconsistent population never invents a remainder');
});
