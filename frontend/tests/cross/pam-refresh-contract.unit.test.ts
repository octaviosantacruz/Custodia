import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

/* FE-TEST-001: these tests exercise the observable contract (a new request
   when the PAM refresh key changes) instead of matching hook source text.

   Node needs two local shims before the production hooks can load under
   `node --test`, both scoped to this file's process (the runner isolates test
   files in their own child process) and covering nothing else:
   - `src/` uses bundler-style extensionless imports (`./api`), so the resolve
     hook appends the `.ts` extension the runtime would otherwise miss;
   - `src/cross/lib/api.ts` reads Vite's `import.meta.env.VITE_API_URL`, absent in
     Node, so the load hook pins the API prefix to `/api` for this test. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.includes('/src/')) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(`${specifier}${suffix}`, context.parentURL);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
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

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { createElement } = await import('react');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { cleanup, render, waitFor } = await import('@testing-library/react');
const { PamRefreshContext } = await import('../../src/cyberark/shared/refresh-context.ts');
const { useDashboardPreferences } = await import('../../src/cyberark/pam/hooks/use-dashboard-preferences.ts');
const { useExecutiveAnalytics } = await import('../../src/cross/hooks/use-executive-analytics.ts');
const { useSimpleCatalogList } = await import('../../src/cross/hooks/use-simple-catalog-list.ts');
const { useConnectionInventory } = await import('../../src/cross/hooks/use-connection-inventory.ts');

type FetchCall = { url: string; init?: RequestInit };

const originalFetch = globalThis.fetch;

function mockFetch(payload: unknown): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function requestPath(call: FetchCall): string {
  return new URL(call.url, 'http://localhost/').pathname;
}

function includeInternalParam(call: FetchCall): string | null {
  return new URL(call.url, 'http://localhost/').searchParams.get('include_internal');
}

const clients: InstanceType<typeof QueryClient>[] = [];

function newTestClient(): InstanceType<typeof QueryClient> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return client;
}

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  globalThis.fetch = originalFetch;
});

test('useDashboardPreferences requests its data again when the PAM refresh key changes', async () => {
  const calls = mockFetch({ widgets: [], is_default: true });
  const client = newTestClient();

  function Probe() {
    useDashboardPreferences({ onUnauthorized: () => {}, onError: () => {}, onNotice: () => {}, includeInternal: true });
    return null;
  }

  const tree = (refreshKey: number) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(PamRefreshContext.Provider, { value: refreshKey }, createElement(Probe)),
    );

  const view = render(tree(0));
  await waitFor(() => {
    assert.equal(calls.length, 1, 'la carga inicial debe emitir exactamente una solicitud');
  });
  assert.equal(requestPath(calls[0]), '/api/dashboard/preferences');
  assert.equal(includeInternalParam(calls[0]), 'true');

  view.rerender(tree(1));
  await waitFor(() => {
    assert.equal(calls.length, 2, 'cambiar el refresh key debe emitir una segunda solicitud');
  });
  assert.equal(requestPath(calls[1]), '/api/dashboard/preferences');
  assert.equal(includeInternalParam(calls[1]), 'true', 'la segunda solicitud conserva includeInternal');
});

test('useExecutiveAnalytics requests its data again when the owner passes a new refresh key', async () => {
  const calls = mockFetch({});
  const client = newTestClient();

  function Probe({ refreshKey }: { refreshKey: number }) {
    useExecutiveAnalytics({ refreshKey, includeInternal: false, onUnauthorized: () => {} });
    return null;
  }

  const tree = (refreshKey: number) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(Probe, { refreshKey }),
    );

  const view = render(tree(0));
  await waitFor(() => {
    assert.equal(calls.length, 1, 'la carga inicial debe emitir exactamente una solicitud');
  });
  assert.equal(requestPath(calls[0]), '/api/analytics/executive');
  assert.equal(includeInternalParam(calls[0]), 'false');
  assert.ok(calls[0].init?.signal instanceof AbortSignal, 'la primera solicitud debe conservar el AbortSignal');
  assert.equal(calls[0].init?.signal.aborted, false);

  view.rerender(tree(1));
  await waitFor(() => {
    assert.equal(calls.length, 2, 'cambiar el refresh key debe emitir una segunda solicitud');
  });
  assert.equal(requestPath(calls[1]), '/api/analytics/executive');
  assert.equal(includeInternalParam(calls[1]), 'false', 'la segunda solicitud conserva includeInternal');
  assert.ok(calls[1].init?.signal instanceof AbortSignal, 'la segunda solicitud debe conservar el AbortSignal');
  assert.equal(calls[1].init?.signal.aborted, false);
});

test('useSimpleCatalogList refetches through its neutral refresh-key input', async () => {
  const client = newTestClient();
  const calls: Array<{ search: string; limit: number; offset: number }> = [];

  function Probe({ refreshKey }: { refreshKey: number }) {
    useSimpleCatalogList({
      refreshKey, authChecked: true, authenticated: true,
      onUnauthorized: () => {}, onError: () => {}, resourceKey: 'test-catalog',
      fetcher: async (search: string, limit: number, offset: number) => {
        calls.push({ search, limit, offset });
        return { rows: [], total: 0 };
      },
      errorFallback: 'No se pudo cargar',
    });
    return null;
  }

  const tree = (refreshKey: number) => createElement(QueryClientProvider, { client }, createElement(Probe, { refreshKey }));
  const view = render(tree(0));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual(calls[0], { search: '', limit: 100, offset: 0 });

  view.rerender(tree(1));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.deepEqual(calls[1], { search: '', limit: 100, offset: 0 });
});

test('useConnectionInventory refetches when its owner passes a new refresh key', async () => {
  const calls = mockFetch({ rows: [], total: 0, limit: 50, offset: 0, search: '', filters: { environment: '', coverage: '' }, import: null });
  const client = newTestClient();

  function Probe({ refreshKey }: { refreshKey: number }) {
    useConnectionInventory({
      refreshKey, authChecked: true, authenticated: true, includeInternal: false,
      onUnauthorized: () => {}, onError: () => {},
    });
    return null;
  }

  const tree = (refreshKey: number) => createElement(QueryClientProvider, { client }, createElement(Probe, { refreshKey }));
  const view = render(tree(0));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(requestPath(calls[0]), '/api/connection-inventory');

  view.rerender(tree(1));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(requestPath(calls[1]), '/api/connection-inventory');
});
