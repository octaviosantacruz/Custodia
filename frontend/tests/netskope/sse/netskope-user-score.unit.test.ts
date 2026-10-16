import assert from 'node:assert/strict';
import test from 'node:test';
import { formatScore, weakestLabel } from '../../../src/netskope/sse/lib/netskope-user-score.ts';

test('a missing score reads "Sin dato", never zero', () => {
  assert.equal(formatScore(null), 'Sin dato');
  assert.equal(formatScore(undefined), 'Sin dato');
  assert.equal(formatScore(0), '0');
  assert.equal(formatScore(51.6), '52');
});

test('the weakest component is named in Spanish or omitted', () => {
  assert.equal(weakestLabel('network'), 'Red');
  assert.equal(weakestLabel('app'), 'Aplicaciones');
  assert.equal(weakestLabel(null), null);
});
