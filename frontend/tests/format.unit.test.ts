import assert from 'node:assert/strict';
import test from 'node:test';

import { actionLabel, businessUnitLabel, nextActionOptions, resultCountLabel, WORKFLOW_STATUSES, workflowStatusesFor, workflowStatusesFromCounts } from '../src/lib/format.ts';

test('business unit labels do not repeat identical code and name', () => {
  assert.equal(businessUnitLabel({ unit_code: 'UENO', unit_name: 'UENO' }), 'UENO');
  assert.equal(businessUnitLabel({ unit_code: 'N/A', unit_name: 'No Aplica' }), 'N/A - No Aplica');
  assert.equal(businessUnitLabel({ unit_code: 'FIN', unit_name: 'Finanzas' }), 'FIN - Finanzas');
});

test('daily Safe workflow offers only the three decision states', () => {
  assert.deepEqual(WORKFLOW_STATUSES, ['pending', 'in_progress', 'resolved']);
  assert.deepEqual(workflowStatusesFor('pending'), WORKFLOW_STATUSES);
});

test('legacy workflow values remain visible without becoming new choices', () => {
  assert.deepEqual(workflowStatusesFor('blocked'), ['pending', 'in_progress', 'resolved', 'blocked']);
  assert.deepEqual(workflowStatusesFor('retired'), ['pending', 'in_progress', 'resolved', 'retired']);
});

test('Safe review and decommission actions remain distinct', () => {
  assert.deepEqual(nextActionOptions, ['Migrar a SIA', 'Consultar', 'Revisar', 'Dar de baja', 'Rotar credencial']);
  assert.equal(actionLabel('revisar'), 'Revisar');
  assert.equal(actionLabel('dar de baja'), 'Dar de baja');
  assert.equal(actionLabel('Revisar / Dar de baja'), 'Revisar');
});

test('filter states follow observed counts and expose retired Safes when present', () => {
  assert.deepEqual(workflowStatusesFromCounts([
    { key: 'pending', count: 3 },
    { key: 'retired', count: 1 },
    { key: 'blocked', count: 0 },
  ]), ['pending', 'retired']);
  assert.deepEqual(workflowStatusesFromCounts([], 'retired'), ['retired']);
});

test('resultCountLabel pluralizes and locale-formats the count consistently across workspaces', () => {
  assert.equal(resultCountLabel(0), '0 resultados');
  assert.equal(resultCountLabel(1), '1 resultado');
  assert.equal(resultCountLabel(2), '2 resultados');
  assert.equal(resultCountLabel(12345), '12.345 resultados');
});
