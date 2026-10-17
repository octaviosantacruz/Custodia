import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

/* FE-DEVTOOLS-001: the TanStack Query Devtools panel must stay development-only.
   Both checks build the real app (vite.config.ts included) and inspect every
   emitted asset for strings the panel ships even after minification, so the
   guarantee is verified on the bundle instead of on main.tsx's source.
   `vite build` resolves `import.meta.env.DEV` from `NODE_ENV` (production by
   default, development when explicitly set), which is also what `npm run web`
   serves, so the second test reproduces the development side of the gate. */

const FRONTEND_ROOT = resolve(import.meta.dirname, '../..');
const DEVTOOLS_BUNDLE_MARKERS = ['TanStack Query Devtools', 'tsqd-'];

function bundleText(outDir: string): string {
  const contents: string[] = [];
  for (const entry of readdirSync(outDir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      contents.push(readFileSync(join(entry.parentPath, entry.name), 'utf8'));
    }
  }
  return contents.join('\n');
}

test('the production bundle does not include the TanStack Query Devtools panel', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'custodia-prod-bundle-'));
  try {
    await build({
      root: FRONTEND_ROOT,
      mode: 'production',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
    const bundle = bundleText(outDir);
    for (const marker of DEVTOOLS_BUNDLE_MARKERS) {
      assert.ok(!bundle.includes(marker), `el build de producción contiene "${marker}"`);
    }
    assert.ok(!bundle.includes('initialIsOpen'), 'el build de producción conserva la llamada a Devtools');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('a development build keeps the Devtools panel behind the DEV gate', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'custodia-dev-bundle-'));
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    await build({
      root: FRONTEND_ROOT,
      mode: 'development',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
    const bundle = bundleText(outDir);
    for (const marker of DEVTOOLS_BUNDLE_MARKERS) {
      assert.ok(bundle.includes(marker), `el build de desarrollo no contiene "${marker}"`);
    }
    assert.ok(bundle.includes('initialIsOpen'), 'el build de desarrollo no renderiza el panel cerrado');
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    rmSync(outDir, { recursive: true, force: true });
  }
});
