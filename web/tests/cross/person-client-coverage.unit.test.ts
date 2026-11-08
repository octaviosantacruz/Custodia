import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

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
const { usePersonClientCoverage } = await import('../../src/cross/hooks/use-person-client-coverage.ts');

type Call = { path: string; signal?: AbortSignal };
const originalFetch = globalThis.fetch;
const clients: InstanceType<typeof QueryClient>[] = [];

function setupFetch(payloadFor: (path: string) => unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost/');
    calls.push({ path: `${url.pathname}${url.search}`, signal: init?.signal as AbortSignal | undefined });
    return new Response(JSON.stringify(payloadFor(url.pathname + url.search)), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function testClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return client;
}

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  globalThis.fetch = originalFetch;
});

test('disabled coverage makes no requests, without affecting the person view', async () => {
  const calls = setupFetch(() => ({}));
  const client = testClient();

  function Probe({ enabled }: { enabled: boolean }) {
    const coverage = usePersonClientCoverage({
      enabled, authChecked: true, authenticated: true, email: 'ada@example.test',
      onUnauthorized: () => {}, onError: () => {},
    });
    return createElement('div', { 'data-enabled': String(coverage.enabled) }, 'Personas disponibles');
  }

  render(createElement(QueryClientProvider, { client }, createElement(Probe, { enabled: false })));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(document.body.textContent, 'Personas disponibles');
  assert.equal(calls.length, 0, 'la consulta deshabilitada no debe solicitar detalle');
});

test('enabled coverage loads only the selected email detail without reusing the previous person', async () => {
  const calls = setupFetch((path) => ({
    email: new URL(`http://localhost${path}`).searchParams.get('email'),
    status: path.includes('ada%40') ? 'covered' : 'unknown',
  }));
  const client = testClient();

  function Probe({ email }: { email: string }) {
    const coverage = usePersonClientCoverage({
      enabled: true, authChecked: true, authenticated: true, email,
      onUnauthorized: () => {}, onError: () => {},
    });
    return createElement('section', null,
      createElement('output', { 'aria-label': 'Persona seleccionada' },
        coverage.detail ? `${coverage.detail.status}:${coverage.detail.email}` : 'Sin detalle'));
  }

  const tree = (email: string) => createElement(QueryClientProvider, { client }, createElement(Probe, { email }));
  const view = render(tree('ada@example.test'));
  await waitFor(() => assert.match(document.body.textContent ?? '', /covered:ada@example\.test/));
  view.rerender(tree('no-match@example.test'));
  await waitFor(() => assert.match(document.body.textContent ?? '', /unknown:no-match@example\.test/));
  assert.doesNotMatch(document.body.textContent ?? '', /covered:ada@example\.test/);
  assert.ok(calls.every((call) => call.path.startsWith('/api/chains/person/coverage/detail?email=')));
  assert.ok(calls.some((call) => call.path.includes('/api/chains/person/coverage/detail?email=ada%40example.test')));
  assert.ok(calls.some((call) => call.path.includes('/api/chains/person/coverage/detail?email=no-match%40example.test')));
  assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
});

test('a late detail response for the prior selection cannot replace the current person', async () => {
  const calls: string[] = [];
  let resolveAda: ((response: Response) => void) | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost/');
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/detail') && url.searchParams.get('email') === 'ada@example.test') {
      return new Promise<Response>((resolve) => { resolveAda = resolve; });
    }
    const payload = { email: 'other@example.test', status: 'unknown' };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const client = testClient();

  function Probe({ email }: { email: string }) {
    const coverage = usePersonClientCoverage({
      enabled: true, authChecked: true, authenticated: true, email,
      onUnauthorized: () => {}, onError: () => {},
    });
    return createElement('output', { 'aria-label': 'Persona seleccionada' },
      coverage.detail ? `${coverage.detail.status}:${coverage.detail.email}` : 'Sin detalle');
  }

  const tree = (email: string) => createElement(QueryClientProvider, { client }, createElement(Probe, { email }));
  const view = render(tree('ada@example.test'));
  await waitFor(() => assert.ok(calls.some((path) => path.includes('/detail?email=ada%40example.test'))));
  view.rerender(tree('other@example.test'));
  await waitFor(() => assert.equal(document.body.textContent, 'unknown:other@example.test'));
  assert.ok(resolveAda, 'the first person detail request should still be pending');
  resolveAda(new Response(JSON.stringify({ email: 'ada@example.test', status: 'covered' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(document.body.textContent, 'unknown:other@example.test');
});
