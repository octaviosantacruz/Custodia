import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTrackers, readClosedTrackers, taskRows } from './check-task-trackers.mjs';

const table = (...rows) => '| ID | Estado |\n|---|---|\n' + rows.join('\n');

test('tracks assignments including priority columns, not reference tables or prose', () => {
  const text = table('| `A-001` | Listo |') + '\n\n' +
    '| Módulo | Relacionada |\n|---|---|\n| DEM | `A-001` |\n\n' +
    '| Prioridad | ID | Estado |\n|---|---|---|\n| P1 | `B-001` | Externo |\n\n' +
    'Referencia `A-001`\n| `NOT-A-TASK` | enlace |';
  assert.deepEqual(taskRows(text).map(row => row.id), ['A-001', 'B-001']);
  assert.deepEqual(checkTrackers(text, table('| `C-001` | commit |')), { active: 2, closed: 1 });
});

test('rejects duplicate assignments and simultaneous active/closed IDs', () => {
  const row = '| `A-001` | Listo |';
  assert.throws(() => checkTrackers(table(row, row), table()), /activos duplicado/);
  assert.throws(() => checkTrackers(table(), table(row, row)), /cerrados duplicado/);
  assert.throws(() => checkTrackers(table(row), table(row)), /simultáneamente/);
});

test('closed work is read from the IMPLEMENTED.md index and every done/ detail file', () => {
  const root = mkdtempSync(join(tmpdir(), 'trackers-'));
  const tracking = join(root, 'docs', 'tracking');
  mkdirSync(join(tracking, 'done'), { recursive: true });
  writeFileSync(join(tracking, 'IMPLEMENTED.md'), '# Índice\n\n- [Cierre](done/a.md#cierre) — `A-001`\n');
  writeFileSync(join(tracking, 'done', 'a.md'), table('| `A-001` | commit |'));
  writeFileSync(join(tracking, 'done', 'b.md'), table('| `B-001` | commit |'));
  writeFileSync(join(tracking, 'done', 'notes.txt'), table('| `Z-001` | ignorado |'));
  assert.deepEqual(taskRows(readClosedTrackers(root)).map(row => row.id), ['A-001', 'B-001']);
  assert.deepEqual(checkTrackers(table('| `C-001` | Listo |'), readClosedTrackers(root)), { active: 1, closed: 2 });
});

test('a closed ID repeated across detail files is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'trackers-'));
  const tracking = join(root, 'docs', 'tracking');
  mkdirSync(join(tracking, 'done'), { recursive: true });
  writeFileSync(join(tracking, 'IMPLEMENTED.md'), '# Índice\n');
  writeFileSync(join(tracking, 'done', 'a.md'), table('| `A-001` | commit |'));
  writeFileSync(join(tracking, 'done', 'b.md'), table('| `A-001` | commit |'));
  assert.throws(() => checkTrackers(table(), readClosedTrackers(root)), /cerrados duplicado/);
});
