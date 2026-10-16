import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

/* api.ts reads Vite's import.meta.env.VITE_API_URL, absent in Node: pin it for this process only. */
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.endsWith('/src/cross/lib/api.ts')) {
      const text = typeof result.source === 'string' ? result.source : Buffer.from(result.source as ArrayBuffer).toString('utf8');
      return { ...result, source: text.replaceAll('import.meta.env.VITE_API_URL', "''") };
    }
    return result;
  },
});
const { api, ApiError, messageForStatus } = await import('../../src/cross/lib/api.ts');

function mockFetch(factory: () => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (() => factory()) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test('an empty 502 explains the service is unavailable instead of a generic failure', async () => {
  const restore = mockFetch(async () => new Response('', { status: 502 }));
  try {
    await assert.rejects(api('/auth/status'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 502);
      assert.equal(error.message, messageForStatus(502));
      assert.match(error.message, /no está disponible/);
      return true;
    });
  } finally { restore(); }
});

test('proxy HTML bodies are never surfaced as the message', async () => {
  const restore = mockFetch(async () => new Response('<html><body>Bad gateway</body></html>', { status: 502 }));
  try {
    await assert.rejects(api('/x'), (error: unknown) => error instanceof ApiError && !error.message.includes('<'));
  } finally { restore(); }
});

test('the backend detail still wins over the status fallback', async () => {
  const restore = mockFetch(async () => new Response(JSON.stringify({ detail: 'Safe no encontrada' }), { status: 404 }));
  try {
    await assert.rejects(api('/safes/1'), (error: unknown) => error instanceof ApiError && error.message === 'Safe no encontrada');
  } finally { restore(); }
});

test('a network failure becomes an ApiError with status 0, while aborts pass through', async () => {
  let restore = mockFetch(async () => { throw new TypeError('Failed to fetch'); });
  try {
    await assert.rejects(api('/auth/status'), (error: unknown) => error instanceof ApiError && error.status === 0 && /conectar/.test(error.message));
  } finally { restore(); }
  restore = mockFetch(async () => { throw new DOMException('aborted', 'AbortError'); });
  try {
    await assert.rejects(api('/auth/status'), (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
  } finally { restore(); }
});
