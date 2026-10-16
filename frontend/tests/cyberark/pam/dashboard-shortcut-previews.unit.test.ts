import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkShortcutIds } from '../../../src/cyberark/pam/lib/dashboard-shortcut-batching.ts';
import { DASHBOARD_SHORTCUTS } from '../../../src/cyberark/pam/lib/dashboard-metrics.ts';

test('chunks a 5-item id list into groups of at most 6, matching the preview route cap', () => {
  const ids = DASHBOARD_SHORTCUTS.filter((shortcut) => shortcut.kind !== 'chart').map((shortcut) => shortcut.id);
  const chunks = chunkShortcutIds(ids);
  assert.equal(ids.length, 5);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [5]);
  assert.deepEqual(chunks.flat(), ids);
});

test('chunks the chart shortcut ids into groups of at most 6', () => {
  const ids = DASHBOARD_SHORTCUTS.filter((shortcut) => shortcut.kind === 'chart').map((shortcut) => shortcut.id);
  const chunks = chunkShortcutIds(ids);
  assert.equal(ids.length, 5);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [5]);
});

test('an id list at or under the cap stays a single chunk', () => {
  assert.deepEqual(chunkShortcutIds(['a', 'b', 'c'] as never), [['a', 'b', 'c']]);
  assert.deepEqual(chunkShortcutIds([] as never), []);
});

test('toShortcutPreview keeps the coverage counts so an added card is calculable', async () => {
  const { toShortcutPreview } = await import('../../../src/cyberark/pam/lib/dashboard-shortcut-batching.ts');
  const preview = toShortcutPreview({ value: 85.19, value_format: 'percentage', data_status: 'available', covered_count: 345, total_count: 405 } as never);
  assert.equal(preview.covered_count, 345);
  assert.equal(preview.total_count, 405);
});
