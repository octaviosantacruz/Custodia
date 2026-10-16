import assert from 'node:assert/strict';
import test from 'node:test';

import { capabilityReading, flagLabel, isDeviation, nextFlag } from '../../src/cross/lib/connection-coverage-reading.ts';

test('each server result reads as a label and tone, naming the capability in the hint', () => {
  assert.deepEqual([capabilityReading('platform', 'match')?.label, capabilityReading('platform', 'match')?.tone], ['Coincide', 'success']);
  assert.deepEqual([capabilityReading('dba', 'missing')?.label, capabilityReading('dba', 'missing')?.tone], ['Falta en SIA', 'danger']);
  assert.match(capabilityReading('dba', 'missing')!.hint, /DBA/);
  assert.equal(capabilityReading('platform', 'undeclared')?.label, 'No declarado');
  assert.equal(capabilityReading('platform', 'unclassified')?.label, 'Sin clasificar');
  assert.equal(capabilityReading('platform', 'unknown')?.label, 'Sin dato');
});

test('a retired destination has no reading and only missing or undeclared are deviations', () => {
  assert.equal(capabilityReading('platform', null), null);
  assert.deepEqual((['match', 'missing', 'undeclared', 'unclassified', 'unknown', null] as const).map(isDeviation), [false, true, true, false, false, false]);
});

test('an empty flag says Sin dato and a click cycles Sin dato, Sí, No and back', () => {
  assert.equal(flagLabel(null), 'Sin dato');
  assert.equal(nextFlag(null), true);
  assert.equal(nextFlag(true), false);
  assert.equal(nextFlag(false), null);
});
