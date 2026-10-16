import assert from 'node:assert/strict';
import test from 'node:test';
import { syncStatusLabel } from '../../src/cross/lib/sync-status-label.ts';

const run = (status: string) => ({ status, source_system: 'netskope', started_at: '2026-10-10T10:00:00Z', completed_at: status === 'running' ? null : '2026-10-10T10:05:00Z' });

test('UX-QA-001: a failed run and no run are not "pending"', () => {
  const failed = syncStatusLabel(run('failed'), false, 'Netskope');
  assert.equal(failed.label, 'Última sincronización fallida');
  assert.match(failed.title ?? '', /^Última corrida fallida · Netskope · /);
  const none = syncStatusLabel(null, false);
  assert.equal(none.label, 'Sin sincronizaciones todavía');
  assert.ok(none.title);
  assert.equal(syncStatusLabel(undefined, false).label, 'Sin sincronizaciones todavía');
});

test('UX-QA-001: running, queued and completed keep their labels; an unknown status stays pending with its detail', () => {
  assert.equal(syncStatusLabel(null, true).label, 'Sincronizando…');
  assert.equal(syncStatusLabel(run('running'), false).label, 'Sincronizando…');
  assert.equal(syncStatusLabel(run('queued'), false).label, 'Sincronización en espera');
  assert.match(syncStatusLabel(run('completed'), false).label, /^Sincronizado /);
  assert.match(syncStatusLabel(run('partial'), false).label, /^Sincronizado /);
  const odd = syncStatusLabel(run('cancelled'), false, 'SIA');
  assert.equal(odd.label, 'Sincronización pendiente');
  assert.match(odd.title ?? '', /cancelled · SIA · /);
});
