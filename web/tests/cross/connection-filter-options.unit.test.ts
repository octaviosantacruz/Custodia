import assert from 'node:assert/strict';
import test from 'node:test';
import { coverageOptions, environmentOptions } from '../../src/cross/lib/connection-filter-options.ts';

const totals = { total: 10, both: 4, pam_only: 0, sia_only: 6, none: 0, zsp_implemented: 0, zsp_pending: 0, zsp_unknown: 0 };
const fmt = (value: number) => String(value);

test('without a summary no option carries a count and every category stays reachable (never "(0)")', () => {
  const labels = coverageOptions(null, '', fmt).map((option) => option.label);
  assert.deepEqual(labels, ['Toda cobertura', 'PAM + SIA', 'Solo PAM', 'Solo SIA', 'Sin coincidencia']);
  assert.deepEqual(environmentOptions(null, null, '', fmt).map((option) => option.label), ['Todos los ambientes']);
});

test('with a summary empty categories are hidden unless selected, and counts are shown', () => {
  assert.deepEqual(coverageOptions(totals, '', fmt).map((option) => option.label), ['Toda cobertura (10)', 'PAM + SIA (4)', 'Solo SIA (6)']);
  assert.ok(coverageOptions(totals, 'none', fmt).some((option) => option.value === 'none' && option.label === 'Sin coincidencia (0)'));
});

test('the active environment survives a failed summary', () => {
  assert.deepEqual(environmentOptions(null, null, 'PROD', fmt).map((option) => option.value), ['', 'PROD']);
  assert.deepEqual(environmentOptions([{ ...totals, environment: 'QA' }], 10, '', fmt).map((option) => option.label), ['Todos los ambientes (10)', 'QA (10)']);
});
