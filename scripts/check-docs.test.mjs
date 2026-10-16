import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brokenLinks, checkDocs, frontmatterProblems, headingAnchors, missingPaths, parseFrontmatter, staleWarnings, trackerFiles, unknownTrackerIds } from './check-docs.mjs';

const front = (estado = 'vigente', revisado = '2026-10-01') => `---\nestado: ${estado}\ndueño: Ana\nrevisado: ${revisado}\n---\n\n`;
const TODAY = '2026-10-09';

const existing = new Set(['docs/a.md', 'docs/b/c.md', 'backend/app/main.py', 'docs/tracking/TO_IMPLEMENT.md', 'docs/tracking/done/2026.md']);
const exists = (path) => existing.has(path);

test('heading anchors follow GitHub slugs, including accents, punctuation and repeated headings', () => {
  const anchors = headingAnchors('# Cierre FE-CSS-001 — `styles.css`\n## Qué es\n## Qué es\n```\n# no es título\n```');
  assert.deepEqual([...anchors], ['cierre-fe-css-001--stylescss', 'qué-es', 'qué-es-1']);
});

test('a link to a missing file or section is reported with file and line', () => {
  const docs = {
    'docs/a.md': '# Título\n\n[ok](b/c.md) [roto](b/missing.md) [externo](https://example.com/x)\n[sección](b/c.md#no-existe) [propia](#título)',
    'docs/b/c.md': '# Otro',
  };
  assert.deepEqual(brokenLinks(docs, exists), [
    'docs/a.md:3 enlace roto a b/missing.md. Corregí la ruta o quitá el enlace.',
    'docs/a.md:4 la sección #no-existe no existe en docs/b/c.md. Actualizá el ancla.',
  ]);
});

test('cited repository paths must exist, except globs, placeholders, allowed paths and historical records', () => {
  const docs = {
    'AGENTS.md': 'Existe `backend/app/main.py`; falta `backend/app/gone.py`; glob `backend/app/*/routes/`; plantilla `migrations/NNN_x.sql`; futuro `backend/Dockerfile`.',
    'docs/history/old.md': front('histórico') + 'Ya no existe `backend/app/gone.py`.',
    'docs/tracking/done/2026.md': front('histórico') + 'Ya no existe `frontend/src/old.tsx`.',
  };
  const problems = missingPaths(docs, exists);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^AGENTS\.md:1 cita la ruta backend\/app\/gone\.py, que no existe/);
});

test('tracker IDs cited in docs must exist in a tracker; templates and tracker files themselves are skipped', () => {
  const docs = {
    'docs/tracking/TO_IMPLEMENT.md': '| `AAA-001` | Listo |',
    'docs/tracking/done/2026.md': '| `BBB-001` | commit |',
    'docs/architecture/x.md': 'Cierra `AAA-001` y `BBB-001`; falta `CCC-001`; fecha `YYYY-MM-DD`.',
    'docs/history/old.md': front('histórico') + 'Antes `ZZZ-999`.',
  };
  const problems = unknownTrackerIds(docs, trackerFiles(Object.keys(docs)));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^docs\/architecture\/x\.md:1 cita el ID CCC-001/);
});

test('checkDocs aggregates the three checks and is clean on a consistent tree', () => {
  const docs = { 'docs/a.md': front() + '# A\n[b](b/c.md) `backend/app/main.py`', 'docs/b/c.md': front() + '# C' };
  assert.deepEqual(checkDocs(docs, exists, TODAY), []);
});

test('frontmatter is parsed from the top of the file only', () => {
  assert.deepEqual(parseFrontmatter(front('histórico', '2026-09-01') + '# T'), { estado: 'histórico', 'dueño': 'Ana', revisado: '2026-09-01' });
  assert.equal(parseFrontmatter('# T\n---\nestado: vigente\n---'), null);
});

test('every doc needs a valid estado, dueño and revisado date', () => {
  const docs = {
    'docs/ok.md': front(),
    'docs/none.md': '# Sin frontmatter',
    'docs/state.md': front('activo'),
    'docs/owner.md': '---\nestado: vigente\nrevisado: 2026-10-01\n---\n',
    'docs/date.md': front('vigente', '2026-13-45'),
    'docs/future.md': front('vigente', '2026-12-01'),
    'docs/history/live.md': front('vigente'),
    'AGENTS.md': '# Fuera de docs/: no requiere frontmatter',
  };
  const problems = frontmatterProblems(docs, TODAY);
  assert.deepEqual(problems.map((problem) => problem.split(' ')[0]), ['docs/none.md:1', 'docs/state.md:1', 'docs/owner.md:1', 'docs/date.md:1', 'docs/future.md:1', 'docs/history/live.md:1']);
  assert.match(problems[1], /usá vigente o histórico/);
  assert.match(problems[5], /carpeta de registros históricos/);
});

test('current docs not reviewed for more than 90 days produce a warning; historical ones do not', () => {
  const docs = {
    'docs/fresh.md': front('vigente', '2026-09-20'),
    'docs/stale.md': front('vigente', '2026-06-01'),
    'docs/old.md': front('histórico', '2025-01-01'),
    'docs/generated.md': front('vigente', '2025-01-01').replace('---\n\n', 'generado: sí\n---\n\n'),
  };
  const warnings = staleWarnings(docs, TODAY);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^docs\/stale\.md: vigente sin revisar hace 130 días/);
});
