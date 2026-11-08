import assert from 'node:assert/strict';
import test from 'node:test';
import { latestCyclePerTool } from '../../src/cross/lib/sync-notification.ts';

const run = (over: Record<string, unknown>) => ({
  run_id: 'r', status: 'completed', enqueued_at: '2026-10-04T12:00:00Z', started_at: '2026-10-04T12:00:10Z',
  completed_at: '2026-10-04T12:01:00Z', received_object_count: 0, ...over,
}) as never;

test('one line per tool with its latest cycle, status and no object count', () => {
  const cycles = latestCyclePerTool([
    run({ run_id: 'a', source_system: 'cyberark', source_file: 'cyberark-psm-api', completed_at: '2026-10-04T12:01:00Z' }),
    run({ run_id: 'b', source_system: 'netskope', source_file: 'netskope-api', enqueued_at: '2026-10-04T11:00:00Z', started_at: '2026-10-04T11:00:10Z', completed_at: '2026-10-04T11:01:00Z' }),
    run({ run_id: 'c', source_system: 'cyberark', source_file: 'cyberark-api', enqueued_at: '2026-10-04T08:00:00Z', started_at: '2026-10-04T08:00:10Z', completed_at: '2026-10-04T08:01:00Z', status: 'failed' }),
  ]);
  assert.deepEqual(cycles.map((cycle) => [cycle.label, cycle.statusLabel]), [['CyberArk', 'Completada'], ['Netskope', 'Completada']]);
  assert.equal(JSON.stringify(cycles).includes('objetos'), false);
});

test('a partial cycle reports the affected components and a failed one is a warning tone', () => {
  const [cycle] = latestCyclePerTool([
    run({ run_id: 'a', source_system: 'netskope', source_file: 'netskope-dlp-api', status: 'partial', error_count: 1 }),
    run({ run_id: 'b', source_system: 'netskope', source_file: 'netskope-api', status: 'completed' }),
  ]);
  assert.equal(cycle.tone, 'warning');
  assert.match(cycle.detail, /1 componente con aviso o fallo/);
});

test('no runs, no lines', () => {
  assert.deepEqual(latestCyclePerTool([]), []);
});
