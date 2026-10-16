import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { E2E_GROUPS, groupFilters } from '../../scripts/e2e-groups.mjs';

const specDir = resolve(import.meta.dirname, '../e2e');
const specs = readdirSync(specDir, { recursive: true }).filter((file) => file.endsWith('.spec.ts')).sort();

test('every E2E spec belongs to exactly one platform group', () => {
  const listed = Object.values(E2E_GROUPS).flat();
  assert.deepEqual([...listed].sort(), specs, 'a new spec must be added to scripts/e2e-groups.mjs');
  assert.equal(new Set(listed).size, listed.length, 'a spec cannot sit in two groups');
});

test('group filters are anchored so a spec never selects a sibling', () => {
  for (const name of Object.keys(E2E_GROUPS)) {
    for (const filter of groupFilters(name)) {
      const expression = new RegExp(filter);
      const matches = specs.filter((spec) => expression.test(`tests/e2e/${spec}`));
      assert.equal(matches.length, 1, `${filter} must select exactly one spec`);
    }
  }
  assert.throws(() => groupFilters('inexistente'), /Grupo E2E desconocido/);
});

test('unit CLI discovers nested tests, ignores E2E/support, and propagates a failing case', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'dshub-test-discovery-'));
  const runner = resolve(import.meta.dirname, '../../scripts/unit-tests.mjs');
  try {
    for (const folder of ['cross', 'cyberark/pam', 'e2e/support']) {
      mkdirSync(resolve(directory, 'tests', folder), { recursive: true });
    }
    const passing = "import test from 'node:test'; test('nested case', () => {});\n";
    writeFileSync(resolve(directory, 'tests/cross/shell.unit.test.ts'), passing);
    const nested = resolve(directory, 'tests/cyberark/pam/inventory.unit.test.ts');
    writeFileSync(nested, passing);
    writeFileSync(resolve(directory, 'tests/e2e/browser.spec.ts'), "throw new Error('E2E must be excluded');\n");
    writeFileSync(resolve(directory, 'tests/e2e/support/fixture.ts'), "throw new Error('Support must be excluded');\n");
    // This launches an independent CLI, not a child of Node's current test context.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = () => spawnSync(process.execPath, [runner, '--test-reporter=tap'], { cwd: directory, encoding: 'utf8', env });
    const success = run();
    assert.equal(success.status, 0, success.stdout + success.stderr);
    assert.match(success.stdout, /# tests 2\b/);
    writeFileSync(nested, "import test from 'node:test'; test('nested failure', () => { throw new Error('intentional failure'); });\n");
    const failure = run();
    assert.equal(failure.status, 1, failure.stdout + failure.stderr);
    assert.match(failure.stdout, /# fail 1\b/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
