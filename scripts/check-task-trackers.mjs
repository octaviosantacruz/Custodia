import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Assignment tables only; linked IDs in dependency/reference columns aren't tasks.
export function taskRows(text) {
  let idColumn = -1;
  const lines = text.split('\n');
  return lines.flatMap((line, index) => {
    if (!line.startsWith('|')) { idColumn = -1; return []; }
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (/^\|[\s:|\-]+\|$/.test(lines[index + 1] ?? '')) {
      idColumn = cells.indexOf('ID');
      return [];
    }
    if (idColumn < 0 || !/^`[A-Z][A-Z0-9-]+`$/.test(cells[idColumn] ?? '')) return [];
    return [{ id: cells[idColumn].slice(1, -1), line: index + 1 }];
  });
}

export function checkTrackers(activeText, closedText) {
  const active = taskRows(activeText), closed = taskRows(closedText);
  for (const [label, rows] of [['activos', active], ['cerrados', closed]]) {
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.id)) throw new Error(`ID ${label} duplicado: ${row.id} (línea ${row.line})`);
      seen.add(row.id);
    }
  }
  const closedIDs = new Set(closed.map(row => row.id));
  for (const row of active) {
    if (closedIDs.has(row.id)) throw new Error(`ID activo y cerrado simultáneamente: ${row.id}`);
  }
  return { active: active.length, closed: closed.length };
}

// IMPLEMENTED.md is the closed ledger; a done/ folder, if present, is also read.
export function readClosedTrackers(root) {
  const tracking = resolve(root, 'docs/tracking');
  const detail = resolve(tracking, 'done');
  const files = [resolve(tracking, 'IMPLEMENTED.md'), ...(existsSync(detail) ? readdirSync(detail).filter(name => name.endsWith('.md')).sort().map(name => resolve(detail, name)) : [])];
  return files.map(file => readFileSync(file, 'utf8')).join('\n\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(import.meta.dirname, '..');
    const result = checkTrackers(
      readFileSync(resolve(root, 'docs/tracking/TO_IMPLEMENT.md'), 'utf8'),
      readClosedTrackers(root),
    );
    console.log(`Trackers: ${result.active} IDs activos, ${result.closed} cerrados; sin duplicados individuales ni cruces.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
