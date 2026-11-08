import assert from 'node:assert/strict';
import test from 'node:test';
import { syncStatusLabel } from '../../src/cross/lib/sync-source.ts';

/* UX-AUD-009: the workspace intro used to interpolate the raw run status
   ("Última sincronización completed"). Every enum the contract defines must
   have a Spanish label; unknown values stay visible rather than hidden. */

test('every known run status has a Spanish label, never the raw enum', () => {
  const expected: Record<string, string> = {
    queued: 'En espera',
    running: 'Ejecutando',
    completed: 'Completada',
    failed: 'Fallida',
  };
  for (const [status, label] of Object.entries(expected)) {
    assert.equal(syncStatusLabel(status), label);
    assert.notEqual(syncStatusLabel(status), status);
  }
});

test('unknown statuses stay visible and a missing status is explicit', () => {
  assert.equal(syncStatusLabel('paused'), 'paused');
  assert.equal(syncStatusLabel(null), 'Sin estado');
  assert.equal(syncStatusLabel(undefined), 'Sin estado');
  assert.equal(syncStatusLabel(''), 'Sin estado');
});
