import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.includes('/src/')) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(`${specifier}${suffix}`, context.parentURL);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.endsWith('/src/cross/lib/api.ts')) {
      const text = typeof result.source === 'string'
        ? result.source
        : Buffer.from(result.source as ArrayBuffer).toString('utf8');
      return { ...result, source: text.replaceAll('import.meta.env.VITE_API_URL', "''") };
    }
    return result;
  },
});

const { fetchPamCleanupSignals } = await import('../../../src/cyberark/pam/lib/pam-technical-catalogs-api.ts');
const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

test('cleanup client performs a read-only GET and forwards cancellation', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const payload = { empty_groups: { count: 0, denominator: 0, items: [], computed_at: '2026-10-01T12:00:00Z',
    inventory_runs: [{ family: 'pam_inventory', latest_attempt: null, last_completed_inventory: null }] } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const controller = new AbortController();
  const response = await fetchPamCleanupSignals({ signal: controller.signal });

  assert.equal(new URL(calls[0].url, 'http://localhost').pathname, '/api/cmdb/pam-cleanup-signals');
  assert.equal(calls[0].init?.method, undefined, 'the common API transport keeps this request a GET');
  assert.equal(calls[0].init?.credentials, 'include');
  assert.equal(calls[0].init?.signal, controller.signal);
  assert.deepEqual(response, payload);
});
